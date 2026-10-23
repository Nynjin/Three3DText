import { DataTexture, LinearFilter, RGBAFormat, UnsignedByteType } from 'three';

/** Pixels of an image: anything a canvas can draw, or raw RGBA bytes (not premultiplied). */
export type ImageSource
  = | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | OffscreenCanvas
    | ImageData
    | { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

/**
 * Image metadata, as MapLibre's `addImage` options and sprite index entries
 * name it. Lengths in image px.
 */
export interface ImageOptions {
  /** Image px per CSS px. Default 1; a `@2x` sprite is 2. */
  pixelRatio?: number;
  /**
   * The alpha channel holds a distance field in MapLibre's encoding: 0.75 at
   * the edge, falling 1/8 per image px outwards. Enables `iconColor` and the
   * icon halo. See {@link imageToSDF}.
   */
  sdf?: boolean;
  /** Columns `[from, to]` that stretch under `iconTextFit`. Default the whole width. At most two are used. */
  stretchX?: [number, number][];
  /** Rows `[from, to]` that stretch under `iconTextFit`. Default the whole height. At most two are used. */
  stretchY?: [number, number][];
  /** Area `[left, top, right, bottom]` that `iconTextFit` fits around the text. Default the whole image. */
  content?: [number, number, number, number];
}

/** One entry of a MapLibre sprite index (`sprite.json`): a rectangle of the sheet and its metadata. */
export interface SpriteIndexEntry extends ImageOptions {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A registered image: metadata and its place in the atlas. */
export interface ImageEntry {
  readonly id: string;
  /** In image px. */
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly sdf: boolean;
  readonly stretchX: [number, number][];
  readonly stretchY: [number, number][];
  readonly content: [number, number, number, number] | undefined;
  /** Top-left texel of the pixels in the atlas. */
  readonly px: number;
  readonly py: number;
}

/** Transparent texels around each image: bilinear taps at its edge read no neighbour. */
const GUTTER = 1;

const INITIAL_WIDTH = 1024;
const INITIAL_HEIGHT = 256;

/**
 * Images by id, packed into one RGBA texture, premultiplied. Shelf packing;
 * space of removed or resized images is not reused. Growing doubles the
 * height (or the width, for a wide image) and replaces {@link texture}.
 */
export class ImageAtlas {
  private _texture: DataTexture;
  private _data: Uint8Array;
  private _width = INITIAL_WIDTH;
  private _height = INITIAL_HEIGHT;

  /** Shelf being filled: its top, height and next free column. */
  private _shelfY = 0;
  private _shelfH = 0;
  private _shelfX = 0;

  private readonly _entries = new Map<string, ImageEntry>();
  private readonly _listeners = new Set<(ids: string[]) => void>();
  private readonly _maxSize: number;
  private _replaced = false;

  /** @param maxSize - Largest texture side, in texels. */
  constructor(maxSize: number) {
    this._maxSize = maxSize;
    this._data = new Uint8Array(this._width * this._height * 4);
    this._texture = this._makeTexture();
  }

  /** Replaced when the atlas grows. */
  get texture(): DataTexture {
    return this._texture;
  }

  /** Whether {@link texture} was replaced since the last call. */
  takeReplaced(): boolean {
    const replaced = this._replaced;
    this._replaced = false;
    return replaced;
  }

  get(id: string): ImageEntry | undefined {
    return this._entries.get(id);
  }

  has(id: string): boolean {
    return this._entries.has(id);
  }

  /**
   * Adds or replaces an image.
   *
   * @throws {RangeError} If the image does not fit in the largest texture.
   */
  add(id: string, image: ImageSource, options: ImageOptions = {}): void {
    const pixels = readPixels(image);
    this._put(id, pixels.data, pixels.width, 0, 0, pixels.width, pixels.height, options);
    this._emit([id]);
  }

  /**
   * Adds every entry of a MapLibre sprite index, cutting its rectangle out of
   * `sheet`. Ids get `prefix` in front, as MapLibre's `sprite-id:image` names.
   */
  addSprite(index: Record<string, SpriteIndexEntry>, sheet: ImageSource, prefix = ''): void {
    const pixels = readPixels(sheet);
    const ids: string[] = [];
    for (const [name, e] of Object.entries(index)) {
      const id = prefix + name;
      this._put(id, pixels.data, pixels.width, e.x, e.y, e.width, e.height, e);
      ids.push(id);
    }
    this._emit(ids);
  }

  /** Forgets an image. Its texels stay taken. */
  remove(id: string): void {
    if (this._entries.delete(id)) this._emit([id]);
  }

  /**
   * Subscribes to image changes: the listener gets the ids added, replaced or removed.
   *
   * @returns Unsubscribe function.
   */
  onChange(listener: (ids: string[]) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  dispose(): void {
    this._texture.dispose();
    this._entries.clear();
    this._listeners.clear();
  }

  private _emit(ids: string[]) {
    for (const listener of this._listeners) listener(ids);
  }

  /** Copies the `w` x `h` rectangle at (`sx`, `sy`) of a `stride`-wide RGBA buffer into a new slot. */
  private _put(
    id: string,
    src: Uint8Array | Uint8ClampedArray,
    stride: number,
    sx: number,
    sy: number,
    w: number,
    h: number,
    options: ImageOptions,
  ) {
    const [px, py] = this._allocate(w + 2 * GUTTER, h + 2 * GUTTER);
    const ox = px + GUTTER, oy = py + GUTTER;
    const data = this._data;
    for (let row = 0; row < h; row++) {
      let s = ((sy + row) * stride + sx) * 4;
      let d = ((oy + row) * this._width + ox) * 4;
      for (let col = 0; col < w; col++, s += 4, d += 4) {
        const a = src[s + 3];
        data[d] = (src[s] * a + 127) / 255;
        data[d + 1] = (src[s + 1] * a + 127) / 255;
        data[d + 2] = (src[s + 2] * a + 127) / 255;
        data[d + 3] = a;
      }
    }
    this._texture.needsUpdate = true;

    this._entries.set(id, {
      id,
      width: w,
      height: h,
      pixelRatio: options.pixelRatio ?? 1,
      sdf: options.sdf ?? false,
      stretchX: options.stretchX?.length ? options.stretchX : [[0, w]],
      stretchY: options.stretchY?.length ? options.stretchY : [[0, h]],
      content: options.content,
      px: ox,
      py: oy,
    });
  }

  /** @returns Top-left texel of a free `w` x `h` slot, growing the texture if needed. */
  private _allocate(w: number, h: number): [number, number] {
    if (w > this._maxSize || h > this._maxSize) {
      throw new RangeError(`ImageAtlas: a ${w} x ${h} image exceeds the ${this._maxSize} px texture limit`);
    }
    while (w > this._width) this._grow(this._width * 2, this._height);
    if (this._shelfX + w > this._width) {
      this._shelfY += this._shelfH;
      this._shelfX = 0;
      this._shelfH = 0;
    }
    while (this._shelfY + Math.max(this._shelfH, h) > this._height) this._grow(this._width, this._height * 2);
    const at: [number, number] = [this._shelfX, this._shelfY];
    this._shelfX += w;
    this._shelfH = Math.max(this._shelfH, h);
    return at;
  }

  /** @throws {RangeError} Past the device limit. */
  private _grow(width: number, height: number) {
    if (width > this._maxSize || height > this._maxSize) {
      throw new RangeError(`ImageAtlas: full at ${this._width} x ${this._height}, the device limit`);
    }
    const data = new Uint8Array(width * height * 4);
    for (let row = 0; row < this._height; row++) {
      data.set(this._data.subarray(row * this._width * 4, (row + 1) * this._width * 4), row * width * 4);
    }
    this._data = data;
    this._width = width;
    this._height = height;
    this._texture.dispose();
    this._texture = this._makeTexture();
    this._replaced = true;
  }

  private _makeTexture(): DataTexture {
    const texture = new DataTexture(this._data, this._width, this._height, RGBAFormat, UnsignedByteType);
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }
}

/** RGBA bytes of an image, not premultiplied. */
function readPixels(image: ImageSource): { width: number; height: number; data: Uint8Array | Uint8ClampedArray } {
  if ('data' in image) return image;
  const { width, height } = image;
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('ImageAtlas: no 2D canvas context to read the image');
  ctx.drawImage(image as CanvasImageSource, 0, 0);
  return ctx.getImageData(0, 0, width, height);
}
