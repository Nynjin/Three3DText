import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';

const CAPACITY_MULTIPLIER = 1.5;

const TEXEL_SIZE = 4; // RGBA channels per texel

/** Widest texture: texel indices stay below 2^24, exact in a float channel. */
const MAX_INDEXABLE_WIDTH = 4096;

/** Update ranges past which the whole buffer is uploaded instead. */
const MAX_UPLOAD_RANGES = 512;

/** Recorded dirty spans past which the whole buffer is sent, unmerged. */
const MAX_RECORDED_SPANS = 32768;

const NO_DATA = new Float32Array(0);

export interface ItemAllocation {
  key: string;
  /**
   * The key's items as flat RGBA floats, replacing what the key held. Length a
   * multiple of `texelsPerItem * 4`; empty removes the key. Not retained.
   */
  data: Float32Array;
}

/**
 * Square RGBA float texture holding, per string key, a list of items of
 * `texelsPerItem` texels. Items take any free slot; with `nextItemFloat` set,
 * each stores the texel index of the key's next item, -1 at the end. Texel
 * indices are linear (`i % width`, `floor(i / width)`) and stable across other
 * keys' changes and growth.
 *
 * Growth replaces {@link texture}: re-read it after every {@link update}.
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
  /** Float holding the link to a key's next item; -1 when unused. */
  private readonly _nextItemFloat: number;
  private readonly _maxWidth: number;

  /** Texel spans written since the last flush, [start, end) pairs. */
  private readonly _dirty: number[] = [];
  /** Set until three uploads the whole buffer. */
  private _fullUploadPending = false;

  get texture(): DataTexture {
    return this._texture;
  }

  /**
   * @param texelsPerItem - Texels per item.
   * @param nextItemFloat - Float in an item holding the texel index of the key's
   * next item, for shaders that walk a key's items. Owned by this class: staged
   * values there are overwritten.
   * @param maxTextureSize - Largest texture side the device accepts, in texels.
   */
  constructor(texelsPerItem: number, nextItemFloat = -1, maxTextureSize = MAX_INDEXABLE_WIDTH) {
    this._texelsPerItem = texelsPerItem;
    this._floatsPerItem = texelsPerItem * TEXEL_SIZE;
    this._nextItemFloat = nextItemFloat;
    this._maxWidth = Math.min(MAX_INDEXABLE_WIDTH, maxTextureSize);
  }

  /**
   * @returns Texel index of each of the key's items in chain order, head first,
   * or `undefined` for an unknown key. Live array: do not mutate.
   */
  getTexelIndicesOf(key: string): number[] | undefined {
    return this._keyToTexelIndices.get(key);
  }

  /** Items left before the device's texture size limit. */
  get freeItems(): number {
    return Math.floor((this._maxWidth * this._maxWidth) / this._texelsPerItem) - this._usedSlots;
  }

  itemCountOf(key: string): number {
    return this._keyToTexelIndices.get(key)?.length ?? 0;
  }

  /** @returns `undefined` if the key holds no item. */
  getFirstTexelIndexOf(key: string): number | undefined {
    return this._keyToTexelIndices.get(key)?.[0];
  }

  /**
   * Apply one batch and queue the touched texels for upload. A key must not be
   * in both `allocations` and `removals`.
   *
   * @param allocations - New contents for new or held keys.
   * @param removals - Unknown keys are ignored.
   *
   * @throws {Error} If an allocation's length is not a whole number of items.
   * @throws {RangeError} If the items do not fit in a texture as wide as the
   * smaller of the device limit and 4096.
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

  /** Release the GPU texture. Unusable afterwards. */
  dispose() {
    this._texture.dispose();
  }

  /**
   * Overwrite the key's items with `data`, freeing any surplus.
   *
   * @returns Items beyond the key's existing slots, or `undefined` if none.
   */
  private _rewrite(key: string, data: Float32Array): ItemAllocation | undefined {
    const indices = this._keyToTexelIndices.get(key) ?? [];
    const newCount = data.length / this._floatsPerItem;
    const oldCount = indices.length;
    const common = Math.min(newCount, oldCount);

    // Writing an item overwrites its link: relink after each.
    for (let i = 0; i < common; i++) {
      this._writeItem(indices[i], data, i);
      if (i > 0) this._linkTo(indices[i - 1], indices[i]);
    }
    // A shrunk or same-size key ends here; a grown one is relinked on append.
    if (common > 0 && newCount === common) this._linkTo(indices[common - 1], -1);

    // Freed items keep their texels: nothing links to them, and the next write replaces them all.
    for (let i = common; i < oldCount; i++) this._availableTexelIdx.push(indices[i]);
    indices.length = common;
    this._usedSlots -= oldCount - common;

    if (newCount === 0) {
      this._keyToTexelIndices.delete(key);
      return undefined;
    }
    this._keyToTexelIndices.set(key, indices);
    return newCount > oldCount ? { key, data: data.subarray(common * this._floatsPerItem) } : undefined;
  }

  /** Append items after each key's existing ones, growing the buffer first if needed. */
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
   * Grow buffer and texture to hold `needed` items plus headroom, capped at the
   * width limit. Keeps data; never shrinks.
   *
   * @throws {RangeError} If `needed` items do not fit at the limit.
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

  /** Next upload sends the whole buffer, even with nothing pending. */
  requestFullUpload() {
    this._requestFullUpload();
    this._texture.needsUpdate = true;
  }

  /** Next upload sends the whole buffer; queued ranges are dropped. */
  private _requestFullUpload() {
    this._fullUploadPending = true;
    this._dirty.length = 0;
    this._texture.clearUpdateRanges();
  }

  /**
   * Write `to` into the link float of the item at texel `from`. No-op if `from`
   * is -1 or there is no link float.
   */
  private _linkTo(from: number, to: number) {
    if (this._nextItemFloat < 0 || from < 0) return;
    this._data[from * TEXEL_SIZE + this._nextItemFloat] = to;
    this._markDirty(from, 1);
  }

  /** Queue a texel span for the next flush. */
  private _markDirty(texelStart: number, texelCount: number) {
    if (this._fullUploadPending) return;
    this._dirty.push(texelStart, texelStart + texelCount);
    if (this._dirty.length > MAX_RECORDED_SPANS * 2) this._requestFullUpload();
  }

  /** Copy item `item` of `src` to texel `idx`. */
  private _writeItem(idx: number, src: Float32Array, item: number) {
    this._markDirty(idx, this._texelsPerItem);
    this._data.set(src.subarray(item * this._floatsPerItem, (item + 1) * this._floatsPerItem), idx * TEXEL_SIZE);
  }

  /**
   * Hand changed spans to three as update ranges. Each range is one single-row
   * `texSubImage2D`: spans crossing a row are split. Past
   * {@link MAX_UPLOAD_RANGES} the whole buffer is sent.
   */
  private _flush() {
    const texture = this._texture;
    if (this._fullUploadPending) {
      texture.needsUpdate = true;
      return;
    }
    if (this._dirty.length === 0) return;

    // Merge overlapping and touching spans.
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
    // Ranges from earlier flushes count: three sends them together.
    let ranges = texture.updateRanges.length;
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
