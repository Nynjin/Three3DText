import { Label, TextAnchorX, TextAnchorY } from "../Core/Label";

export default function textAnchors(label: Label, contentMaxWidth: number, totalHeight: number, lineHeightPx: number) {
  let anchorOffsetX = 0;
  switch (label.anchorX) {
    case TextAnchorX.Left:
      anchorOffsetX = 0;
      break;
    case TextAnchorX.Center:
      anchorOffsetX = -contentMaxWidth / 2;
      break;
    case TextAnchorX.Right:
      anchorOffsetX = -contentMaxWidth;
      break;
  }

  let anchorOffsetY = 0;
  switch (label.anchorY) {
    case TextAnchorY.Top:
      anchorOffsetY = -lineHeightPx;
      break;
    case TextAnchorY.Middle:
      anchorOffsetY = -totalHeight / 2 + lineHeightPx / 2;
      break;
    case TextAnchorY.Bottom:
      anchorOffsetY = totalHeight - lineHeightPx;
      break;
    case TextAnchorY.Baseline:
      anchorOffsetY = 0;
      break;
  }

  return { anchorOffsetX, anchorOffsetY };
}