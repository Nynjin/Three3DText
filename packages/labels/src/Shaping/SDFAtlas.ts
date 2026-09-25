import TinySDF from '@mapbox/tiny-sdf';
import { DataTexture, LinearFilter, RedFormat, UnsignedByteType } from 'three';
import { fontKeyStr, glyphKey, glyphKeyPrefix, type FontKey } from './FontKey';
import type { AtlasMetrics, GlyphInfo, GlyphResolver } from './GlyphRun';

/** Character every font the atlas knows is rasterized with; a lookup miss resolves to it. */
export const FALLBACK_CHAR = '?';

/**
 * Distance encoded outside the glyph, as a fraction of the em. It caps how far
 * a halo can reach, and it is how far each glyph bitmap overruns its ink.
 */
const BUFFER_EM = 0.25;

/**
 * Distance, in raster pixels, the field carries outside the ink.
 *
 * @param fontSize - Raster font size, {@link SDFAtlasOptions.fontSize}.
 */
export function sdfBuffer(fontSize: number): number {
  return Math.max(2, Math.round(fontSize * BUFFER_EM));
}

/**
 * Columns of the square glyph grid to grow to: room for `glyphs` times
 * `multiplier`, or the widest grid `maxSize` allows when that does not fit.
 *
 * @param glyphs - Glyphs the grid has to hold.
 * @param multiplier - Headroom, at least 1.
 * @param cellSize - Side of one glyph cell, in texels.
 * @param maxSize - Largest texture side, in texels.
 */
function atlasColumns(glyphs: number, multiplier: number, cellSize: number, maxSize: number): number {
  const wanted = Math.ceil(Math.sqrt(Math.ceil(glyphs * multiplier)));
  return Math.max(1, Math.min(wanted, Math.floor(maxSize / cellSize)));
}

export interface SDFAtlasOptions {
  /** Raster font size, in CSS px. */
  fontSize: number;
  /** Headroom on a resize, at least 1: room is made for this many times the glyphs needed. */
  capacityMultiplier: number;
  /** Largest texture side, in texels. */
  maxSize: number;
}

export interface FontChars {
  fontKey: FontKey;
  /** Characters needed, split as layout splits the text. A partial set is fine. */
  chars: Iterable<string>;
}

/**
 * One single-channel distance-field texture holding the glyphs of every font,
 * keyed by font and character. Glyphs are rasterized once and never freed.
 * Once the texture reaches the device's size limit and every slot is taken, a
 * new character resolves to its font's {@link FALLBACK_CHAR}, and a warning is
 * logged once.
 */
export class SDFAtlas {
  private _texture: DataTexture = new DataTexture(new Uint8Array(1), 1, 1, RedFormat, UnsignedByteType);
  readonly glyphs = new Map<string, GlyphInfo>();

  /** Replaced, and the previous one disposed, whenever the atlas grows. */
  get texture(): DataTexture {
    return this._texture;
  }

  /** Raster font size, in CSS px. */
  readonly fontSize: number;
  /** Field distance outside the ink, in raster px. */
  readonly buffer: number;
  /** tiny-sdf's cutoff: the field reads `1 - cutoff` at the ink edge, so this share of its range lies inside the ink. */
  readonly cutoff: number;
  /** Distance, in raster px, over which the field runs from 0 to 1. */
  readonly radius: number;

  /** What layout needs to read {@link glyphs}. */
  readonly metrics: AtlasMetrics;

  private _data: Uint8Array = new Uint8Array(1);
  private _width = 1;
  private readonly _cellSize: number;
  private _cols = 0;
  private _capacity = 0;
  private _slotCount = 0;
  private _warnedFull = false;

  private readonly _capacityMultiplier: number;
  private readonly _maxSize: number;

  private readonly _fontToSDF = new Map<string, TinySDF>();

  /**
   * @throws {RangeError} If `capacityMultiplier` is below 1.
   */
  constructor(options: SDFAtlasOptions) {
    const { fontSize, capacityMultiplier, maxSize } = options;
    if (!(capacityMultiplier >= 1)) {
      throw new RangeError(`SDFAtlas: capacityMultiplier must be at least 1, got ${capacityMultiplier}`);
    }
    this.fontSize = fontSize;
    this._capacityMultiplier = capacityMultiplier;
    this._maxSize = maxSize;

    this.buffer = sdfBuffer(fontSize);
    // The field spans `radius * cutoff` px inside the ink and
    // `radius * (1 - cutoff)` outside; at 0.495 both come to about `buffer`.
    this.cutoff = 0.495;
    this.radius = Math.ceil(this.buffer / (1 - this.cutoff));
    // tiny-sdf rasterizes into a canvas of fontSize + 4 * buffer and allows a
    // glyph one further buffer beyond it, so fontSize + 5 * buffer is the
    // largest bitmap it can hand back. A smaller cell bleeds into the next.
    this._cellSize = fontSize + this.buffer * 5;

    this.metrics = {
      fontSize,
      padding: this.buffer * 2,
    };
  }

  /**
   * Rasterize any `(font, char)` pair not in the atlas yet, plus
   * {@link FALLBACK_CHAR} for each font. Glyphs are rasterized with whatever
   * font the canvas resolves at call time, so a web font has to be loaded
   * before its first characters arrive.
   *
   * @returns `dirty` if the texture contents changed; `resize` if the atlas grew,
   * which moves every existing glyph and replaces {@link texture}.
   */
  setChars(fontChars: FontChars[]): {
    dirty: boolean;
    resize: boolean;
  } {
    const newGlyphs: { char: string; fontKey: FontKey }[] = [];
    const queue = (fontKey: FontKey, c: string) => {
      if (!this.glyphs.has(glyphKey(fontKey, c))) newGlyphs.push({ char: c, fontKey });
    };

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
        queue(fontKey, FALLBACK_CHAR);
      }

      for (const c of chars) queue(fontKey, c);
    }

    if (newGlyphs.length === 0) return { dirty: false, resize: false };

    const needed = this._slotCount + newGlyphs.length;
    const resize = needed > this._capacity && this._resize(needed);
    const drawn = this._drawChars(newGlyphs);
    if (drawn === 0 && !resize) return { dirty: false, resize: false };
    this._texture.needsUpdate = true;

    return { dirty: true, resize };
  }

  /**
   * Binds a lookup to one font. A character the font has no entry for resolves
   * to {@link FALLBACK_CHAR}, or to a blank glyph if the atlas was full before
   * the font's fallback was drawn. Entries are the atlas's own: `px` and `py`
   * change when it grows.
   *
   * @throws {Error} If no {@link setChars} call has registered `fontKey`.
   */
  resolverFor(fontKey: FontKey): GlyphResolver {
    if (!this._fontToSDF.has(fontKeyStr(fontKey))) {
      throw new Error(`SDFAtlas: font ${fontKeyStr(fontKey)} was never passed to setChars`);
    }
    const prefix = glyphKeyPrefix(fontKey);
    const fallback = this.glyphs.get(prefix + FALLBACK_CHAR) ?? BLANK;
    return (char: string) => this.glyphs.get(prefix + char) ?? fallback;
  }

  /**
   * Rasterizes glyphs into the next free slots and records their metrics.
   * Entries already present are skipped. A glyph with no ink, such as a space,
   * takes no slot; one with ink that finds no free slot is dropped.
   *
   * @returns How many glyphs were rasterized into a slot.
   *
   * @throws {Error} If a font has no TinySDF instance registered.
   */
  private _drawChars(entries: { char: string; fontKey: FontKey }[]): number {
    let dropped = 0;
    let drawn = 0;
    for (const { char: c, fontKey } of entries) {
      const key = glyphKey(fontKey, c);
      if (this.glyphs.has(key)) continue;

      const sdf = this._fontToSDF.get(fontKeyStr(fontKey));
      if (!sdf) throw new Error(`SDFAtlas: No TinySDF for fontKey ${fontKeyStr(fontKey)}`);

      const g = sdf.draw(c);

      if (g.glyphWidth === 0 || g.glyphHeight === 0) {
        this.glyphs.set(key, { px: 0, py: 0, pw: 0, ph: 0, w: 0, h: 0, left: 0, top: 0, advance: g.glyphAdvance });
        continue;
      }

      if (this._slotCount >= this._capacity) {
        dropped++;
        continue;
      }
      const slot = this._slotCount++;
      drawn++;
      const x = (slot % this._cols) * this._cellSize;
      const y = Math.floor(slot / this._cols) * this._cellSize;
      this._blit(g.data, x, y, g.width, g.height);

      // tiny-sdf draws the pen at column `buffer - glyphLeft` and the baseline
      // at row `buffer + glyphTop` of the bitmap.
      this.glyphs.set(key, {
        px: x,
        py: y,
        pw: g.width,
        ph: g.height,
        w: g.width,
        h: g.height,
        left: g.glyphLeft - this.buffer,
        top: g.glyphTop + this.buffer,
        advance: g.glyphAdvance,
      });
    }

    if (dropped > 0 && !this._warnedFull) {
      this._warnedFull = true;
      console.warn(
        `SDFAtlas: full at ${this._width} px, the device limit; ${dropped} characters draw as "${FALLBACK_CHAR}" from here on`,
      );
    }
    return drawn;
  }

  /** Releases the GPU texture. The atlas is unusable afterwards. */
  dispose() {
    this._texture.dispose();
  }

  /**
   * Copies a rasterized glyph into the atlas data, row by row.
   *
   * @param src - Single-channel distance field, `w * h` bytes.
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
   * Grows the grid towards `minChars` glyphs times the capacity multiplier,
   * capped at the widest grid `maxSize` allows. Existing glyphs are re-laid out
   * into the new grid, so their slots change.
   *
   * @returns `false` if the grid is already as wide as it can get.
   */
  private _resize(minChars: number): boolean {
    const cols = atlasColumns(minChars, this._capacityMultiplier, this._cellSize, this._maxSize);
    if (cols <= this._cols) return false;
    const newSize = cols * this._cellSize;
    this._capacity = cols * cols;
    this._cols = cols;

    const oldData = this._data;
    const oldWidth = this._width;
    const newData = new Uint8Array(newSize * newSize);

    let slot = 0;
    for (const g of this.glyphs.values()) {
      if (g.pw === 0) continue;
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
    // No mipmaps: averaging a distance field across a thin stem erodes it.
    this._texture.generateMipmaps = false;
    this._texture.minFilter = LinearFilter;
    this._texture.magFilter = LinearFilter;
    this._texture.needsUpdate = true;
    return true;
  }
}

const BLANK: GlyphInfo = { px: 0, py: 0, pw: 0, ph: 0, w: 0, h: 0, left: 0, top: 0, advance: 0 };
