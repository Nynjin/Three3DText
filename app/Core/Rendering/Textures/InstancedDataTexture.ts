import { DataTexture, FloatType, NearestFilter, RGBAFormat } from "three";

const CAPACITY_MULTIPLIER = 1.5;

const TEXEL_SIZE = 4; // RGBA channels per texel

const MAX_TEXTURE_WIDTH = 4096; // should be safe for most devices

// TODO : may be possible to increase max size with a DataArrayTexture using layers
// const MAX_LAYERS = 256;

export interface Texel {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Item {
  idx: number;
  data: Texel[];
}

export interface ItemAllocation {
  key: string;
  flatItems: Texel[]; // flat array of texels for all items of this key, concatenated
}

// Todo : avoid freeSlots sorting

/**
 * @class InstancedDataTexture  
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

  private _keyToItems: Map<string, Item[]> = new Map();
  private _keyToTexelIndices: Map<string, number[]> = new Map();
  private _availableTexelIdx: number[] = [];

  readonly _texelsPerItem: number = 0;
  readonly _maxTextureWidth: number;
  readonly _capacityMultiplier: number;

  get texture(): DataTexture {
    return this._texture;
  }
  get width() {
    return this._width;
  }
  get capacity() {
    return this._itemCapacity;
  }
  get usedSlots() { 
    return this._usedSlots; 
  }

  constructor(
    texelsPerItem: number,
    maxTexWidth = MAX_TEXTURE_WIDTH,
    capacityMultiplier = CAPACITY_MULTIPLIER,
  ) {
    this._texelsPerItem = texelsPerItem;
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
        `InstancedDataBuffer.calcWidth - Requested texture width ${w} exceeds max of ${this._maxTextureWidth}. This may cause rendering issues on some devices.`,
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
   * Initializes the Three.js DataTexture with the current data buffer, width, and appropriate settings for use in shaders.
   * 
   * @returns The initialized DataTexture.
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

  getKeys(): string[] {
    return Array.from(this._keyToItems.keys());
  }

  getAllTexelIndices(): number[] {
    const indices: number[] = [];
    for (const idx of this._keyToTexelIndices.values()) {
      indices.push(...idx);
    }
    return indices;
  }
  
  getTexelIndicesOf(key: string): number[] | undefined {
    return this._keyToTexelIndices.get(key);
  }

  getFirstTexelIdxOf(key: string): number | undefined {
    const items = this._keyToTexelIndices.get(key);
    if (!items || items.length === 0) {
      return undefined;
    }
    return items[0];
  }

  /**
   * Retrieves the items associated with a given key.
   * 
   * @param key - The unique key identifying the items to retrieve.
   * 
   * @returns An array of items associated with the key, or undefined if no items are found for the key.
   */
  getItemsOf(key: string): Item[] | undefined {
    return this._keyToItems.get(key);
  }

  getFirstItemOf(key: string): Item | undefined {
    return this._keyToItems.get(key)?.[0];
  }

  /**
   * Public method to add items to the buffer for a specific key
   */
  addToKey(allocation: ItemAllocation) {
    this.addToKeys([allocation]);
  }

  /**
   * Public method to add multiple items to the buffer for multiple keys
   */
  addToKeys(allocations: ItemAllocation[]) {
    const validAllocations = this._filterValidAllocations(allocations);
    this._addToKeys(validAllocations);
    this._texture.needsUpdate = true;
  }

  private _filterValidAllocations(allocations: ItemAllocation[]) {
    return allocations.filter(({ key, flatItems }) => {
      // empty flatItems is valid — treated as removal in _updateKeys
      if (flatItems.length === 0) {
        return true
      };
      if (flatItems.length % this._texelsPerItem !== 0) {
        console.warn(
          `InstancedDataBuffer - Item ${key} has data length ${flatItems.length} which is not a multiple of texelsPerItem ${this._texelsPerItem}`,
        );
        return false;
      }
      return true;
    });
  }

  private _setTexelDataAt(idx: number, offset: number, flatItems: Texel[], out?: Texel[]) {
    const data = out ?? new Array<Texel>(this._texelsPerItem);
        
    let base = idx * TEXEL_SIZE;
    for (let i = 0; i < this._texelsPerItem; i++) {
      const t = flatItems[offset * this._texelsPerItem + i];
      data[i] = t;
      this._data[base++] = t.x;
      this._data[base++] = t.y;
      this._data[base++] = t.z;
      this._data[base++] = t.w;
    }

    return data;
  }

  private _addToKeys(allocations: ItemAllocation[]) {
    if (allocations.length === 0) {
      return;
    };

    // Resize buffer if needed
    let totalNewItems = 0;
    const itemCounts: number[] = [];
    for (const { flatItems } of allocations) {
      const count = flatItems.length / this._texelsPerItem;
      itemCounts.push(count);
      totalNewItems += count;
    }
    const totalNeeded = this._usedSlots + totalNewItems;
    if (totalNeeded > this._itemCapacity) {
      this._resize(totalNeeded);
    }

    for (let i = 0; i < allocations.length; i++) {
      const { key, flatItems } = allocations[i];
      const currentItemCount = itemCounts[i];
      const storedItems = this._keyToItems.get(key) ?? [];
      const storedIndices = this._keyToTexelIndices.get(key) ?? [];

      for (let j = 0; j < currentItemCount; j++) {
        const idx = this._availableTexelIdx.pop();
        if (idx === undefined) {
          throw new Error("Unexpected undefined index in free slots");
        }

        const data = this._setTexelDataAt(idx, j, flatItems);
        storedItems.push({ idx, data });
        storedIndices.push(idx);
      }

      this._keyToItems.set(key, storedItems);
      this._keyToTexelIndices.set(key, storedIndices);
    }
    
    this._usedSlots += totalNewItems;
  }

  /**
   * 
   * @param key 
   */
  removeKey(key: string) {
    this.removeKeys([key]);
  }

  /**
   * 
   * @param keys 
   */
  removeKeys(keys: string[]) {
    this._removeKeys(keys);
    this._texture.needsUpdate = true;
  }

  private _removeKeys(keys: string[]) {
    for (const key of keys) {
      const items = this._keyToItems.get(key);
      if (!items) {
        console.warn(
          `InstancedDataBuffer.removeKeys - No items found for key ${key}`,
        );
        continue;
      }

      for (const item of items) {
        this._data.fill(0, item.idx * TEXEL_SIZE, (item.idx + this._texelsPerItem) * TEXEL_SIZE);
        this._availableTexelIdx.push(item.idx);
      }
      this._keyToItems.delete(key);
      this._keyToTexelIndices.delete(key);
      this._usedSlots -= items.length;
    }
  }

  /**
   * 
   * @param key 
   * @param flatItems 
   */
  updateKey(allocation: ItemAllocation) {
    this.updateKeys([allocation]);
  }

  /**
   * 
   * @param items 
   */
  updateKeys(allocations: ItemAllocation[]) {
     this._updateKeys(allocations);
      this._texture.needsUpdate = true;
  }

  /**
   * 
   * @param items 
   * 
   */
  private _updateKeys(allocations: ItemAllocation[]) {
    const validAllocations = this._filterValidAllocations(allocations);

    const toAdd: ItemAllocation[] = [];

    for (const { key, flatItems } of validAllocations) {
      const existingItems = this._keyToItems.get(key) ?? [];

      const newItemCount = flatItems.length / this._texelsPerItem;
      const oldItemCount = existingItems.length;
      const commonCount = Math.min(newItemCount, oldItemCount);
      const deleteCount = oldItemCount - commonCount;

      // update existing items with new data
      for (let i = 0; i < commonCount; i++) {
        this._setTexelDataAt(existingItems[i].idx, i, flatItems, existingItems[i].data);
      }

      // delete excess if new count is lower
      for (let i = commonCount; i < oldItemCount; i++) {
        const item = existingItems[i];
        this._data.fill(0, item.idx * TEXEL_SIZE, (item.idx + this._texelsPerItem) * TEXEL_SIZE);
        this._availableTexelIdx.push(item.idx);
      }
      existingItems.length = commonCount;
      this._usedSlots -= deleteCount;
      
      // remove from maps if key does not have any items
      if (newItemCount === 0) {
        this._keyToItems.delete(key);
        this._keyToTexelIndices.delete(key);
      } else {
        this._keyToItems.set(key, existingItems);

        if (deleteCount > 0) {
          this._keyToTexelIndices.set(key, existingItems.map((i) => i.idx));
        }
      }
      
      // store new items for batched insertion
      if (newItemCount > oldItemCount) {
        toAdd.push({ key, flatItems: flatItems.slice(commonCount * this._texelsPerItem) });
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

    // todo: avoid mapping and unwrapping
    const all = [
      ...toUpdate,
      ...toAdd,
      ...toRemove.map(key => ({ key, flatItems: [] })),
    ];
    this._updateKeys(all);
    this._texture.needsUpdate = true;
  }

  /**
   * @todo implement shrinkToFit that compacts items to reduce texture size
   */
  private _shrinkToFit() {
  }

  dispose() {
    this._texture.dispose();
  }
}
