const EMPTY = new Int32Array(0);

/** Above 31 bits a quantised key overflows the int32 sign bit `>>` reads. */
const MAX_KEY_BITS = 31;

/** Largest digit width accepted. */
const MAX_DIGIT_BITS = 16;

/**
 * LSD radix sort returning an index permutation; `keys` is not modified.
 *
 * Keys are quantised to `keyBits` over the batch's own `[min, max]`, so the
 * order is approximate: keys in one bucket, `(max - min) / (2 ** keyBits - 1)`
 * wide, keep input order, and orders from separate calls are not comparable.
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

  /** One `_radix`-slot histogram per pass, end to end. */
  private readonly _histograms: Int32Array;

  /** Quantised keys, by input index. */
  private _quantised = new Int32Array(0);

  /** Ping-pong index buffers; `_indicesSrc` holds the result after {@link RadixSorter.sort}. */
  private _indicesSrc = new Int32Array(0);
  private _indicesDst = new Int32Array(0);

  /**
   * @param keyBits - Quantised key precision, 1 to {@link MAX_KEY_BITS}.
   * @param digitBits - Bits per pass, 1 to {@link MAX_DIGIT_BITS}, at most
   * `keyBits`. Fewer: more passes, smaller histogram.
   *
   * @throws {Error} If either is not an integer in range, or `digitBits` exceeds `keyBits`.
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
   * Orders the first `n` keys without moving them.
   *
   * @returns Indices `0` to `n - 1` by ascending key. Reused buffer: `length`
   * is capacity, not `n`; the next call overwrites it.
   *
   * @throws {RangeError} If `n > 1` and a key is ±Infinity or every key is NaN.
   * A NaN among finite keys quantises to `0`.
   */
  sort(keys: ArrayLike<number>, n = keys.length): Int32Array {
    if (n <= 0) return EMPTY;
    this._ensureCapacity(n);
    if (n === 1) return this._identity(1);

    // Key range first: one extra read of `keys`.
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

    // Exclusive prefix sum per pass: each slot becomes its digit's next output position.
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

    // Pass 0 reads the implicit identity order: `src` needs no initialisation.
    for (let i = 0; i < n; i++) {
      dst[histograms[quantised[i] & mask]++] = i;
    }
    [src, dst] = [dst, src];

    // Stable passes, least significant digit first: `src` ends fully sorted.
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

  /** Identity permutation of the first `n`. */
  private _identity(n: number): Int32Array {
    const src = this._indicesSrc;
    for (let i = 0; i < n; i++) {
      src[i] = i;
    }
    return src;
  }

  /** Grows working buffers to at least `n`, geometrically. Contents are not preserved. */
  private _ensureCapacity(n: number): void {
    if (this._quantised.length >= n) return;
    const capacity = Math.max(n, this._quantised.length * 2);
    this._quantised = new Int32Array(capacity);
    this._indicesSrc = new Int32Array(capacity);
    this._indicesDst = new Int32Array(capacity);
  }
}

/** @throws {Error} If `value` is not an integer between 1 and `max`. */
function assertBitCount(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`Invalid ${name}: ${value}. Must be an integer between 1 and ${max}.`);
  }
}
