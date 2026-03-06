import { Vector2 } from "three";
import { Label } from "../Core/Label";
import { GlyphInfo, GlyphInstance, LabelInstance } from "./GlyphRun";
import lineBreak from "./LineBreak";
import textAlign from "./TextAlign";
import textAnchors from "./TextAnchors";
import { toLabelInstance, applyShaping, reorderParagraph, isParagraphRTL } from "../Utils/LabelUtils";

export default function layoutText(
  label: Label,
  glyphs: Map<string, GlyphInfo>,
  pxPerUnit: number
): LabelInstance {
  const fallback = glyphs.get("?")!;
  const chars: GlyphInstance[] = [];

  const shapedText = applyShaping(label.getDisplayText());
  const paragraphIsRTL = isParagraphRTL(shapedText);
  const { breakIndices } = lineBreak(label, glyphs, shapedText);
  const visualLines = reorderParagraph(shapedText, breakIndices);

  const letterSpacing = label.letterSpacing * label.fontSize;
  const lineHeight  = label.lineHeight * label.fontSize;
  const offsetX = label.offset.x * label.fontSize;
  const offsetY = label.offset.y * label.fontSize;

  // Resolve each visual line's glyphs
  const resolvedLines: GlyphInfo[][] = visualLines.map(line => {
    const resolved: GlyphInfo[] = new Array(line.length);
    for (let i = 0; i < line.length; i++) {
      resolved[i] = glyphs.get(line[i]) ?? fallback;
    }
    return resolved;
  });

  // Calculate line widths from resolved glyphs
  const lineWidths: number[] = resolvedLines.map((resolved) => {
    if (resolved.length === 0) return 0;
    let w = 0;
    const last = resolved.length - 1;
    for (let i = 0; i < last; i++) {
      w += resolved[i].advance + letterSpacing;
    }
    w += resolved[last].advance;
    return w;
  });

  const maxLineWidth = lineWidths.length > 0 ? Math.max(...lineWidths) : 0;
  const totalHeight  = visualLines.length * lineHeight;

  const { anchorOffsetX, anchorOffsetY } = textAnchors(
    label,
    maxLineWidth,
    totalHeight,
    lineHeight
  );

  // Layout each character
  for (let lineIdx = 0; lineIdx < visualLines.length; lineIdx++) {
    const line     = visualLines[lineIdx];
    const resolved = resolvedLines[lineIdx];
    if (resolved.length === 0) continue;
    const last = resolved.length - 1;

    // Text alignment uses paragraph direction
    const { alignOffsetX, extraSpacePerWordGap } = textAlign(
      label,
      { idx: lineIdx, text: line, width: lineWidths[lineIdx], count: visualLines.length },
      maxLineWidth,
      paragraphIsRTL,
    );

    let cursor = anchorOffsetX + alignOffsetX;
    const y = anchorOffsetY - lineIdx * lineHeight;

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
      };

      chars.push({
        glyph: g,
        offset: new Vector2(
          cursor / pxPerUnit + g.w / 2 + offsetX / pxPerUnit,
          (g.top + y) / pxPerUnit - g.h / 2 - offsetY / pxPerUnit,
        ),
      });

      cursor += g.advance + letterSpacing;

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
        cursor / pxPerUnit + gW / 2 + offsetX / pxPerUnit,
        (g.top + y) / pxPerUnit - gH / 2 - offsetY / pxPerUnit,
      ),
    });
  }

  return toLabelInstance(label, chars);
}
