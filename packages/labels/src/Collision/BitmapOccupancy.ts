/**
 * Packed-bit screen occupancy grid: one bit per cell, 32 cells per word, each
 * row padded to a whole word. A cell covers `downscale` × `downscale` pixels.
 *
 * Rectangles are in pixels, inclusive on both ends. Both edges map to the cell
 * that contains them, so a region claims exactly the cells it touches.
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
   * Claim an inclusive pixel rectangle if at most `tolerance` of it (a fraction
   * in [0, 1], 0 for no overlap) is already claimed. A rejected rectangle leaves
   * the grid untouched.
   *
   * @returns `false` if the region was too crowded, inverted, or off the grid.
   *
   * @throws {Error} If `tolerance` is outside `[0, 1]`, NaN included.
   */
  tryClaim(x0: number, y0: number, x1: number, y1: number, tolerance = 0): boolean {
    // Positive form so NaN is rejected; it would otherwise reject every region.
    if (!(tolerance >= 0 && tolerance <= 1)) {
      throw new Error(`tolerance must be in [0, 1], got ${tolerance}`);
    }

    const cx0 = this._cellLow(Math.floor(x0));
    const cy0 = this._cellLow(Math.floor(y0));
    const cx1 = this._cellHigh(Math.floor(x1), this._width);
    const cy1 = this._cellHigh(Math.floor(y1), this._height);
    // Inverted or wholly off-grid once clamped.
    if (cx0 > cx1 || cy0 > cy1) return false;

    // `claimed <= floor(tolerance * area)` is the same test as
    // `claimed / area <= tolerance`, since `claimed` is a whole number.
    const limit = Math.floor(tolerance * (cx1 - cx0 + 1) * (cy1 - cy0 + 1));

    // A zero limit only needs to find one set bit, not count them.
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
   * Cell holding a rectangle's low edge, from an integer pixel. Clamps the lower
   * bound only, leaving an edge past the far side out of range for `tryClaim`
   * to reject.
   */
  private _cellLow(px: number): number {
    return Math.max(0, px >> this._shift);
  }

  /**
   * Cell holding a rectangle's high edge, from an integer pixel. Clamps the
   * upper bound only, leaving an edge before the near side negative for
   * `tryClaim` to reject.
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
   * True if at most `limit` cells in the rectangle are claimed. Stops once the
   * unread rows cannot change the answer.
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
