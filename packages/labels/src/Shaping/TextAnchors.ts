import { type Label, TextAnchorX, TextAnchorY } from '../Label';

/** Extent of the laid-out ink, in CSS px, y up. */
export interface TextBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Shift moving the label's anchor point onto its origin.
 * {@link TextAnchorY.Baseline}: the first line's baseline, y 0, whatever `bounds`.
 *
 * @param label - Reads `anchorX` and `anchorY`.
 * @param bounds - Extent to anchor within.
 * @param offsetX - Extra shift right, in CSS px.
 * @param offsetY - Extra shift down, in CSS px.
 *
 * @returns Shift to add to every glyph offset.
 */
export default function anchorText(
  label: Label,
  bounds: TextBounds,
  offsetX: number,
  offsetY: number,
) {
  let anchorX = 0;
  switch (label.anchorX) {
    case TextAnchorX.Left:
      anchorX = bounds.minX;
      break;
    case TextAnchorX.Center:
      anchorX = (bounds.minX + bounds.maxX) / 2;
      break;
    case TextAnchorX.Right:
      anchorX = bounds.maxX;
      break;
  }

  let anchorY = 0;
  switch (label.anchorY) {
    case TextAnchorY.Top:
      anchorY = bounds.maxY;
      break;
    case TextAnchorY.Middle:
      anchorY = (bounds.minY + bounds.maxY) / 2;
      break;
    case TextAnchorY.Bottom:
      anchorY = bounds.minY;
      break;
    case TextAnchorY.Baseline:
      anchorY = 0;
      break;
  }

  return {
    shiftX: -anchorX + offsetX,
    shiftY: -anchorY - offsetY,
  };
}
