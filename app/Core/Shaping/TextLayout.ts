import { Vector2 } from 'three';
import type { Label } from '../Label';
import type { AtlasMetrics, GlyphInfo, GlyphInstance, GlyphResolver } from './GlyphRun';
import lineBreak from './LineBreak';
import textAlign from './TextAlign';
import { applyShaping, reorderParagraph, isParagraphRTL } from './RTL';
import anchorText from './TextAnchors';

/**
 * Positions a label's glyphs and writes them back onto it.
 *
 * Glyph metrics arrive in the atlas's em units and are scaled to the label's own
 * `fontSize` here, so one atlas serves every size.
 */
export default function layoutText(
  label: Label,
  resolve: GlyphResolver,
  metrics: AtlasMetrics,
  pxPerUnit: number,
): Label {
  const chars: GlyphInstance[] = [];

  // Atlas em units -> this label's px.
  const glyphScale = label.fontSize / metrics.fontSize;

  const shapedText = applyShaping(label.getDisplayText());
  const paragraphIsRTL = isParagraphRTL(shapedText);
  const { breakIndices } = lineBreak(label, resolve, glyphScale, shapedText);
  const visualLines = reorderParagraph(shapedText, breakIndices);

  const letterSpacing = label.letterSpacing * label.fontSize;
  const lineHeight = label.lineHeight * label.fontSize;
  const offsetX = label.offset.x * label.fontSize;
  const offsetY = label.offset.y * label.fontSize;

  // Resolve each visual line's glyphs
  const resolvedLines: GlyphInfo[][] = visualLines.map((line) => {
    const resolved: GlyphInfo[] = new Array<GlyphInfo>(line.length);
    for (let i = 0; i < line.length; i++) {
      resolved[i] = resolve(line[i]);
    }
    return resolved;
  });

  // Calculate line widths from resolved glyphs
  const lineWidths: number[] = resolvedLines.map((resolved) => {
    if (resolved.length === 0) return 0;
    let w = 0;
    const last = resolved.length - 1;
    for (let i = 0; i < last; i++) {
      w += resolved[i].advance * glyphScale + letterSpacing;
    }
    w += resolved[last].advance * glyphScale;
    return w;
  });

  const maxLineWidth = lineWidths.length > 0 ? Math.max(...lineWidths) : 0;

  // Layout each character
  for (let lineIdx = 0; lineIdx < visualLines.length; lineIdx++) {
    const line = visualLines[lineIdx];
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
        w: (resolved[i].w * glyphScale) / pxPerUnit,
        h: (resolved[i].h * glyphScale) / pxPerUnit,
        advance: resolved[i].advance * glyphScale,
        top: resolved[i].top * glyphScale,
      };

      chars.push({
        glyph: g,
        offset: new Vector2(
          cursor / pxPerUnit + g.w / 2,
          (g.top + y) / pxPerUnit - g.h / 2,
        ),
      });

      cursor += g.advance + letterSpacing;

      if (line[i] === ' ') {
        cursor += extraSpacePerWordGap;
      }
    }

    const g = resolved[last];
    const gW = (g.w * glyphScale) / pxPerUnit;
    const gH = (g.h * glyphScale) / pxPerUnit;
    const gTop = g.top * glyphScale;

    chars.push({
      glyph: {
        px: g.px,
        py: g.py,
        pw: g.pw,
        ph: g.ph,
        w: gW,
        h: gH,
        advance: g.advance * glyphScale,
        top: gTop,
      },
      offset: new Vector2(
        cursor / pxPerUnit + gW / 2,
        (gTop + y) / pxPerUnit - gH / 2,
      ),
    });
  }

  if (chars.length > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    // Quads carry the SDF buffer on every side, and the ink sits centred in it.
    // Bounds track the ink, so the padding comes back off before halving.
    const glyphPadding = (metrics.padding * glyphScale) / pxPerUnit;

    for (const ch of chars) {
      const halfW = Math.max(0, ch.glyph.w - glyphPadding) / 2;
      const halfH = Math.max(0, ch.glyph.h - glyphPadding) / 2;
      const x0 = ch.offset.x - halfW;
      const x1 = ch.offset.x + halfW;
      const y0 = ch.offset.y - halfH;
      const y1 = ch.offset.y + halfH;

      minX = Math.min(minX, x0);
      maxX = Math.max(maxX, x1);
      minY = Math.min(minY, y0);
      maxY = Math.max(maxY, y1);
    }

    maxX += label.padding.right / pxPerUnit;
    minX -= label.padding.left / pxPerUnit;
    maxY += label.padding.top / pxPerUnit;
    minY -= label.padding.bottom / pxPerUnit;

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
