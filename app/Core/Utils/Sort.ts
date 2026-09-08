const EMPTY = new Int32Array(0);

/** Above 31 bits a quantised key overflows the int32 sign bit `>>` reads. */
const MAX_KEY_BITS = 31;

/** Beyond 2^16 slots the histogram stops fitting in cache. */
const MAX_DIGIT_BITS = 16;

/**
 * @description Least-significant-digit radix sort returning a permutation of
 * indices instead of reordering its input. `O(passes * n)` with no comparisons,
 * which beats a comparison sort from the low thousands up.
 *
 * Keys are quantised into `keyBits` by mapping the batch's own `[min, max]`
 * onto it, so the order is approximate — keys within
 * `(max - min) / 2 ** keyBits` keep their input order — and orders from two
 * calls are not comparable. Ties come out in ascending index order.
 *
 * @example
 * ```ts
 * const sorter = new RadixSorter(20, 10);
 * const order = sorter.sort(distances, count);
 * for (let i = 0; i < count; i++) visit(items[order[i]]); // nearest first
 * ```
 */
export class RadixSorter {
  private readonly _digitBits: number;
  private readonly _radix: number;
  private readonly _digitMask: number;
  private readonly _keyMax: number;
  private readonly _passes: number;

  /** One histogram of `_radix` slots per pass, laid out end to end. */
  private readonly _histograms: Int32Array;

  /** Quantised keys, indexed by input position. */
  private _quantised = new Int32Array(0);

  /**
   * Ping-pong index buffers. `_indicesSrc` holds the result once
   * {@link RadixSorter.sort} returns.
   */
  private _indicesSrc = new Int32Array(0);
  private _indicesDst = new Int32Array(0);

  /**
   * @param keyBits - Precision of the quantised key, from 1 to
   * {@link MAX_KEY_BITS}. This is the total width the passes cover.
   * @param digitBits - Bits consumed per pass, from 1 to
   * {@link MAX_DIGIT_BITS}, and no more than `keyBits`. Fewer bits means more
   * passes over the data but a smaller histogram.
   *
   * @throws {Error} If either argument is not an integer within its range, or
   * if `digitBits` exceeds `keyBits`.
   */
  constructor(keyBits = 20, digitBits = 10) {
    assertBitCount('keyBits', keyBits, MAX_KEY_BITS);
    assertBitCount('digitBits', digitBits, MAX_DIGIT_BITS);
    if (digitBits > keyBits) {
      throw new Error(`digitBits (${digitBits}) cannot be greater than keyBits (${keyBits}).`);
    }

    this._digitBits = digitBits;
    this._radix = 1 << digitBits;
    this._digitMask = this._radix - 1;
    this._keyMax = 2 ** keyBits - 1;

    this._passes = Math.ceil(keyBits / digitBits);
    this._histograms = new Int32Array(this._passes * this._radix);
  }

  /**
   * Order the first `n` keys without moving them.
   *
   * @returns Indices `0` to `n - 1` by ascending key. Reused buffer: `length`
   * is the capacity, not `n`, and the next call overwrites it.
   *
   * @throws {RangeError} If no key in the range is finite. A NaN among finite
   * keys is tolerated, quantising to `0`.
   */
  sort(keys: ArrayLike<number>, n = keys.length): Int32Array {
    if (n <= 0) return EMPTY;
    this._ensureCapacity(n);
    if (n === 1) return this._identity(1);

    // Quantising needs the key range up front, hence one extra read of `keys`.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const k = keys[i];
      if (k < lo) lo = k;
      if (k > hi) hi = k;
    }

    const range = hi - lo;
    if (!Number.isFinite(range)) {
      throw new RangeError(
        `RadixSorter.sort: keys must be finite and not all NaN (observed range ${lo}..${hi})`,
      );
    }
    // All keys equal: already ordered, and `scale` would be Infinity.
    if (range === 0) return this._identity(n);

    const digitBits = this._digitBits;
    const radix = this._radix;
    const mask = this._digitMask;
    const quantised = this._quantised;
    const histograms = this._histograms;
    const histogramEnd = this._passes * radix;

    // Quantise, and tally every pass's histogram in the same data read.
    const scale = this._keyMax / range;
    histograms.fill(0);
    for (let i = 0; i < n; i++) {
      const key = ((keys[i] - lo) * scale) | 0;
      quantised[i] = key;
      for (let base = 0, shift = 0; base < histogramEnd; base += radix, shift += digitBits) {
        histograms[base + ((key >> shift) & mask)]++;
      }
    }

    // Exclusive prefix sum per pass: each slot becomes the first output
    // position for its digit, and is bumped as that digit is emitted.
    for (let base = 0; base < histogramEnd; base += radix) {
      let slot = 0;
      for (let digit = base, end = base + radix; digit < end; digit++) {
        const count = histograms[digit];
        histograms[digit] = slot;
        slot += count;
      }
    }

    let src = this._indicesSrc;
    let dst = this._indicesDst;

    // Pass 0 permutes the implicit identity order, so it reads `quantised`
    // sequentially instead of through `src` and needs no initialised source.
    for (let i = 0; i < n; i++) {
      dst[histograms[quantised[i] & mask]++] = i;
    }
    [src, dst] = [dst, src];

    // Remaining passes reorder the previous pass's output. Each is stable, so
    // ordering by the least significant digit first leaves `src` fully sorted.
    for (let base = radix, shift = digitBits; base < histogramEnd; base += radix, shift += digitBits) {
      for (let i = 0; i < n; i++) {
        const index = src[i];
        dst[histograms[base + ((quantised[index] >> shift) & mask)]++] = index;
      }
      [src, dst] = [dst, src];
    }

    this._indicesSrc = src;
    this._indicesDst = dst;
    return src;
  }

  /** Identity permutation: the answer when the keys carry no order. */
  private _identity(n: number): Int32Array {
    const src = this._indicesSrc;
    for (let i = 0; i < n; i++) {
      src[i] = i;
    }
    return src;
  }

  /**
   * Grow the working buffers to at least `n`, geometrically. Contents are not
   * preserved — `sort` rewrites every entry it reads.
   */
  private _ensureCapacity(n: number): void {
    if (this._quantised.length >= n) return;
    const capacity = Math.max(n, this._quantised.length * 2);
    this._quantised = new Int32Array(capacity);
    this._indicesSrc = new Int32Array(capacity);
    this._indicesDst = new Int32Array(capacity);
  }
}

// Utils

/** @throws {Error} If `value` is not an integer between 1 and `max`. */
function assertBitCount(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`Invalid ${name}: ${value}. Must be an integer between 1 and ${max}.`);
  }
}
