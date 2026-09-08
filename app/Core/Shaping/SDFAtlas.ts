import TinySDF from '@mapbox/tiny-sdf';
import { DataTexture, LinearFilter, RedFormat, UnsignedByteType } from 'three';
import { fontKeyStr, glyphKey, glyphKeyPrefix, type FontKey } from './FontKey';
import type { AtlasMetrics, GlyphInfo, GlyphResolver } from '../Shaping/GlyphRun';

/** Character every font is rasterized with, used when a lookup misses. */
export const FALLBACK_CHAR = '?';

export interface SDFAtlasOptions {
  /** Font size (px) at which glyphs are rasterized. */
  fontSize: number;
  /** SDF oversampling multiplier. */
  scale: number;
  /** Slot pre-allocation growth factor. */
  capacityMultiplier: number;
}

export interface FontChars {
  fontKey: FontKey;
  chars: Iterable<string>;
}

export class SDFAtlas {
  private _texture: DataTexture = new DataTexture(new Uint8Array(1), 1, 1, RedFormat, UnsignedByteType);
  readonly glyphs = new Map<string, GlyphInfo>();

  get texture(): DataTexture {
    return this._texture;
  }

  readonly fontSize: number;
  readonly buffer: number;
  readonly cutoff: number;
  readonly radius: number;

  /**
   * What layout needs to read {@link glyphs}. Held as one object so it can be
   * passed per label without allocating.
   */
  readonly metrics: AtlasMetrics;

  private _data: Uint8Array = new Uint8Array(1);
  private _width = 1;
  private _cellSize: number;
  private _cols = 0;
  private _capacity = 0;
  private _slotCount = 0;

  private readonly _scale: number;
  private readonly _capacityMultiplier: number;

  private readonly _fontToSDF = new Map<string, TinySDF>();

  constructor(options: SDFAtlasOptions) {
    const { fontSize, scale, capacityMultiplier } = options;
    this.fontSize = fontSize;
    this._scale = scale;
    this._capacityMultiplier = capacityMultiplier;

    this.buffer = Math.ceil(fontSize * scale * 0.5);
    this.radius = this.buffer;
    this.cutoff = 0.495;
    this._cellSize = fontSize * scale + this.buffer * 2;

    // _drawChars divides raster px by `scale`, so stored metrics are in an em of
    // `fontSize / scale`, and the SDF buffer padding scales down with them.
    // TinySDF returns `glyphWidth + 2 * buffer`, hence padding = 2 * buffer.
    this.metrics = {
      fontSize: fontSize / scale,
      padding: (this.buffer * 2) / scale,
    };
  }

  /**
   * Rasterize any `(font, char)` pair not in the atlas yet. Existing glyphs are
   * never re-rasterized and their slots are never freed.
   *
   * @param fontChars - The characters each font needs, as a whole.
   *
   * @returns `dirty` if the texture contents changed, `resize` if the atlas grew
   * and every existing glyph moved — which invalidates any cached glyph UVs.
   */
  setChars(fontChars: FontChars[]): {
    dirty: boolean;
    resize: boolean;
  } {
    const newGlyphs: { char: string; fontKey: FontKey }[] = [];

    for (const { fontKey, chars } of fontChars) {
      const fk = fontKeyStr(fontKey);
      if (!this._fontToSDF.has(fk)) {
        this._fontToSDF.set(fk, new TinySDF({
          fontSize: this.fontSize,
          fontFamily: fontKey.font,
          fontWeight: fontKey.weight,
          fontStyle: fontKey.style,
          buffer: this.buffer,
          radius: this.radius,
          cutoff: this.cutoff,
        }));
      }

      for (const c of chars) {
        if (!this.glyphs.has(glyphKey(fontKey, c))) {
          newGlyphs.push({ char: c, fontKey });
        }
      }
    }

    if (newGlyphs.length === 0) return { dirty: false, resize: false };

    const resize = this._slotCount + newGlyphs.length > this._capacity;
    if (resize) this._resize(this._slotCount + newGlyphs.length);
    this._drawChars(newGlyphs);
    this._texture.needsUpdate = true;

    return { dirty: true, resize };
  }

  /**
   * Binds a lookup to one font. The key prefix is built once here rather than
   * per character, and {@link FALLBACK_CHAR} covers characters this font never
   * rasterized.
   */
  resolverFor(fontKey: FontKey): GlyphResolver {
    const prefix = glyphKeyPrefix(fontKey);
    const fallback = this.glyphs.get(prefix + FALLBACK_CHAR);
    if (!fallback) {
      throw new Error(`SDFAtlas: no "${FALLBACK_CHAR}" glyph for ${fontKeyStr(fontKey)}`);
    }
    return (char: string) => this.glyphs.get(prefix + char) ?? fallback;
  }

  /**
   * Rasterizes glyphs into the next free slots and records their atlas metrics.
   * Assumes the atlas already has room; entries already present are skipped.
   *
   * @param entries - The `(font, char)` pairs to rasterize.
   *
   * @throws {Error} If a font has no TinySDF instance registered.
   */
  private _drawChars(entries: { char: string; fontKey: FontKey }[]) {
    for (const { char: c, fontKey } of entries) {
      const key = glyphKey(fontKey, c);
      if (this.glyphs.has(key)) continue;

      const sdf = this._fontToSDF.get(fontKeyStr(fontKey));
      if (!sdf) throw new Error(`SDFAtlas: No TinySDF for fontKey ${fontKeyStr(fontKey)}`);

      const slot = this._slotCount++;
      const x = (slot % this._cols) * this._cellSize;
      const y = Math.floor(slot / this._cols) * this._cellSize;
      const g = sdf.draw(c);

      if (g.width > 0 && g.height > 0) {
        this._blit(g.data, x, y, g.width, g.height);
      }

      this.glyphs.set(key, {
        px: x,
        py: y,
        pw: g.width,
        ph: g.height,
        w: g.width / this._scale || 1,
        h: g.height / this._scale || 1,
        advance: g.glyphAdvance / this._scale || 1,
        top: g.glyphTop / this._scale || 0,
      });
    }
  }

  /** Releases the GPU texture. The atlas is unusable afterwards. */
  dispose() {
    this._texture.dispose();
  }

  /**
   * Copies a rasterized glyph into the atlas data, row by row.
   *
   * @param src - Single-channel glyph coverage, `w * h` bytes.
   * @param dx - Destination column.
   * @param dy - Destination row.
   * @param w - Glyph width.
   * @param h - Glyph height.
   */
  private _blit(src: Uint8ClampedArray, dx: number, dy: number, w: number, h: number) {
    for (let row = 0; row < h; row++) {
      this._data.set(
        src.subarray(row * w, (row + 1) * w),
        (dy + row) * this._width + dx,
      );
    }
  }

  /**
   * Grows the atlas to hold at least `minChars` glyphs, `capacityMultiplier`
   * over that so the next few additions are free. Existing glyphs are re-laid
   * out into the new grid, so their slots change.
   *
   * @param minChars - Glyph count the new size has to cover.
   */
  private _resize(minChars: number) {
    this._capacity = Math.ceil(minChars * this._capacityMultiplier);
    this._cols = Math.ceil(Math.sqrt(this._capacity));
    const rows = Math.ceil(this._capacity / this._cols);

    const newSize = nextPow2(Math.max(
      this._cols * this._cellSize,
      rows * this._cellSize,
    ));

    const oldData = this._data;
    const oldWidth = this._width;
    const newData = new Uint8Array(newSize * newSize);

    let slot = 0;
    for (const [, g] of this.glyphs) {
      const newX = (slot % this._cols) * this._cellSize;
      const newY = Math.floor(slot / this._cols) * this._cellSize;

      for (let row = 0; row < g.ph; row++) {
        const srcOff = (g.py + row) * oldWidth + g.px;
        newData.set(oldData.subarray(srcOff, srcOff + g.pw), (newY + row) * newSize + newX);
      }

      g.px = newX;
      g.py = newY;
      slot++;
    }

    this._data = newData;
    this._width = newSize;

    this._texture.dispose();
    this._texture = new DataTexture(newData, newSize, newSize, RedFormat, UnsignedByteType);
    this._texture.flipY = false;
    this._texture.generateMipmaps = false;
    this._texture.minFilter = LinearFilter;
    this._texture.magFilter = LinearFilter;
    this._texture.needsUpdate = true;
  }
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}
