import type { ImageSource } from './ImageAtlas';

/** MapLibre's icon field: 0.75 at the edge, 1/8 per image px. */
const SDF_EDGE = 0.75;
const SDF_PX = 8;

const INF = 1e20;

/**
 * Distance field of an image's alpha, in MapLibre's SDF encoding, for
 * `addImage(id, field, { sdf: true })`. The colour is dropped: an SDF icon
 * takes `iconColor`.
 *
 * @param image - Read through a canvas unless it is raw RGBA.
 * @param buffer - Transparent margin added on each side, in image px, for the
 * field and the halo to spread into. The field reaches 6 px past the edge.
 *
 * @returns RGBA bytes, the field in alpha, `2 * buffer` px wider and taller.
 */
export function imageToSDF(image: ImageSource, buffer = 6): { width: number; height: number; data: Uint8ClampedArray } {
  const src = 'data' in image ? image : readCanvas(image);
  const w = src.width + 2 * buffer;
  const h = src.height + 2 * buffer;
  const outer = new Float64Array(w * h).fill(INF);
  const inner = new Float64Array(w * h).fill(0);

  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const a = src.data[(y * src.width + x) * 4 + 3] / 255;
      if (a === 0) continue;
      const j = (y + buffer) * w + x + buffer;
      if (a === 1) {
        outer[j] = 0;
        inner[j] = INF;
      } else {
        // Sub-pixel edge from coverage.
        const d = 0.5 - a;
        outer[j] = d > 0 ? d * d : 0;
        inner[j] = d < 0 ? d * d : 0;
      }
    }
  }

  const n = Math.max(w, h);
  const f = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Uint16Array(n);
  edt(outer, w, h, f, v, z);
  edt(inner, w, h, f, v, z);

  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const d = Math.sqrt(outer[i]) - Math.sqrt(inner[i]);
    out[i * 4] = 255;
    out[i * 4 + 1] = 255;
    out[i * 4 + 2] = 255;
    out[i * 4 + 3] = Math.round(255 * (SDF_EDGE - d / SDF_PX));
  }
  return { width: w, height: h, data: out };
}

/** Squared Euclidean distance transform of a grid, in place: columns, then rows. */
function edt(grid: Float64Array, w: number, h: number, f: Float64Array, v: Uint16Array, z: Float64Array) {
  for (let x = 0; x < w; x++) edt1d(grid, x, w, h, f, v, z);
  for (let y = 0; y < h; y++) edt1d(grid, y * w, 1, w, f, v, z);
}

/** Felzenszwalb and Huttenlocher's lower envelope of parabolas over one line. */
function edt1d(grid: Float64Array, offset: number, stride: number, length: number, f: Float64Array, v: Uint16Array, z: Float64Array) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset];
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride];
    const q2 = q * q;
    do {
      const r = v[k];
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    const qr = q - r;
    grid[offset + q * stride] = f[r] + qr * qr;
  }
}

function readCanvas(image: ImageSource): ImageData {
  const { width, height } = image as { width: number; height: number };
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('imageToSDF: no 2D canvas context to read the image');
  ctx.drawImage(image as CanvasImageSource, 0, 0);
  return ctx.getImageData(0, 0, width, height);
}
