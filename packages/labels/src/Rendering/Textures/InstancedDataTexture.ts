import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';

const CAPACITY_MULTIPLIER = 1.5;

const TEXEL_SIZE = 4; // RGBA channels per texel

/** Widest texture: every texel index stays below 2^24, exact in a float channel. */
const MAX_INDEXABLE_WIDTH = 4096;

/** Update ranges past which the whole buffer is uploaded instead. */
const MAX_UPLOAD_RANGES = 512;

const NO_DATA = new Float32Array(0);

export interface ItemAllocation {
  key: string;
  /**
   * The key's items as flat RGBA floats, concatenated, replacing whatever the
   * key held. Length must be a multiple of `texelsPerItem * 4`; empty removes
   * the key. Read during the call and never retained.
   */
  data: Float32Array;
}

/**
 * A square RGBA float texture holding, per string key, a list of items of
 * `texelsPerItem` texels. An item takes any free slot; with `nextItemFloat`
 * set, each item stores the texel index of the key's next item, -1 at the end.
 * Texel indices are linear (`i % width`, `floor(i / width)`) and survive other
 * keys' additions, removals and growth.
 *
 * Growth replaces {@link texture}: re-read it, and its width, after every
 * {@link update}.
 */
export class InstancedDataTexture {
  private _data = new Float32Array();
  private _texture = new DataTexture();

  private _width = 1;
  private _itemCapacity = 0;
  private _usedSlots = 0;

  private readonly _keyToTexelIndices = new Map<string, number[]>();
  private readonly _availableTexelIdx: number[] = [];

  private readonly _texelsPerItem: number;
  private readonly _floatsPerItem: number;
  /** Float holding the link to a key's next item, or -1 when unused. */
  private readonly _nextItemFloat: number;
  private readonly _maxWidth: number;

  /** Texel spans written since the last flush, as [start, end) pairs, for partial upload. */
  private readonly _dirty: number[] = [];
  /** Set until three has uploaded the whole buffer, after a resize or too many spans. */
  private _fullUploadPending = false;

  get texture(): DataTexture {
    return this._texture;
  }

  /**
   * @param texelsPerItem - Texels each item occupies.
   * @param nextItemFloat - Float, within an item, holding the texel index of the
   * key's next item. Pass it only for a buffer whose shader walks a key's
   * items; the float is then owned by this class and whatever the caller
   * stages there is overwritten.
   * @param maxTextureSize - Largest texture side the device accepts, in texels.
   */
  constructor(texelsPerItem: number, nextItemFloat = -1, maxTextureSize = MAX_INDEXABLE_WIDTH) {
    this._texelsPerItem = texelsPerItem;
    this._floatsPerItem = texelsPerItem * TEXEL_SIZE;
    this._nextItemFloat = nextItemFloat;
    this._maxWidth = Math.min(MAX_INDEXABLE_WIDTH, maxTextureSize);
  }

  /**
   * @returns The texel index of each of the key's items in chain order, `[0]`
   * being the head, or `undefined` if the key is unknown. Live array: do not
   * mutate.
   */
  getTexelIndicesOf(key: string): number[] | undefined {
    return this._keyToTexelIndices.get(key);
  }

  /** @returns The texel index of the key's first item, or `undefined` if the key holds none. */
  getFirstTexelIndexOf(key: string): number | undefined {
    return this._keyToTexelIndices.get(key)?.[0];
  }

  /**
   * Apply one batch of changes and queue the texels it touched for upload.
   * A key must not appear in both `allocations` and `removals`.
   *
   * @param allocations - New contents for keys, new or held.
   * @param removals - Keys whose slots are freed; unknown keys are ignored.
   *
   * @throws {Error} If an allocation's length is not a whole number of items.
   * @throws {RangeError} If the items do not fit in a texture as wide as the
   * device limit, or 4096.
   */
  update(allocations: ItemAllocation[], removals: Iterable<string>) {
    const toAppend: ItemAllocation[] = [];

    for (const { key, data } of allocations) {
      if (data.length % this._floatsPerItem !== 0) {
        throw new Error(`InstancedDataTexture: ${key} has ${data.length} floats, not a multiple of ${this._floatsPerItem}`);
      }
      const tail = this._rewrite(key, data);
      if (tail) toAppend.push(tail);
    }
    for (const key of removals) this._rewrite(key, NO_DATA);

    this._append(toAppend);
    this._flush();
  }

  /** Releases the GPU texture. The instance is unusable afterwards. */
  dispose() {
    this._texture.dispose();
  }

  /**
   * Overwrites the key's existing items with `data`, freeing any it no longer
   * needs.
   *
   * @returns The items that did not fit in the key's existing slots, or
   * `undefined` when there are none.
   */
  private _rewrite(key: string, data: Float32Array): ItemAllocation | undefined {
    const indices = this._keyToTexelIndices.get(key) ?? [];
    const newCount = data.length / this._floatsPerItem;
    const oldCount = indices.length;
    const common = Math.min(newCount, oldCount);

    // Writing an item overwrites its link, so each is relinked after it.
    for (let i = 0; i < common; i++) {
      this._writeItem(indices[i], data, i);
      if (i > 0) this._linkTo(indices[i - 1], indices[i]);
    }
    // A key that shrank or kept its size ends here; one that grew is relinked
    // when its tail is appended.
    if (common > 0 && newCount === common) this._linkTo(indices[common - 1], -1);

    for (let i = common; i < oldCount; i++) {
      const idx = indices[i];
      this._data.fill(0, idx * TEXEL_SIZE, (idx + this._texelsPerItem) * TEXEL_SIZE);
      this._markDirty(idx, this._texelsPerItem);
      this._availableTexelIdx.push(idx);
    }
    indices.length = common;
    this._usedSlots -= oldCount - common;

    if (newCount === 0) {
      this._keyToTexelIndices.delete(key);
      return undefined;
    }
    this._keyToTexelIndices.set(key, indices);
    return newCount > oldCount ? { key, data: data.subarray(common * this._floatsPerItem) } : undefined;
  }

  /** Appends items to each key after those it already holds, growing the buffer first if needed. */
  private _append(allocations: ItemAllocation[]) {
    if (allocations.length === 0) return;

    let newItems = 0;
    for (const { data } of allocations) newItems += data.length / this._floatsPerItem;
    if (this._usedSlots + newItems > this._itemCapacity) this._resize(this._usedSlots + newItems);

    for (const { key, data } of allocations) {
      const count = data.length / this._floatsPerItem;
      const indices = this._keyToTexelIndices.get(key) ?? [];

      let prev = indices.length > 0 ? indices[indices.length - 1] : -1;
      for (let j = 0; j < count; j++) {
        const idx = this._availableTexelIdx.pop();
        if (idx === undefined) throw new Error('InstancedDataTexture: free list ran dry');
        this._writeItem(idx, data, j);
        this._linkTo(prev, idx);
        prev = idx;
        indices.push(idx);
      }
      this._linkTo(prev, -1);

      this._keyToTexelIndices.set(key, indices);
    }

    this._usedSlots += newItems;
  }

  /**
   * Grows the buffer and texture to hold `needed` items plus headroom, or to
   * the widest texture the limit allows when the headroom does not fit.
   * Keeps existing data; never shrinks.
   *
   * @throws {RangeError} If `needed` items do not fit even at the limit.
   */
  private _resize(needed: number) {
    const widthFor = (items: number) => Math.max(1, Math.ceil(Math.sqrt(items * this._texelsPerItem)));
    if (widthFor(needed) > this._maxWidth) {
      throw new RangeError(
        `InstancedDataTexture: ${needed} items need a ${widthFor(needed)} px texture, over the limit of ${this._maxWidth}`,
      );
    }
    const width = Math.min(widthFor(needed * CAPACITY_MULTIPLIER), this._maxWidth);

    const texelCount = width * width;
    const data = new Float32Array(texelCount * TEXEL_SIZE);
    data.set(this._data);
    this._data = data;
    this._width = width;

    const capacity = Math.floor(texelCount / this._texelsPerItem);
    for (let i = this._itemCapacity; i < capacity; i++) {
      this._availableTexelIdx.push(i * this._texelsPerItem);
    }
    this._itemCapacity = capacity;

    this._texture.dispose();
    this._texture = new DataTexture(this._data, width, width, RGBAFormat, FloatType);
    // RGBA32F is not filterable without OES_texture_float_linear, and an
    // unfilterable texture samples as zero.
    this._texture.minFilter = NearestFilter;
    this._texture.magFilter = NearestFilter;
    this._texture.onUpdate = () => {
      this._fullUploadPending = false;
    };
    this._requestFullUpload();
  }

  /** Makes the next upload send the whole buffer, dropping any queued ranges. */
  private _requestFullUpload() {
    this._fullUploadPending = true;
    this._dirty.length = 0;
    this._texture.clearUpdateRanges();
  }

  /**
   * Writes `to` into the link float of the item at texel `from`. No-op when
   * `from` is -1 or the buffer has no link float.
   */
  private _linkTo(from: number, to: number) {
    if (this._nextItemFloat < 0 || from < 0) return;
    this._data[from * TEXEL_SIZE + this._nextItemFloat] = to;
    this._markDirty(from, 1);
  }

  /** Notes a texel span as changed, for the next flush. */
  private _markDirty(texelStart: number, texelCount: number) {
    if (this._fullUploadPending) return;
    this._dirty.push(texelStart, texelStart + texelCount);
  }

  /** Copies one item's floats into the buffer at texel `idx`. */
  private _writeItem(idx: number, src: Float32Array, item: number) {
    this._markDirty(idx, this._texelsPerItem);
    this._data.set(src.subarray(item * this._floatsPerItem, (item + 1) * this._floatsPerItem), idx * TEXEL_SIZE);
  }

  /**
   * Hands the changed spans to three as update ranges. Each range becomes one
   * single-row `texSubImage2D`, so a span crossing a row is split. Past
   * {@link MAX_UPLOAD_RANGES} the whole buffer is sent instead.
   */
  private _flush() {
    const texture = this._texture;
    if (this._fullUploadPending) {
      texture.needsUpdate = true;
      return;
    }
    if (this._dirty.length === 0) return;

    // Merge overlapping and touching spans so neighbouring items upload once.
    const spans: [number, number][] = [];
    for (let i = 0; i < this._dirty.length; i += 2) spans.push([this._dirty[i], this._dirty[i + 1]]);
    this._dirty.length = 0;
    spans.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const span of spans) {
      const last = merged.length > 0 ? merged[merged.length - 1] : undefined;
      if (last !== undefined && span[0] <= last[1]) {
        if (span[1] > last[1]) last[1] = span[1];
      } else {
        merged.push(span);
      }
    }

    const width = this._width;
    let ranges = 0;
    for (const [from, to] of merged) {
      for (let texel = from; texel < to;) {
        const end = Math.min(to, (Math.floor(texel / width) + 1) * width);
        texture.addUpdateRange(texel * TEXEL_SIZE, (end - texel) * TEXEL_SIZE);
        texel = end;
        if (++ranges > MAX_UPLOAD_RANGES) {
          this._requestFullUpload();
          texture.needsUpdate = true;
          return;
        }
      }
    }
    texture.needsUpdate = true;
  }
}
