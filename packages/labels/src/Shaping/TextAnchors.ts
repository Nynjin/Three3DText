import { type Label, TextAnchorX, TextAnchorY } from '../Label';

/** Extent of the laid-out ink, in CSS px, y up. */
export interface TextBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Shift that moves the label's anchor point onto its origin.
 *
 * {@link TextAnchorY.Baseline} anchors on the first line's baseline, which is
 * y 0 in label-local space, so it ignores `bounds`.
 *
 * @param label - Label whose `anchorX` and `anchorY` are read.
 * @param bounds - Extent to anchor within.
 * @param offsetX - Extra shift right, in CSS px.
 * @param offsetY - Extra shift down, in CSS px.
 *
 * @returns The shift to add to every glyph offset.
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
