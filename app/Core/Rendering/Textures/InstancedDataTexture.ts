import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';

const CAPACITY_MULTIPLIER = 1.5;

const TEXEL_SIZE = 4; // RGBA channels per texel

const MAX_TEXTURE_WIDTH = 4096; // should be safe for most devices

// TODO : may be possible to increase max size with a DataArrayTexture using layers
// const MAX_LAYERS = 256;

/** Shared source for a removal, which carries no data. */
export const NO_DATA = new Float32Array(0);

export interface ItemAllocation {
  key: string;
  /**
   * The key's items as flat RGBA floats, concatenated — length must be a
   * multiple of `texelsPerItem * 4`. Read during the call and never retained,
   * so a view into a reused staging buffer is fine. Empty means "remove".
   */
  data: Float32Array;
}

// Todo : avoid freeSlots sorting

/**
 * @description Manages a dynamic texture buffer for instanced rendering,
 * allowing addition, removal, and update of items identified by unique keys.
 * Each item consists of a fixed number of texels, allowing insertion to use free slots with minimal fragmentation.
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

  constructor(
    texelsPerItem: number,
    maxTexWidth = MAX_TEXTURE_WIDTH,
    capacityMultiplier = CAPACITY_MULTIPLIER,
  ) {
    this._texelsPerItem = texelsPerItem;
    this._floatsPerItem = texelsPerItem * TEXEL_SIZE;
    this._maxTextureWidth = maxTexWidth;
    this._capacityMultiplier = capacityMultiplier;

    this._data = new Float32Array();
    this._texture = new DataTexture();
  }

  /**
   * Calculates the required texture width based on the required capacity and texels per item.
   * Warning if width exceed the maximum texture width.
   *
   * @param capacity - The required capacity to store items
   *
   * @returns The calculated texture width.
   *
   * @todo consider using a hard width limit
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
   * Resizes the data buffer and texture to accommodate the specified number of items, while maintaining existing data and free slot indices.
   * The new capacity is calculated based on the item count, texels per item, and capacity multiplier.
   *
   * @param needed - The number of items to be stored in the buffer.
   *
   * @todo handle shrinking
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

    // THREE allocates fixed size for image. Need to recreate the texture if resize.
    this._regenerateTexture();
  }

  /**
   * Initializes the Three.js DataTexture with the current data buffer, width,
   * and appropriate settings for use in shaders.
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
   * key is unknown. Live array — do not mutate.
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
   * each. An empty `flatItems` is kept — `_updateKeys` reads it as a removal.
   *
   * @param allocations - Allocations to check.
   *
   * @returns The allocations that are safe to write.
   */
  private _filterValidAllocations(allocations: ItemAllocation[]) {
    return allocations.filter(({ key, data }) => {
      // Empty data is valid — treated as a removal in _updateKeys.
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
   * Copies one item's floats into the buffer at `idx`.
   *
   * @param idx - Destination texel index.
   * @param src - The key's flat float data.
   * @param itemOffset - Which item to read out of `src`.
   */
  private _writeItem(idx: number, src: Float32Array, itemOffset: number) {
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

    // Resize buffer if needed
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

      for (let j = 0; j < itemCount; j++) {
        const idx = this._availableTexelIdx.pop();
        if (idx === undefined) {
          throw new Error('Unexpected undefined index in free slots');
        }

        this._writeItem(idx, data, j);
        storedIndices.push(idx);
      }

      this._keyToTexelIndices.set(key, storedIndices);
    }

    this._usedSlots += totalNewItems;
  }

  /**
   * @param allocations - Allocations whose texel data should be refreshed.
   */
  private _updateKeys(allocations: ItemAllocation[]) {
    const validAllocations = this._filterValidAllocations(allocations);

    const toAdd: ItemAllocation[] = [];

    for (const { key, data } of validAllocations) {
      const indices = this._keyToTexelIndices.get(key) ?? [];

      const newItemCount = data.length / this._floatsPerItem;
      const oldItemCount = indices.length;
      const commonCount = Math.min(newItemCount, oldItemCount);
      const deleteCount = oldItemCount - commonCount;

      // update existing items with new data
      for (let i = 0; i < commonCount; i++) {
        this._writeItem(indices[i], data, i);
      }

      // delete excess if new count is lower
      for (let i = commonCount; i < oldItemCount; i++) {
        const idx = indices[i];
        this._data.fill(0, idx * TEXEL_SIZE, (idx + this._texelsPerItem) * TEXEL_SIZE);
        this._availableTexelIdx.push(idx);
      }
      indices.length = commonCount;
      this._usedSlots -= deleteCount;

      // remove from the map if the key has no items left
      if (newItemCount === 0) {
        this._keyToTexelIndices.delete(key);
      } else {
        this._keyToTexelIndices.set(key, indices);
      }

      // store new items for batched insertion — a view, not a copy
      if (newItemCount > oldItemCount) {
        toAdd.push({ key, data: data.subarray(commonCount * this._floatsPerItem) });
      }
    }

    this._addToKeys(toAdd);
  }

  /**
   *
   * @param toAdd
   * @param toRemove
   * @param toUpdate
   *
   * @todo optimize so updateKeys overwrites items to remove directly instead of freeing slots first
   */
  update(toAdd: ItemAllocation[], toRemove: string[], toUpdate: ItemAllocation[]) {
    if (toAdd.length === 0 && toRemove.length === 0 && toUpdate.length === 0) return;

    const all = [
      ...toUpdate,
      ...toAdd,
      ...toRemove.map(key => ({ key, data: NO_DATA })),
    ];
    this._updateKeys(all);
    this._texture.needsUpdate = true;
  }

  /** Releases the GPU texture. The instance is unusable afterwards. */
  dispose() {
    this._texture.dispose();
  }
}
