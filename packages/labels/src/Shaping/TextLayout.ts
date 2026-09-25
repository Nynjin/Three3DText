import { Vector2 } from 'three';
import type { Label } from '../Label';
import type { AtlasMetrics, GlyphInfo, GlyphInstance, GlyphResolver } from './GlyphRun';
import lineBreak from './LineBreak';
import textAlign from './TextAlign';
import { applyShaping, reorderParagraph, isParagraphRTL } from './RTL';
import anchorText from './TextAnchors';
import { charSplitter } from './Graphemes';

/** Characters trimmed from both ends of every line. */
const LINE_TRIM = new Set([' ', '\n', '\r']);

/**
 * Positions a label's glyphs, then writes them, its collision box and its draw
 * quad back onto the label.
 *
 * Reads `fontSize` and `padding` in CSS px, and `maxWidth`, `letterSpacing`,
 * `lineHeight` and `offset` in em. Writes `glyphs`, `bounds` and `quad` in CSS
 * px, y up, already shifted by the anchor and offset. The anchor is taken on the
 * ink; `padding` then grows `bounds` only.
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
  const glyphs: GlyphInstance[] = [];

  // Raster px -> CSS px.
  const scale = label.fontSize / metrics.fontSize;

  const shapedText = applyShaping(label.getDisplayText());
  const paragraphIsRTL = isParagraphRTL(shapedText);
  const breakIndices = lineBreak(label, resolve, scale, shapedText);
  const visualLines = reorderParagraph(shapedText, breakIndices);

  const letterSpacing = label.letterSpacing * label.fontSize;
  const lineHeight = label.lineHeight * label.fontSize;

  // The unit the atlas is keyed by, chosen from the whole text.
  const split = charSplitter(shapedText);
  const lineChars = visualLines.map(line => trimLine(split(line)));
  const resolvedLines = lineChars.map(cps => cps.map(resolve));

  const lineWidths = resolvedLines.map((resolved) => {
    let w = 0;
    for (const g of resolved) w += g.advance * scale;
    return w + letterSpacing * Math.max(0, resolved.length - 1);
  });
  const maxLineWidth = Math.max(0, ...lineWidths);

  for (let lineIdx = 0; lineIdx < lineChars.length; lineIdx++) {
    const cps = lineChars[lineIdx];
    const resolved = resolvedLines[lineIdx];

    const { alignOffsetX, extraSpacePerWordGap } = textAlign(
      label,
      { idx: lineIdx, text: cps.join(''), width: lineWidths[lineIdx], count: lineChars.length },
      maxLineWidth,
      paragraphIsRTL,
    );

    let cursor = alignOffsetX;
    const baseline = -lineIdx * lineHeight;

    for (let i = 0; i < resolved.length; i++) {
      const g = resolved[i];
      if (g.pw > 0) {
        const placed = scaleGlyph(g, scale);
        glyphs.push({
          glyph: placed,
          offset: new Vector2(
            cursor + placed.left + placed.w / 2,
            baseline + placed.top - placed.h / 2,
          ),
        });
      }

      cursor += g.advance * scale + letterSpacing;
      if (cps[i] === ' ') cursor += extraSpacePerWordGap;
    }
  }

  label.glyphs = glyphs;

  if (glyphs.length === 0) {
    label.bounds = { minX: 0, minY: 0, width: 0, height: 0 };
    label.quad = { cx: 0, cy: 0, width: 0, height: 0 };
    return label;
  }

  // Ink box, and the union of the bitmaps the shader draws.
  const inset = (metrics.padding * scale) / 2;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let qMinX = Infinity, qMaxX = -Infinity, qMinY = Infinity, qMaxY = -Infinity;
  for (const { offset, glyph } of glyphs) {
    const hw = glyph.w / 2, hh = glyph.h / 2;
    const iw = Math.max(0, hw - inset), ih = Math.max(0, hh - inset);
    minX = Math.min(minX, offset.x - iw);
    maxX = Math.max(maxX, offset.x + iw);
    minY = Math.min(minY, offset.y - ih);
    maxY = Math.max(maxY, offset.y + ih);
    qMinX = Math.min(qMinX, offset.x - hw);
    qMaxX = Math.max(qMaxX, offset.x + hw);
    qMinY = Math.min(qMinY, offset.y - hh);
    qMaxY = Math.max(qMaxY, offset.y + hh);
  }

  const { shiftX, shiftY } = anchorText(
    label,
    { minX, maxX, minY, maxY },
    label.offset.x * label.fontSize,
    label.offset.y * label.fontSize,
  );

  for (const { offset } of glyphs) {
    offset.x += shiftX;
    offset.y += shiftY;
  }

  const pad = label.padding;
  label.bounds = {
    minX: minX + shiftX - pad.left,
    minY: minY + shiftY - pad.bottom,
    width: maxX - minX + pad.left + pad.right,
    height: maxY - minY + pad.bottom + pad.top,
  };
  label.quad = {
    cx: (qMinX + qMaxX) / 2 + shiftX,
    cy: (qMinY + qMaxY) / 2 + shiftY,
    width: qMaxX - qMinX,
    height: qMaxY - qMinY,
  };

  return label;
}

/** Drops spaces and line breaks from both ends of a line. */
function trimLine(cps: string[]): string[] {
  let start = 0;
  let end = cps.length;
  while (start < end && LINE_TRIM.has(cps[start])) start++;
  while (end > start && LINE_TRIM.has(cps[end - 1])) end--;
  return start === 0 && end === cps.length ? cps : cps.slice(start, end);
}

/** An atlas entry with its size and metrics in CSS px. */
function scaleGlyph(g: GlyphInfo, scale: number): GlyphInfo {
  return {
    px: g.px,
    py: g.py,
    pw: g.pw,
    ph: g.ph,
    w: g.w * scale,
    h: g.h * scale,
    left: g.left * scale,
    top: g.top * scale,
    advance: g.advance * scale,
  };
}
