import { Vector2 } from "three";
import { Label } from "../Core/Label";
import { GlyphInfo, GlyphInstance } from "./GlyphRun";
import lineBreak from "./LineBreak";
import textAlign from "./TextAlign";
import { applyShaping, reorderParagraph, isParagraphRTL } from "../Utils/LabelUtils";
import anchorText from "./TextAnchors";

export default function layoutText(
  label: Label,
  glyphs: Map<string, GlyphInfo>,
  pxPerUnit: number
): Label {
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

    let cursor = alignOffsetX;
    const y = -lineIdx * lineHeight;

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
          cursor / pxPerUnit + g.w / 2,
          (g.top + y) / pxPerUnit - g.h / 2,
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
        cursor / pxPerUnit + gW / 2,
        (g.top + y) / pxPerUnit - gH / 2,
      ),
    });
  }

  if (chars.length > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const ch of chars) {
      const halfW = ch.glyph.w / 4; // TODO : glyphs are scaled x2 so /4 instead of /2
      const halfH = ch.glyph.h / 4;
      const x0 = ch.offset.x - halfW;
      const x1 = ch.offset.x + halfW;
      const y0 = ch.offset.y - halfH;
      const y1 = ch.offset.y + halfH;

      minX = Math.min(minX, x0);
      maxX = Math.max(maxX, x1);
      minY = Math.min(minY, y0);
      maxY = Math.max(maxY, y1);
    }

    const { shiftX, shiftY } = anchorText(
      label,
      { minX, maxX, minY, maxY },
      offsetX / pxPerUnit,
      offsetY / pxPerUnit,
    );

    for (const ch of chars) {
      ch.offset.x += shiftX;
      ch.offset.y += shiftY;
    }

    label.bounds = {
      width: maxX - minX,
      height: maxY - minY,
    };
  } else {
    label.bounds = {
      width: maxLineWidth / pxPerUnit,
      height: (visualLines.length * lineHeight) / pxPerUnit,
    };
  }

  label.glyphs = chars;

  return label;
}
