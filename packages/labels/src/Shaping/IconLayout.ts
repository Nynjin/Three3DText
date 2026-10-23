import type { Label, SymbolAnchor } from '../Label';
import type { ImageEntry } from '../Images/ImageAtlas';

const NO_QUAD = { cx: 0, cy: 0, width: 0, height: 0 };
const NO_BOUNDS = { minX: 0, minY: 0, width: 0, height: 0 };

/** Box edges, CSS px, y down. */
interface Edges { l: number; t: number; r: number; b: number }

/** Share of the box left of and above the anchor (MapLibre `getAnchorAlignment`). */
function alignment(anchor: SymbolAnchor): [number, number] {
  const h = anchor.includes('left') ? 0 : anchor.includes('right') ? 1 : 0.5;
  const v = anchor.includes('top') ? 0 : anchor.includes('bottom') ? 1 : 0.5;
  return [h, v];
}

/**
 * Lays out a label's icon and writes `iconQuad` (draw box) and `iconBounds`
 * (collision box), label-local CSS px, y up. Run after text layout: under
 * `iconTextFit` the icon is sized from the text's ink box (`bounds` less
 * `padding`). Without an image both are zero.
 *
 * Follows MapLibre's `shapeIcon` and `fitIconToText`, except that a fitted
 * axis is sized in CSS px, so `iconSize` does not scale it.
 *
 * @param label - Mutated in place.
 * @param image - The entry `iconImage` names, or `undefined`.
 */
export default function layoutIcon(label: Label, image: ImageEntry | undefined): void {
  if (!image || label.iconImage === '') {
    label.iconQuad = { ...NO_QUAD };
    label.iconBounds = { ...NO_BOUNDS };
    return;
  }

  const s = label.iconSize;
  // CSS px per image px.
  const k = s / image.pixelRatio;
  const w = image.width * k;
  const h = image.height * k;
  const ox = label.iconOffset[0] * s;
  const oy = label.iconOffset[1] * s;

  const fit = label.iconTextFit;
  const text = fit !== 'none' && label.glyphs.length > 0 ? inkBox(label) : undefined;
  let box: Edges;

  if (!text) {
    const [ha, va] = alignment(label.iconAnchor);
    const l = ox - ha * w;
    const t = oy - va * h;
    box = { l, t, r: l + w, b: t + h };
  } else {
    const p = label.iconTextFitPadding;
    // Margins outside the image's content area keep their size around the fitted text.
    const c = image.content;
    const ml = c ? c[0] * k : 0, mt = c ? c[1] * k : 0;
    const mr = c ? (image.width - c[2]) * k : 0, mb = c ? (image.height - c[3]) * k : 0;
    let l: number, r: number, t: number, b: number;
    if (fit === 'width' || fit === 'both') {
      l = ox + text.l - p.left - ml;
      r = ox + text.r + p.right + mr;
    } else {
      l = ox + (text.l + text.r - w) / 2;
      r = l + w;
    }
    if (fit === 'height' || fit === 'both') {
      t = oy + text.t - p.top - mt;
      b = oy + text.b + p.bottom + mb;
    } else {
      t = oy + (text.t + text.b - h) / 2;
      b = t + h;
    }
    box = { l, t, r, b };
  }

  const pad = label.iconPadding;
  label.iconQuad = {
    cx: (box.l + box.r) / 2,
    cy: -(box.t + box.b) / 2,
    width: box.r - box.l,
    height: box.b - box.t,
  };
  label.iconBounds = {
    minX: box.l - pad.left,
    minY: -box.b - pad.bottom,
    width: box.r - box.l + pad.left + pad.right,
    height: box.b - box.t + pad.top + pad.bottom,
  };
}

/** The text's ink box after anchoring, y down: `bounds` less `padding`. */
function inkBox(label: Label): Edges {
  const { minX, minY, width, height } = label.bounds;
  const p = label.padding;
  const l = minX + p.left;
  const r = minX + width - p.right;
  const bottomUp = minY + p.bottom;
  const topUp = minY + height - p.top;
  return { l, r, t: -topUp, b: -bottomUp };
}
