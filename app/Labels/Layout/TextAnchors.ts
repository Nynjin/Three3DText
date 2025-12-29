import { Label } from "../Core/Label";

export default function textAnchors(label: Label, contentMaxWidth: number, totalHeight: number, lineHeightPx: number) {
  let anchorOffsetX = 0;
  switch (label.anchorX) {
    case "left":
      anchorOffsetX = 0;
      break;
    case "center":
      anchorOffsetX = -contentMaxWidth / 2;
      break;
    case "right":
      anchorOffsetX = -contentMaxWidth;
      break;
  }

  let anchorOffsetY = 0;
  switch (label.anchorY) {
    case "top":
      anchorOffsetY = -lineHeightPx;
      break;
    case "middle":
      anchorOffsetY = -totalHeight / 2 + lineHeightPx / 2;
      break;
    case "bottom":
      anchorOffsetY = totalHeight - lineHeightPx;
      break;
    case "baseline":
      anchorOffsetY = 0;
      break;
  }

  return { anchorOffsetX, anchorOffsetY };
}