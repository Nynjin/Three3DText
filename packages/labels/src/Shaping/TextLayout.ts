import { Vector2 } from 'three';
import type { Label } from '../Label';
import type { AtlasMetrics, GlyphInfo, GlyphInstance, GlyphResolver } from './GlyphRun';
import lineBreak from './LineBreak';
import textAlign from './TextAlign';
import { applyShaping, reorderParagraph, isParagraphRTL } from './RTL';
import anchorText from './TextAnchors';

/**
 * Positions a label's glyphs, then writes them, the ink bounds and the draw
 * quad back onto the label.
 *
 * Glyph metrics arrive in the atlas's raster pixels and are scaled to the
 * label's own `fontSize` here, so one atlas serves every size.
 *
 * @param label - Label to lay out. Mutated in place.
 * @param resolve - Glyph lookup bound to the label's font.
 * @param metrics - Metrics of the atlas the resolver reads from.
 *
 * @returns The same label.
 */
export default function layoutText(
  label: Label,
  resolve: GlyphResolver,
  metrics: AtlasMetrics,
): Label {
  const chars: GlyphInstance[] = [];

  // Atlas raster pixels -> this label's px.
  const glyphScale = label.fontSize / metrics.fontSize;

  const shapedText = applyShaping(label.getDisplayText());
  const paragraphIsRTL = isParagraphRTL(shapedText);
  const breakIndices = lineBreak(label, resolve, glyphScale, shapedText);
  const visualLines = reorderParagraph(shapedText, breakIndices);

  const letterSpacing = label.letterSpacing * label.fontSize;
  const lineHeight = label.lineHeight * label.fontSize;
  const offsetX = label.offset.x * label.fontSize;
  const offsetY = label.offset.y * label.fontSize;

  // Split to code points first: indexing the string would hand each half of a
  // surrogate pair to the resolver on its own, and neither half is an atlas
  // key, so an astral character would resolve to two fallback glyphs.
  const lineChars: string[][] = visualLines.map(line => Array.from(line));

  const resolvedLines: GlyphInfo[][] = lineChars.map((cps) => {
    const resolved: GlyphInfo[] = new Array<GlyphInfo>(cps.length);
    for (let i = 0; i < cps.length; i++) {
      resolved[i] = resolve(cps[i]);
    }
    return resolved;
  });

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

  for (let lineIdx = 0; lineIdx < visualLines.length; lineIdx++) {
    const line = visualLines[lineIdx];
    const cps = lineChars[lineIdx];
    const resolved = resolvedLines[lineIdx];
    if (resolved.length === 0) continue;
    const last = resolved.length - 1;

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
        w: resolved[i].w * glyphScale,
        h: resolved[i].h * glyphScale,
        advance: resolved[i].advance * glyphScale,
        top: resolved[i].top * glyphScale,
      };

      chars.push({
        glyph: g,
        offset: new Vector2(
          cursor + g.w / 2,
          g.top + y - g.h / 2,
        ),
      });

      cursor += g.advance + letterSpacing;

      if (cps[i] === ' ') {
        cursor += extraSpacePerWordGap;
      }
    }

    const g = resolved[last];
    const gW = g.w * glyphScale;
    const gH = g.h * glyphScale;
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
        cursor + gW / 2,
        gTop + y - gH / 2,
      ),
    });
  }

  if (chars.length > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    // The drawn quad covers whole glyph bitmaps; bounds track the ink centred
    // inside them, so the SDF buffer comes back off before halving.
    let quadMinX = Infinity;
    let quadMaxX = -Infinity;
    let quadMinY = Infinity;
    let quadMaxY = -Infinity;

    const glyphPadding = metrics.padding * glyphScale;

    for (const ch of chars) {
      const halfW = Math.max(0, ch.glyph.w - glyphPadding) / 2;
      const halfH = Math.max(0, ch.glyph.h - glyphPadding) / 2;
      minX = Math.min(minX, ch.offset.x - halfW);
      maxX = Math.max(maxX, ch.offset.x + halfW);
      minY = Math.min(minY, ch.offset.y - halfH);
      maxY = Math.max(maxY, ch.offset.y + halfH);

      if (ch.glyph.pw <= 0) continue; // blank, e.g. a space: a quad with no field
      const quadHalfW = ch.glyph.w * 0.5;
      const quadHalfH = ch.glyph.h * 0.5;
      quadMinX = Math.min(quadMinX, ch.offset.x - quadHalfW);
      quadMaxX = Math.max(quadMaxX, ch.offset.x + quadHalfW);
      quadMinY = Math.min(quadMinY, ch.offset.y - quadHalfH);
      quadMaxY = Math.max(quadMaxY, ch.offset.y + quadHalfH);
    }

    maxX += label.padding.right;
    minX -= label.padding.left;
    maxY += label.padding.top;
    minY -= label.padding.bottom;

    const { shiftX, shiftY } = anchorText(
      label,
      { minX, maxX, minY, maxY },
      offsetX,
      offsetY,
    );

    for (const ch of chars) {
      ch.offset.x += shiftX;
      ch.offset.y += shiftY;
    }

    // Recorded after the shift, so consumers place the box without repeating
    // the anchor and offset arithmetic.
    label.bounds = {
      minX: minX + shiftX,
      minY: minY + shiftY,
      width: maxX - minX,
      height: maxY - minY,
    };

    // Measured before the shift above, so the centre carries it and the size,
    // being a difference, does not.
    label.quad = quadMinX === Infinity
      ? { cx: 0, cy: 0, width: 0, height: 0 }
      : {
          cx: (quadMinX + quadMaxX) * 0.5 + shiftX,
          cy: (quadMinY + quadMaxY) * 0.5 + shiftY,
          width: quadMaxX - quadMinX,
          height: quadMaxY - quadMinY,
        };
  } else {
    label.bounds = {
      minX: 0,
      minY: 0,
      width: maxLineWidth,
      height: visualLines.length * lineHeight,
    };
    label.quad = { cx: 0, cy: 0, width: 0, height: 0 };
  }

  label.glyphs = chars;

  return label;
}
