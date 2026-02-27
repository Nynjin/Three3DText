import { Vector2 } from "three";
import { Label } from "../Core/Label";
import { GlyphInfo, GlyphInstance, LabelInstance } from "./GlyphRun";
import lineBreak from "./LineBreak";
import textAlign from "./TextAlign";
import textAnchors from "./TextAnchors";
import { toLabelInstance } from "../Utils/LabelUtils";

export default function layoutText(
  label: Label,
  glyphs: Map<string, GlyphInfo>,
  pxPerUnit: number
): LabelInstance {
  const fallback = glyphs.get("?")!;
  const chars: GlyphInstance[] = [];

  const lines: string[] = lineBreak(label, glyphs, pxPerUnit);

  const letterSpacing = label.letterSpacing * pxPerUnit;
  const lineHeightPx  = label.fontSize * label.lineHeight;
  const offsetX       = label.offset.x;
  const offsetY       = label.offset.y;

  // Resolve each line's glyphs once
  const resolvedLines: GlyphInfo[][] = lines.map(line => {
    const resolved: GlyphInfo[] = new Array(line.length);
    for (let i = 0; i < line.length; i++) {
      resolved[i] = glyphs.get(line[i]) ?? fallback;
    }
    return resolved;
  });

  // Calculate line widths from resolved glyphs
  const lineWidths: number[] = resolvedLines.map((resolved) => {
    let w = 0;
    const last = resolved.length - 1;
    for (let i = 0; i < last; i++) {
      w += resolved[i].advance;
      w += letterSpacing;
    }
    w += resolved[last].advance;
    return w;
  });

  const maxLineWidth = lineWidths.length > 0 ? Math.max(...lineWidths) : 0;
  const totalHeight  = lines.length * lineHeightPx;

  const { anchorOffsetX, anchorOffsetY } = textAnchors(
    label,
    maxLineWidth,
    totalHeight,
    lineHeightPx
  );

  // Layout each character
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line     = lines[lineIdx];
    const resolved = resolvedLines[lineIdx];
    const last     = resolved.length - 1;

    // Text alignment within line
    const { alignOffsetX, extraSpacePerWordGap } = textAlign(
      label,
      { idx: lineIdx, text: line, width: lineWidths[lineIdx], count: lines.length },
      maxLineWidth
    );

    let cursor = anchorOffsetX + alignOffsetX;
    const y = anchorOffsetY - lineIdx * lineHeightPx;

    for (let i = 0; i < last; i++) {
      const g = {
        px: resolved[i].px,
        py: resolved[i].py,
        pw: resolved[i].pw,
        ph: resolved[i].ph,
        w: resolved[i].w / pxPerUnit,
        h: resolved[i].h / pxPerUnit,
        advance: resolved[i].advance,
        top: resolved[i].top,
      }

      chars.push({
        glyph: g,
        offset: new Vector2(
          cursor / pxPerUnit + g.w / 2 + offsetX,
          (g.top + y) / pxPerUnit - g.h / 2 + offsetY,
        ),
      });

      cursor += g.advance;
      cursor += letterSpacing;

      if (line[i] === " ") {
        cursor += extraSpacePerWordGap;
      }
    }

    const g = resolved[last];
    const gW = g.w / pxPerUnit;
    const gH = g.h / pxPerUnit;

    chars.push({
      glyph: {
        px: g.px,
        py: g.py,
        pw: g.pw,
        ph: g.ph,
        w: gW,
        h: gH,
        advance: g.advance,
        top: g.top,
      },
      offset: new Vector2(
        cursor / pxPerUnit + gW / 2 + offsetX,
        (g.top + y) / pxPerUnit - gH / 2 + offsetY,
      ),
    });
  }

  return toLabelInstance(label, chars);
}
