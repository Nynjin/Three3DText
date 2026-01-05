import { Quaternion, Vector2, Vector3 } from "three";
import { Label } from "../Core/Label";
import { GlyphInfo } from "../Font/SDFAtlas";
import { GlyphInstance, LabelInstance } from "./GlyphRun";
import lineBreak from "./LineBreak";
import textAlign from "./TextAlign";
import textAnchors from "./TextAnchors";

export interface LabelLayout {
  label: LabelInstance;
  width: number;
  height: number;
}


export default function layoutText(
  label: Label,
  glyphs: Map<string, GlyphInfo>,
  pxPerUnit: number
): LabelLayout {
  const fallback = glyphs.get("?")!;
  const chars: GlyphInstance[] = [];

  const lines: string[] = lineBreak(label, glyphs, pxPerUnit);

  // Calculate line widths
  const lineWidths: number[] = [];
  for (const line of lines) {
    let w = 0;
    for (let i = 0; i < line.length; i++) {
      const g = glyphs.get(line[i]) || fallback;
      w +=
        g.advance + (i < line.length - 1 ? label.letterSpacing * pxPerUnit : 0);
    }
    lineWidths.push(w);
  }

  const maxLineWidth = Math.max(...lineWidths, 0);
  const lineHeightPx = label.fontSize * label.lineHeight;
  const totalHeight = lines.length * lineHeightPx;

  const contentMaxWidth = maxLineWidth;

  const { anchorOffsetX, anchorOffsetY } = textAnchors(
    label,
    contentMaxWidth,
    totalHeight,
    lineHeightPx
  );

  // Layout each character
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineWidth = lineWidths[lineIdx];

    // Text alignment within line
    const { alignOffsetX, extraSpacePerWordGap } = textAlign(
      label,
      { idx: lineIdx, text: line, width: lineWidth, count: lines.length },
      contentMaxWidth
    );

    let cursor = anchorOffsetX + alignOffsetX;
    const y = anchorOffsetY - lineIdx * lineHeightPx;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const g = glyphs.get(char) || fallback;

      chars.push({
        glyph: g,
        offset: new Vector2(
          (cursor + g.w / 2) / pxPerUnit + label.offset.x,
          (g.top - g.h / 2 + y) / pxPerUnit + label.offset.y,
        ),
      });

      cursor += g.advance;

      // Add letter spacing
      if (i < line.length - 1) {
        cursor += label.letterSpacing * pxPerUnit;

        // Add extra space only at word gaps
        if (char === " ") {
          cursor += extraSpacePerWordGap;
        }
      }
    }
  }

  console.log("Layouted label:", label.text, new Vector3().fromArray(label.color.toArray()));

  return {
    label: {
      position: label.position,
      fontSize: label.fontSize,
      color: new Vector3(label.color.r, label.color.g, label.color.b),
      haloColor: new Vector3(label.haloColor.r, label.haloColor.g, label.haloColor.b),
      opacity: label.opacity,
      haloOpacity: label.haloOpacity,
      haloWidth: label.haloWidth,
      haloBlur: label.haloBlur,
      rotation: new Quaternion().setFromEuler(label.rotation),
      rotationAlignment: label.rotationAlignment,
      symbolPlacement: label.symbolPlacement,
      glyphs: chars,
    },
    width: maxLineWidth / pxPerUnit,
    height: totalHeight / pxPerUnit,
  };
}
