import { DataTexture, FloatType, NearestFilter, RGBAFormat } from "three";

const CAPACITY_MULTIPLIER = 1.5;

const TEXEL_SIZE = 4; // RGBA channels per texel

const MAX_TEX_SIZE = 4096; // should be safe for most devices

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
  private _capacity: number = 0;
  private _usedSlots: number = 0;

  private _keyToItems: Map<string, Item[]> = new Map();
  private _freeSlotsIdx: number[] = [];

  private readonly _texelsPerItem: number = 0;
  private readonly _maxTexWidth: number;
  private readonly _capacityMultiplier: number;

  get texture() {
    return this._texture;
  }
  get width() {
    return this._width;
  }
  get capacity() {
    return this._capacity;
  }
  get usedSlots() { 
    return this._usedSlots; 
  }
  get keyToItems(): ReadonlyMap<string, Item[]> { 
    return this._keyToItems; 
  }

  constructor(
    texelsPerItem: number,
    maxTexWidth = MAX_TEX_SIZE,
    capacityMultiplier = CAPACITY_MULTIPLIER,
  ) {
    this._texelsPerItem = texelsPerItem;
    this._maxTexWidth = maxTexWidth;
    this._capacityMultiplier = capacityMultiplier;

    this._data = new Float32Array();
    this._texture = this._initTexture();
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
    const texels =
      capacity * this._texelsPerItem;

    if (texels === 0) {
      return 1; 
    }

    const w = Math.ceil(Math.sqrt(texels));
    if (w > this._maxTexWidth) {
      console.warn(
        `InstancedDataBuffer.calcWidth - Requested texture width ${w} exceeds max of ${this._maxTexWidth}. This may cause rendering issues on some devices.`,
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
    const newCap = Math.ceil(needed * this._capacityMultiplier);
    const newWidth = this._calcWidth(newCap);
    if (newWidth === this._width) return;

    const newData = new Float32Array(newWidth * newWidth * TEXEL_SIZE);
    newData.set(this._data);
    this._data = newData;
    this._width = newWidth;

    for (let i = this._capacity; i < newCap; i++) {
      this._freeSlotsIdx.push(i * this._texelsPerItem);
    }

    this._capacity = newCap;
    this._texture.image.data = this._data;
    this._texture.image.width = newWidth;
    this._texture.image.height = newWidth;
    this._texture.needsUpdate = true;
  }

  /**
   * Initializes the Three.js DataTexture with the current data buffer, width, and appropriate settings for use in shaders.
   * 
   * @returns The initialized DataTexture.
   */
  private _initTexture() {
    const tex = new DataTexture(
      this._data,
      this._width,
      this._width,
      RGBAFormat,
      FloatType,
    );

    tex.minFilter = NearestFilter;
    tex.magFilter = NearestFilter;
    tex.needsUpdate = true;

    return tex;
  }

  getAllIdx(): number[] {
    const indices: number[] = [];
    for (const [, items] of this._keyToItems) {
      for (const item of items) {
        indices.push(item.idx);
      }
    }
    return indices;
  }

  getKeys(): string[] {
    return Array.from(this._keyToItems.keys());
  }

  getFirstIdxOf(key: string): number | undefined {
    const items = this._keyToItems.get(key);
    if (!items || items.length === 0) return undefined;
    return items[0].idx; // Return the index of the first item for the key
  }

  getIdxOf(key: string): number[] | undefined {
    const items = this._keyToItems.get(key);
    if (!items || items.length === 0) return undefined;
    return items.map((item) => item.idx); // Return an array of indices for the key
  }

  getFirstItemOf(key: string): Item | undefined {
    const items = this._keyToItems.get(key);
    if (!items || items.length === 0) return undefined;
    return items[0]; // Return the first item for the key
  }

  /**
   * Retrieves a copy of the items associated with a given key to prevent external mutation.
   * 
   * @param key - The unique key identifying the items to retrieve.
   * 
   * @returns An array of items associated with the key, or undefined if no items are found for the key.
   */
  getItemsOf(key: string): Item[] | undefined {
    const items = this._keyToItems.get(key);
    if (!items) return undefined;

    // Return a copy of items to prevent external mutation
    return items.map((item) => ({
      idx: item.idx,
      data: item.data.map((t) => ({ ...t })),
    }));
  }

  /**
   * Public method to add items to the buffer for a specific key
   */
  addToKey(key: string, flatData: Texel[]) {
    this.addToKeys([{ key, flatData }]);
  }

  /**
   * Public method to add multiple items to the buffer for multiple keys
   */
  addToKeys(items: { key: string; flatData: Texel[] }[]) {
    this._addToKeys(items);
    this._texture.needsUpdate = true;
  }

  private _addToKeys(items: { key: string; flatData: Texel[] }[]) {
    // Check if the data is a valid flat array of texels
    const validItems = items.filter(({ key, flatData }) => {
      if (flatData.length === 0) {
        console.warn(
          `InstancedDataBuffer.addToKeys - Attempting to add item ${key} with empty data`,
        );
        return false;
      }
      if (flatData.length % this._texelsPerItem !== 0) {
        console.warn(
          `InstancedDataBuffer.addToKeys - Item ${key} with data length ${flatData.length} which is not a multiple of texelsPerItem ${this._texelsPerItem}`,
        );
        return false;
      }
      return true;
    });

    if (validItems.length === 0) return;

    // Resize buffer if needed
    const totalNewItems = validItems.reduce(
      (sum, { flatData }) => sum + flatData.length, 0) / this._texelsPerItem;
    const totalNeeded = this._usedSlots + totalNewItems;
    if (totalNewItems > this._freeSlotsIdx.length) {
      this._resize(totalNeeded);
    }

    for (const { key, flatData } of validItems) {
      const itemCount = Math.ceil(flatData.length / this._texelsPerItem);
      const existingItems = this._keyToItems.get(key) ?? [];

      for (let i = 0; i < itemCount; i++) {
        const idx = this._freeSlotsIdx.pop();
        if (idx === undefined) {
          throw new Error("Unexpected undefined index in free slots");
        }
        const item = {
          idx,
          data: flatData.slice(
            i * this._texelsPerItem,
            (i + 1) * this._texelsPerItem,
          ),
        };
        existingItems.push(item);
        this._data.set(
          item.data.flatMap((t) => [t.x, t.y, t.z, t.w]),
          idx * TEXEL_SIZE,
        );
      }

      this._keyToItems.set(key, existingItems);
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
        this._freeSlotsIdx.push(item.idx);
      }
      this._keyToItems.delete(key);
      this._usedSlots -= items.length;
    }
  }

  /**
   * 
   * @param key 
   * @param flatData 
   */
  updateKey(key: string, flatData: Texel[]) {
    this.updateKeys([{ key, flatData }]);
  }

  /**
   * 
   * @param items 
   */
  updateKeys(items: { key: string; flatData: Texel[] }[]) {
     this._updateKeys(items);
      this._texture.needsUpdate = true;
  }

  /**
   * 
   * @param items 
   * 
   * @todo optimize to avoid recreating items and allow partial updates of item data
   */
  private _updateKeys(items: { key: string; flatData: Texel[] }[]) {
    this._removeKeys(items.map((i) => i.key));
    this._addToKeys(items);
  }

  /**
   * 
   * @param toAdd 
   * @param toRemove 
   * @param toUpdate 
   * 
   * @todo optimize so updateKeys overwrites items to remove directly instead of freeing slots first
   */
  update(toAdd: { key: string; flatData: Texel[] }[], toRemove: string[], toUpdate: { key: string; flatData: Texel[] }[]) {
    if (toAdd.length === 0 && toRemove.length === 0 && toUpdate.length === 0) return;

    this._removeKeys(toRemove);
    this._updateKeys(toUpdate);
    this._addToKeys(toAdd);
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
