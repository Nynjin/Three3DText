/**
 * Packed-bit screen occupancy grid: one bit per cell, 32 cells per word, rows
 * padded to a whole word. A cell covers `downscale` × `downscale` px.
 *
 * Rectangles in px, inclusive on both ends. A region claims every cell it touches.
 */
export class BitmapOccupancy {
  private readonly _shift: number;

  private _width = 1;
  private _height = 1;
  private _wordsPerRow = 1;
  private _bits = new Uint32Array(1);

  /**
   * @param downscale - Cell size per axis, in CSS px.
   *
   * @throws {Error} If `downscale` is not a power-of-two integer >= 1.
   */
  constructor(downscale = 1) {
    if (!Number.isInteger(downscale) || downscale < 1 || (downscale & (downscale - 1)) !== 0) {
      throw new Error(`downscale must be a power-of-two integer >= 1, got ${downscale}`);
    }
    this._shift = Math.log2(downscale);
  }

  /**
   * Match the grid to a screen size. Reallocates only when the cell dimensions change.
   *
   * @param screenW - In CSS px.
   * @param screenH - In CSS px.
   *
   * @returns `true` if the grid was resized, which clears every claim.
   */
  resize(screenW: number, screenH: number): boolean {
    const cell = 1 << this._shift;
    const width = Math.max(1, Math.ceil(screenW / cell));
    const height = Math.max(1, Math.ceil(screenH / cell));
    if (width === this._width && height === this._height) return false;

    this._width = width;
    this._height = height;
    this._wordsPerRow = (width + 31) >> 5;
    this._bits = new Uint32Array(this._wordsPerRow * height);
    return true;
  }

  /** Release every claimed cell. Does not reallocate. */
  clear(): void {
    this._bits.fill(0);
  }

  /**
   * Claim an inclusive px rectangle if free, or regardless with `allowOverlap`.
   * A rejected rectangle leaves the grid untouched.
   *
   * @returns `false` if the region was taken (unless `allowOverlap`), inverted, or off the grid.
   */
  tryClaim(x0: number, y0: number, x1: number, y1: number, allowOverlap = false): boolean {
    const cx0 = this._cellLow(Math.floor(x0));
    const cy0 = this._cellLow(Math.floor(y0));
    const cx1 = this._cellHigh(Math.floor(x1), this._width);
    const cy1 = this._cellHigh(Math.floor(y1), this._height);
    // Inverted or wholly off-grid once clamped.
    if (cx0 > cx1 || cy0 > cy1) return false;

    if (!allowOverlap && !this._isRegionEmpty(cx0, cy0, cx1, cy1)) return false;
    this._claim(cx0, cy0, cx1, cy1);
    return true;
  }

  // ─── Internals ────────────────────────────────────────────────────────────
  // Region methods take an inclusive cell rectangle, already clamped to the grid.

  /**
   * Cell of a low edge, from an integer px. Clamps below only; an edge past the
   * far side stays out of range for `tryClaim` to reject.
   */
  private _cellLow(px: number): number {
    return Math.max(0, px >> this._shift);
  }

  /**
   * Cell of a high edge, from an integer px. Clamps above only; an edge before
   * the near side stays negative for `tryClaim` to reject.
   */
  private _cellHigh(px: number, extent: number): number {
    return Math.min(extent - 1, px >> this._shift);
  }

  private _claim(x0: number, y0: number, x1: number, y1: number): void {
    const wordA = (x0 >> 5);
    const wordB = (x1 >> 5);
    const maskA = 0xffffffff << (x0 & 31) >>> 0;
    const maskB = 0xffffffff >>> (31 - (x1 & 31));
    const bits = this._bits;
    const wpr = this._wordsPerRow;

    for (let y = y0; y <= y1; y++) {
      const rowBase = y * wpr;
      if (wordA === wordB) {
        bits[rowBase + wordA] |= maskA & maskB;
      } else {
        bits[rowBase + wordA] |= maskA;
        for (let w = wordA + 1; w < wordB; w++) {
          bits[rowBase + w] = 0xffffffff;
        }
        bits[rowBase + wordB] |= maskB;
      }
    }
  }

  private _isRegionEmpty(x0: number, y0: number, x1: number, y1: number): boolean {
    const wordA = (x0 >> 5);
    const wordB = (x1 >> 5);
    const maskA = 0xffffffff << (x0 & 31) >>> 0;
    const maskB = 0xffffffff >>> (31 - (x1 & 31));
    const bits = this._bits;
    const wpr = this._wordsPerRow;

    for (let y = y0; y <= y1; y++) {
      const rowBase = y * wpr;
      if (wordA === wordB) {
        if ((bits[rowBase + wordA] & (maskA & maskB)) !== 0) return false;
      } else {
        if ((bits[rowBase + wordA] & maskA) !== 0) return false;
        for (let w = wordA + 1; w < wordB; w++) {
          if (bits[rowBase + w] !== 0) return false;
        }
        if ((bits[rowBase + wordB] & maskB) !== 0) return false;
      }
    }
    return true;
  }
}
