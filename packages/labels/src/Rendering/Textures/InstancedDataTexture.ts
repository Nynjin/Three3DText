import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';

const CAPACITY_MULTIPLIER = 1.5;

const TEXEL_SIZE = 4; // RGBA channels per texel

const MAX_TEXTURE_WIDTH = 4096; // should be safe for most devices

// TODO: _calcWidth only warns past this, it does not clamp. Going wider needs a
// DataArrayTexture with one layer per slab.

/** Update ranges past which the whole buffer is uploaded instead. */
const MAX_UPLOAD_RANGES = 512;

/** Shared source for a removal, which carries no data. */
export const NO_DATA = new Float32Array(0);

export interface ItemAllocation {
  key: string;
  /**
   * The key's items as flat RGBA floats, concatenated. Length must be a
   * multiple of `texelsPerItem * 4`. Read during the call and never retained,
   * so a view into a reused staging buffer is fine. Empty means "remove".
   */
  data: Float32Array;
}

/**
 * A square RGBA float texture holding variable-length runs of texels, addressed
 * by string key.
 *
 * Each key owns whole items of `texelsPerItem` texels, chained through the
 * float `nextItemFloat` names so a shader can walk them. An item takes any free
 * slot, and a removal returns its slots to the free list; every other key's
 * texel indices stay valid across both.
 */
export class InstancedDataTexture {
  private _data: Float32Array;
  private _texture: DataTexture;

  private _width: number = 1;
  private _itemCapacity: number = 0;
  private _usedSlots: number = 0;

  private _keyToTexelIndices: Map<string, number[]> = new Map();
  private _availableTexelIdx: number[] = [];

  private readonly _texelsPerItem: number = 0;
  /** Float holding the link to a key's next item, or -1 when unused. */
  private readonly _nextItemFloat: number = -1;

  /** Texel spans written since the last flush, as [start, end) pairs, for partial upload. */
  private _dirty: number[] = [];
  /** Set when a whole-buffer upload is needed anyway, e.g. after a resize. */
  private _dirtyAll = false;
  /** `texelsPerItem * TEXEL_SIZE`, the stride one item occupies in `data`. */
  private readonly _floatsPerItem: number = 0;
  private readonly _maxTextureWidth: number;
  private readonly _capacityMultiplier: number;

  get texture(): DataTexture {
    return this._texture;
  }

  get width() {
    return this._width;
  }

  /**
   * @param texelsPerItem - Texels each item occupies.
   * @param nextItemFloat - Float, within an item, to keep the texel index of
   * the key's next item in, or -1 at the end of the chain. Pass it only for a
   * buffer whose shader walks a key's items; the float is then owned by this
   * class and whatever the caller stages there is overwritten.
   * @param maxTexWidth - Widest texture to allocate.
   * @param capacityMultiplier - Headroom factor on resize.
   */
  constructor(
    texelsPerItem: number,
    nextItemFloat?: number,
    maxTexWidth = MAX_TEXTURE_WIDTH,
    capacityMultiplier = CAPACITY_MULTIPLIER,
  ) {
    this._texelsPerItem = texelsPerItem;
    this._floatsPerItem = texelsPerItem * TEXEL_SIZE;
    this._nextItemFloat = nextItemFloat ?? -1;
    this._maxTextureWidth = maxTexWidth;
    this._capacityMultiplier = capacityMultiplier;

    this._data = new Float32Array();
    this._texture = new DataTexture();
  }

  /**
   * Square texture width holding `capacity` items plus the headroom factor.
   * Warns, but does not clamp, past `maxTexWidth`.
   *
   * @param capacity - Items the texture has to store.
   *
   * @returns Width in texels, at least 1.
   */
  private _calcWidth(capacity: number) {
    const texelCapacity = Math.ceil(capacity * this._texelsPerItem * this._capacityMultiplier);

    if (texelCapacity === 0) {
      return 1;
    }

    const w = Math.ceil(Math.sqrt(texelCapacity));
    if (w > this._maxTextureWidth) {
      console.warn(
        `InstancedDataTexture._calcWidth - Requested texture width ${w} exceeds max of ${this._maxTextureWidth}. This may cause rendering issues on some devices.`,
      );
    }
    return w;
  }

  /**
   * Grows the buffer and texture to hold `needed` items, keeping existing data
   * and adding the new slots to the free list. Never shrinks.
   *
   * @param needed - Items the buffer has to hold.
   */
  private _resize(needed: number) {
    const newWidth = this._calcWidth(needed);

    const texelCount = newWidth * newWidth;
    const newData = new Float32Array(texelCount * TEXEL_SIZE);
    newData.set(this._data);
    this._data = newData;
    this._width = newWidth;

    const oldCapacity = this._itemCapacity;
    const newCapacity = Math.floor(texelCount / this._texelsPerItem);

    for (let i = oldCapacity; i < newCapacity; i++) {
      this._availableTexelIdx.push(i * this._texelsPerItem);
    }

    this._itemCapacity = newCapacity;

    // Every row moves and the texture object is replaced, so the next flush has
    // to send the lot.
    this._dirty.length = 0;
    this._dirtyAll = true;

    // THREE allocates fixed size for image. Need to recreate the texture if resize.
    this._regenerateTexture();
  }

  /**
   * Replaces the DataTexture with one over the current buffer and width.
   * Filtering is nearest, since the shader addresses texels exactly.
   */
  private _regenerateTexture() {
    this._texture.dispose();
    this._texture = new DataTexture(
      this._data,
      this._width,
      this._width,
      RGBAFormat,
      FloatType,
    );

    this._texture.minFilter = NearestFilter;
    this._texture.magFilter = NearestFilter;
    this._texture.needsUpdate = true;
  }

  /**
   * @param key - The key to look up.
   *
   * @returns The texel index of each of the key's items, or `undefined` if the
   * key is unknown. Live array: do not mutate.
   */
  getTexelIndicesOf(key: string): number[] | undefined {
    return this._keyToTexelIndices.get(key);
  }

  /**
   * @param key - The key to look up.
   *
   * @returns The texel index of the key's first item, or `undefined` if the key
   * is unknown or holds no items.
   */
  getFirstTexelIndexOf(key: string): number | undefined {
    const items = this._keyToTexelIndices.get(key);
    if (!items || items.length === 0) {
      return undefined;
    }
    return items[0];
  }

  /**
   * Drops allocations whose data does not divide evenly into items, warning for
   * each. An empty `data` is kept: `_updateKeys` reads it as a removal.
   */
  private _filterValidAllocations(allocations: ItemAllocation[]) {
    return allocations.filter(({ key, data }) => {
      // Empty data is valid: treated as a removal in _updateKeys.
      if (data.length === 0) {
        return true;
      };
      if (data.length % this._floatsPerItem !== 0) {
        console.warn(
          `InstancedDataTexture - Item ${key} has data length ${data.length} which is not a multiple of floatsPerItem ${this._floatsPerItem}`,
        );
        return false;
      }
      return true;
    });
  }

  /**
   * Points one item at the next of its key, so a shader can walk a key's items
   * without them being adjacent.
   *
   * The link is written here, not staged with the rest of the item, because the
   * slot is only known once it is handed out.
   *
   * @param from - Item to write the link into, or -1 for the first item.
   */
  private _linkTo(from: number, to: number) {
    if (this._nextItemFloat < 0 || from < 0) return;
    this._data[from * TEXEL_SIZE + this._nextItemFloat] = to;
    this._markDirty(from, 1);
  }

  /** Notes a texel span as changed, for the next flush. */
  private _markDirty(texelStart: number, texelCount: number) {
    if (this._dirtyAll) return;
    this._dirty.push(texelStart, texelStart + texelCount);
  }

  /**
   * Hands the changed spans to three as update ranges, so it uploads those rows
   * instead of the whole buffer.
   *
   * Ranges are in floats and each becomes one `texSubImage2D` of a single row,
   * so a span crossing a row boundary is split. Past {@link MAX_UPLOAD_RANGES}
   * the ranges are dropped and the whole buffer is sent.
   */
  private _flushDirty() {
    const texture = this._texture;
    if (this._dirtyAll || this._dirty.length === 0) {
      this._dirty.length = 0;
      this._dirtyAll = false;
      texture.needsUpdate = true;
      return;
    }

    // Merge overlapping and touching spans so neighbouring items upload once.
    const spans: number[][] = [];
    for (let i = 0; i < this._dirty.length; i += 2) {
      spans.push([this._dirty[i], this._dirty[i + 1]]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    const merged: number[][] = [];
    for (const span of spans) {
      const last = merged.length - 1;
      if (last >= 0 && span[0] <= merged[last][1]) {
        if (span[1] > merged[last][1]) merged[last][1] = span[1];
      } else {
        merged.push(span);
      }
    }

    const width = this._width;
    let ranges = 0;
    for (const [from, to] of merged) {
      for (let texel = from; texel < to;) {
        const rowEnd = (Math.floor(texel / width) + 1) * width;
        const end = Math.min(to, rowEnd);
        texture.addUpdateRange(texel * TEXEL_SIZE, (end - texel) * TEXEL_SIZE);
        texel = end;
        if (++ranges > MAX_UPLOAD_RANGES) {
          texture.clearUpdateRanges();
          this._dirty.length = 0;
          texture.needsUpdate = true;
          return;
        }
      }
    }

    this._dirty.length = 0;
    texture.needsUpdate = true;
  }

  /** Copies one item's floats into the buffer at texel `idx`. */
  private _writeItem(idx: number, src: Float32Array, itemOffset: number) {
    this._markDirty(idx, this._texelsPerItem);
    const n = this._floatsPerItem;
    let s = itemOffset * n;
    let d = idx * TEXEL_SIZE;
    for (let i = 0; i < n; i++) {
      this._data[d++] = src[s++];
    }
  }

  /**
   * Appends brand-new keys, growing the buffer first if the free slots do not
   * cover them. Assumes none of the keys exist yet.
   *
   * @param allocations - Allocations to insert.
   *
   * @throws {Error} If the free-slot list runs dry, which means `_usedSlots`
   * has drifted from the buffer's real capacity.
   */
  private _addToKeys(allocations: ItemAllocation[]) {
    if (allocations.length === 0) {
      return;
    };

    let totalNewItems = 0;
    for (const { data } of allocations) {
      totalNewItems += data.length / this._floatsPerItem;
    }
    const totalNeeded = this._usedSlots + totalNewItems;
    if (totalNeeded > this._itemCapacity) {
      this._resize(totalNeeded);
    }

    for (const { key, data } of allocations) {
      const itemCount = data.length / this._floatsPerItem;
      const storedIndices = this._keyToTexelIndices.get(key) ?? [];

      // A key that grew keeps its existing items, so the chain continues from
      // its current tail.
      let prev = storedIndices.length > 0 ? storedIndices[storedIndices.length - 1] : -1;
      for (let j = 0; j < itemCount; j++) {
        const idx = this._availableTexelIdx.pop();
        if (idx === undefined) {
          throw new Error('Unexpected undefined index in free slots');
        }

        this._writeItem(idx, data, j);
        this._linkTo(prev, idx);
        prev = idx;
        storedIndices.push(idx);
      }

      this._keyToTexelIndices.set(key, storedIndices);
    }

    this._usedSlots += totalNewItems;
  }

  private _updateKeys(allocations: ItemAllocation[]) {
    const validAllocations = this._filterValidAllocations(allocations);

    const toAdd: ItemAllocation[] = [];

    for (const { key, data } of validAllocations) {
      const indices = this._keyToTexelIndices.get(key) ?? [];

      const newItemCount = data.length / this._floatsPerItem;
      const oldItemCount = indices.length;
      const commonCount = Math.min(newItemCount, oldItemCount);
      const deleteCount = oldItemCount - commonCount;

      // _writeItem copies the whole item stride and overwrites the link, so
      // each item is relinked after it is written.
      for (let i = 0; i < commonCount; i++) {
        this._writeItem(indices[i], data, i);
        if (i > 0) this._linkTo(indices[i - 1], indices[i]);
      }
      // A shorter key ends here; a longer one is relinked when its tail is
      // appended, below.
      if (commonCount > 0 && newItemCount === commonCount) {
        this._linkTo(indices[commonCount - 1], -1);
      }

      // Free the excess when the key shrank.
      for (let i = commonCount; i < oldItemCount; i++) {
        const idx = indices[i];
        this._data.fill(0, idx * TEXEL_SIZE, (idx + this._texelsPerItem) * TEXEL_SIZE);
        this._markDirty(idx, this._texelsPerItem);
        this._availableTexelIdx.push(idx);
      }
      indices.length = commonCount;
      this._usedSlots -= deleteCount;

      if (newItemCount === 0) {
        this._keyToTexelIndices.delete(key);
      } else {
        this._keyToTexelIndices.set(key, indices);
      }

      // Batch the key's new tail into one insertion. A view, not a copy.
      if (newItemCount > oldItemCount) {
        toAdd.push({ key, data: data.subarray(commonCount * this._floatsPerItem) });
      }
    }

    this._addToKeys(toAdd);
  }

  /**
   * Apply one batch of changes and upload the texels it touched.
   *
   * The three lists are applied together, so a key may appear in more than one:
   * updates land first, then additions, then removals.
   *
   * @param toAdd - Allocations for keys the buffer does not hold yet.
   * @param toRemove - Keys whose slots are freed.
   * @param toUpdate - Allocations for keys already held. A key may grow or
   * shrink its item count here; empty data removes it.
   */
  update(toAdd: ItemAllocation[], toRemove: string[], toUpdate: ItemAllocation[]) {
    if (toAdd.length === 0 && toRemove.length === 0 && toUpdate.length === 0) return;

    const all = [
      ...toUpdate,
      ...toAdd,
      ...toRemove.map(key => ({ key, data: NO_DATA })),
    ];
    this._updateKeys(all);
    this._flushDirty();
  }

  /** Releases the GPU texture. The instance is unusable afterwards. */
  dispose() {
    this._texture.dispose();
  }
}
