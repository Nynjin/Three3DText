/**
 * @description Single-layer packed-bit screen occupancy grid.
 *
 * One bit per cell, 32 cells per word, each row padded up to a whole word. A
 * cell covers `downscale` × `downscale` screen pixels, so a 1080p viewport at
 * `downscale = 4` is a 480 × 270 grid costing 16 KiB. Row padding rounds that
 * up whenever the cell width is not a multiple of 32.
 *
 * Rectangles are given in **screen pixels, inclusive on both ends**. Both
 * edges map to the cell that contains them, so a region claims exactly the
 * cells it touches and no gutter is added; callers wanting one must build it
 * into the rectangle.
 *
 * @example
 * ```ts
 * const grid = new BitmapOccupancy(4);
 * grid.resize(canvas.width, canvas.height);
 * grid.clear();                                       // once per frame
 * if (grid.tryClaim(x0, y0, x1, y1, 0.1)) draw(label); // nearest label first
 * ```
 *
 * @see {@link BitmapOccupancy.tryClaim} for the test-and-set contract.
 */
export class BitmapOccupancy {
  private readonly _shift: number;

  private _width = 1;
  private _height = 1;
  private _wordsPerRow = 1;
  private _bits = new Uint32Array(1);

  /**
   * @param downscale - Screen pixels per cell edge. Must be a power of two.
   *
   * @throws {Error} If `downscale` is not a power-of-two integer of at least 1.
   */
  constructor(downscale = 1) {
    if (!Number.isInteger(downscale) || downscale < 1 || (downscale & (downscale - 1)) !== 0) {
      throw new Error(`downscale must be a power-of-two integer >= 1, got ${downscale}`);
    }
    this._shift = Math.log2(downscale);
  }

  /**
   * Match the grid to a screen size, reallocating and clearing only when the
   * cell dimensions actually change.
   *
   * @param screenW - Viewport width in pixels.
   * @param screenH - Viewport height in pixels.
   *
   * @returns `true` if the grid was resized, meaning every previously claimed
   * region is gone and callers must re-evaluate.
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
   * Claim a rectangle if little enough of it is already claimed.
   *
   * A rejected rectangle leaves the grid untouched, so callers can walk regions
   * in priority order and let the first one to ask win.
   *
   * @param x0 - Left edge in screen pixels, inclusive.
   * @param y0 - Top edge in screen pixels, inclusive.
   * @param x1 - Right edge in screen pixels, inclusive.
   * @param y1 - Bottom edge in screen pixels, inclusive.
   * @param tolerance - Fraction of the region allowed to be claimed already,
   * in [0, 1]. Defaults to 0 (no overlap).
   *
   * @returns `true` if the region was available and is now claimed, `false` if
   * it was too crowded, inverted, or entirely off the grid.
   *
   * @throws {Error} If `tolerance` is outside `[0, 1]`, NaN included.
   */
  tryClaim(x0: number, y0: number, x1: number, y1: number, tolerance = 0): boolean {
    // Positive form so NaN is rejected; it would otherwise reject every region.
    if (!(tolerance >= 0 && tolerance <= 1)) {
      throw new Error(`tolerance must be in [0, 1], got ${tolerance}`);
    }

    const cx0 = this._cellLow(x0);
    const cy0 = this._cellLow(y0);
    const cx1 = this._cellHigh(x1, this._width);
    const cy1 = this._cellHigh(y1, this._height);
    // Inverted or wholly off-grid once clamped.
    if (cx0 > cx1 || cy0 > cy1) return false;

    // `claimed <= floor(tolerance * area)` is the same test as
    // `claimed / area <= tolerance`, since `claimed` is a whole number.
    const limit = Math.floor(tolerance * (cx1 - cx0 + 1) * (cy1 - cy0 + 1));

    // A zero limit only needs to find one set bit, which the popcount scan
    // would pay for word by word.
    const available = limit === 0
      ? this._isRegionEmpty(cx0, cy0, cx1, cy1)
      : this._isRegionWithinTolerance(cx0, cy0, cx1, cy1, limit);
    if (!available) return false;

    this._claim(cx0, cy0, cx1, cy1);
    return true;
  }

  // ─── Internals ────────────────────────────────────────────────────────────
  // The three region methods take an inclusive cell rectangle, not pixels, and
  // assume it has already been clamped to the grid.

  /**
   * Cell holding a rectangle's low edge. Clamps the lower bound only, leaving
   * an edge past the far side out of range for `tryClaim` to reject.
   */
  private _cellLow(px: number): number {
    return Math.max(0, px >> this._shift);
  }

  /**
   * Cell holding a rectangle's high edge. Clamps the upper bound only, leaving
   * an edge before the near side negative for `tryClaim` to reject.
   */
  private _cellHigh(px: number, extent: number): number {
    return Math.min(extent - 1, px >> this._shift);
  }

  /** Set every bit in the rectangle. */
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

  /**
   * True if no cell in the rectangle is claimed, bailing on the first word
   * that has a bit set inside it.
   */
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

  /**
   * True if at most `limit` cells in the rectangle are claimed.
   *
   * Counts row by row and stops as soon as the answer is settled: once
   * `claimed` passes `limit` it can only grow, and once even a fully claimed
   * remainder would stay inside `limit` the rest need not be read.
   */
  private _isRegionWithinTolerance(x0: number, y0: number, x1: number, y1: number, limit: number): boolean {
    const wordA = (x0 >> 5);
    const wordB = (x1 >> 5);
    const maskA = 0xffffffff << (x0 & 31) >>> 0;
    const maskB = 0xffffffff >>> (31 - (x1 & 31));
    const bits = this._bits;
    const wpr = this._wordsPerRow;
    const perRow = (x1 - x0 + 1);

    let claimed = 0;
    let remaining = perRow * (y1 - y0 + 1);

    for (let y = y0; y <= y1; y++) {
      const rowBase = y * wpr;
      if (wordA === wordB) {
        claimed += popcount32(bits[rowBase + wordA] & (maskA & maskB));
      } else {
        claimed += popcount32(bits[rowBase + wordA] & maskA);
        for (let w = wordA + 1; w < wordB; w++) {
          claimed += popcount32(bits[rowBase + w]);
        }
        claimed += popcount32(bits[rowBase + wordB] & maskB);
      }
      remaining -= perRow;
      if (claimed > limit) return false;
      if (claimed + remaining <= limit) return true;
    }
    return claimed <= limit;
  }
}

// Utils

/**
 * @param v - Any 32-bit value.
 *
 * @returns How many of its bits are set.
 */
function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
