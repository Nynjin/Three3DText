import TinySDF from '@mapbox/tiny-sdf';
import { DataTexture, LinearFilter, RedFormat, UnsignedByteType } from 'three';
import { canvasFontFamily, fontKeyStr, type FontKey } from './FontKey';
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

/** Room made on growth, as a multiple of the glyphs needed. */
const CAPACITY_MULTIPLIER = 1.5;

/** Texture rows queued between uploads, past which the whole texture is sent. */
const MAX_UPLOAD_ROWS = 4096;

export interface SDFAtlasOptions {
  /** Raster font size, in raster px. */
  fontSize: number;
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
  /** Glyph entries, by font key string then character. */
  private readonly _glyphs = new Map<string, Map<string, GlyphInfo>>();

  /** Replaced, and the previous one disposed, whenever the atlas grows. */
  get texture(): DataTexture {
    return this._texture;
  }

  /** Raster font size, in raster px. */
  readonly fontSize: number;
  /** Field distance outside the ink, in raster px. */
  readonly buffer: number;
  /** tiny-sdf's cutoff: the field reads `1 - cutoff` at the ink edge, so this share of its range lies inside the ink. */
  readonly cutoff: number;
  /** Distance, in raster px, over which the field runs from 0 to 1. */
  readonly radius: number;

  /** What layout needs to read glyph entries. */
  readonly metrics: AtlasMetrics;

  private _data: Uint8Array = new Uint8Array(1);
  private _width = 1;
  private readonly _cellSize: number;
  /** Glyph cells per row: as many as fit the device limit across, set at construction. */
  private readonly _cols: number;
  private _rows = 0;
  private _capacity = 0;
  private _slotCount = 0;
  private _warnedFull = false;

  /** Set until three has uploaded the whole texture, after it was replaced or cleared. */
  private _fullUploadPending = true;
  /** Texture rows queued as update ranges since the last upload. */
  private readonly _queuedRows = new Set<number>();
  /** Texture rows the glyphs drawn by the running `setChars` touched. */
  private _touchedFirstRow = Infinity;
  private _touchedLastRow = -1;

  private readonly _maxSize: number;

  private readonly _fontToSDF = new Map<string, TinySDF>();

  /**
   * @throws {RangeError} If one glyph cell is larger than `maxSize`.
   */
  constructor(options: SDFAtlasOptions) {
    const { fontSize, maxSize } = options;
    this.fontSize = fontSize;
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
    if (this._cellSize > maxSize) {
      throw new RangeError(`SDFAtlas: a ${this._cellSize} px glyph cell exceeds the ${maxSize} px texture limit; lower atlasFontSize`);
    }
    this._cols = Math.floor(maxSize / this._cellSize);

    this.metrics = {
      fontSize,
      padding: this.buffer * 2,
    };
  }

  /** Makes the next upload send the whole texture, dropping any queued rows. */
  private _requestFullUpload() {
    this._fullUploadPending = true;
    this._queuedRows.clear();
    this._texture.clearUpdateRanges();
    this._texture.onUpdate = () => {
      this._fullUploadPending = false;
      this._queuedRows.clear();
    };
    this._texture.needsUpdate = true;
  }

  /**
   * Queues the rows the last draw touched as update ranges: three sends each as
   * one row-wide `texSubImage2D`, reading the single channel as RGBA floats, so a
   * range is `4 * width` long. Past {@link MAX_UPLOAD_ROWS} the whole texture goes.
   */
  private _queueTouchedRows() {
    if (this._fullUploadPending) return;
    for (let row = this._touchedFirstRow; row < this._touchedLastRow; row++) {
      if (this._queuedRows.has(row)) continue;
      this._queuedRows.add(row);
      this._texture.addUpdateRange(row * this._width * 4, this._width * 4);
    }
    if (this._queuedRows.size > MAX_UPLOAD_ROWS) this._requestFullUpload();
  }

  /**
   * Rasterize any `(font, char)` pair not in the atlas yet, plus
   * {@link FALLBACK_CHAR} for each font. Glyphs are rasterized with whatever
   * font the canvas resolves at call time, so a web font has to be loaded
   * before its first characters arrive.
   *
   * @returns `dirty` if the texture contents changed; `resize` if the atlas grew
   * and replaced {@link texture} with a taller one. Existing entries keep their
   * `px` and `py`.
   */
  setChars(fontChars: FontChars[]): {
    dirty: boolean;
    resize: boolean;
  } {
    const newGlyphs: { char: string; fontKey: FontKey }[] = [];
    const queue = (fontKey: FontKey, c: string) => {
      if (!this._fontGlyphs(fontKey).has(c)) newGlyphs.push({ char: c, fontKey });
    };

    for (const { fontKey, chars } of fontChars) {
      const fk = fontKeyStr(fontKey);
      if (!this._fontToSDF.has(fk)) {
        this._fontToSDF.set(fk, new TinySDF({
          fontSize: this.fontSize,
          fontFamily: canvasFontFamily(fontKey.font),
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
    this._touchedFirstRow = Infinity;
    this._touchedLastRow = -1;
    const drawn = this._drawChars(newGlyphs);
    if (drawn === 0 && !resize) return { dirty: false, resize: false };
    this._queueTouchedRows();
    this._texture.needsUpdate = true;

    return { dirty: true, resize };
  }

  /**
   * Binds a lookup to one font. A character the font has no entry for resolves
   * to {@link FALLBACK_CHAR}, or to a blank glyph if the atlas was full before
   * the font's fallback was drawn.
   *
   * @throws {Error} If no {@link setChars} call has registered `fontKey`.
   */
  resolverFor(fontKey: FontKey): GlyphResolver {
    if (!this._fontToSDF.has(fontKeyStr(fontKey))) {
      throw new Error(`SDFAtlas: font ${fontKeyStr(fontKey)} was never passed to setChars`);
    }
    const glyphs = this._fontGlyphs(fontKey);
    const fallback = glyphs.get(FALLBACK_CHAR) ?? BLANK;
    return (char: string) => glyphs.get(char) ?? fallback;
  }

  private _fontGlyphs(fontKey: FontKey): Map<string, GlyphInfo> {
    const key = fontKeyStr(fontKey);
    let glyphs = this._glyphs.get(key);
    if (!glyphs) {
      glyphs = new Map();
      this._glyphs.set(key, glyphs);
    }
    return glyphs;
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
      const glyphs = this._fontGlyphs(fontKey);
      if (glyphs.has(c)) continue;

      const sdf = this._fontToSDF.get(fontKeyStr(fontKey));
      if (!sdf) throw new Error(`SDFAtlas: No TinySDF for fontKey ${fontKeyStr(fontKey)}`);

      const g = sdf.draw(c);

      if (g.glyphWidth === 0 || g.glyphHeight === 0) {
        glyphs.set(c, { px: 0, py: 0, pw: 0, ph: 0, w: 0, h: 0, left: 0, top: 0, advance: g.glyphAdvance });
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
      this._touchedFirstRow = Math.min(this._touchedFirstRow, y);
      this._touchedLastRow = Math.max(this._touchedLastRow, y + g.height);

      // tiny-sdf draws the pen at column `buffer - glyphLeft` and the baseline
      // at row `buffer + glyphTop` of the bitmap.
      glyphs.set(c, {
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
        `SDFAtlas: full at ${this._capacity} glyphs, the device limit; ${dropped} characters draw as "${FALLBACK_CHAR}" from here on`,
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
   * Adds rows of glyph cells towards `minChars` glyphs times the capacity
   * multiplier, capped at the device's texture height. The width never changes,
   * so every existing glyph keeps its position and the old bitmap is the first
   * part of the new one.
   *
   * @returns `false` if the atlas already has every row it can get.
   */
  private _resize(minChars: number): boolean {
    const maxRows = Math.floor(this._maxSize / this._cellSize);
    const wanted = Math.ceil(Math.ceil(minChars * CAPACITY_MULTIPLIER) / this._cols);
    const rows = Math.max(1, Math.min(wanted, maxRows));
    if (rows <= this._rows) return false;

    const width = this._cols * this._cellSize;
    const height = rows * this._cellSize;
    const newData = new Uint8Array(width * height);
    if (this._rows > 0) newData.set(this._data);

    this._rows = rows;
    this._capacity = this._cols * rows;
    this._data = newData;
    this._width = width;

    this._texture.dispose();
    this._texture = new DataTexture(newData, width, height, RedFormat, UnsignedByteType);
    this._texture.flipY = false;
    // No mipmaps: averaging a distance field across a thin stem erodes it.
    this._texture.generateMipmaps = false;
    this._texture.minFilter = LinearFilter;
    this._texture.magFilter = LinearFilter;
    this._requestFullUpload();
    return true;
  }
}

const BLANK: GlyphInfo = { px: 0, py: 0, pw: 0, ph: 0, w: 0, h: 0, left: 0, top: 0, advance: 0 };
