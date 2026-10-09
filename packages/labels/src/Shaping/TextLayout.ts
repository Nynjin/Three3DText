import { Vector2 } from 'three';
import { type Label, TextAlign } from '../Label';
import type { AtlasMetrics, GlyphInfo, GlyphInstance, GlyphResolver } from './GlyphRun';
import lineBreak from './LineBreak';
import textAlign from './TextAlign';
import { reorderParagraph, isParagraphRTL } from './RTL';
import { analyze } from './TextAnalysis';
import anchorText from './TextAnchors';

/** Characters trimmed from both ends of every line. */
const LINE_TRIM = new Set([' ', '\n', '\r', '\r\n']);

/**
 * Lays out a label's glyphs and writes `glyphs`, `bounds` (collision box) and
 * `quad` (draw quad) onto it, in CSS px, y up, shifted by anchor and offset.
 * Clears `label.analysis`.
 *
 * Reads `fontSize` and `padding` in CSS px; `maxWidth`, `letterSpacing`,
 * `lineHeight` and `offset` in em. Anchors on the ink; `padding` grows
 * `bounds` only.
 *
 * @param label - Mutated in place.
 * @param resolve - Glyph lookup bound to the label's font.
 * @param metrics - Metrics of the atlas `resolve` reads.
 *
 * @returns `label`.
 */
export default function layoutText(
  label: Label,
  resolve: GlyphResolver,
  metrics: AtlasMetrics,
): Label {
  const glyphs: GlyphInstance[] = [];

  // Raster px -> CSS px.
  const scale = label.fontSize / metrics.fontSize;

  const analysis = analyze(label);
  const shapedText = analysis.shaped;
  const { breakIndices, breakChars } = lineBreak(label, resolve, scale, shapedText, analysis.chars);

  const letterSpacing = label.letterSpacing * label.fontSize;
  const lineHeight = label.lineHeight * label.fontSize;

  // No RTL: lines are slices of `analysis.chars`.
  let lineChars: string[][];
  if (analysis.rtl) {
    lineChars = reorderParagraph(shapedText, breakIndices).map(line => trimLine(analysis.split(line)));
  } else {
    lineChars = [];
    let from = 0;
    for (const to of breakChars) {
      lineChars.push(trimLine(analysis.chars.slice(from, to)));
      from = to;
    }
  }
  const resolvedLines = lineChars.map(cps => cps.map(resolve));

  const lineWidths = resolvedLines.map((resolved) => {
    let w = 0;
    for (const g of resolved) w += g.advance * scale;
    return w + letterSpacing * Math.max(0, resolved.length - 1);
  });
  const paragraphs = paragraphsOf(shapedText, breakIndices, analysis.rtl);
  const maxLineWidth = Math.max(0, ...lineWidths);

  const justify = label.textAlign === TextAlign.Justify;
  for (let lineIdx = 0; lineIdx < lineChars.length; lineIdx++) {
    const cps = lineChars[lineIdx];
    const resolved = resolvedLines[lineIdx];

    const { alignOffsetX, extraSpacePerWordGap } = textAlign(
      label,
      { text: justify ? cps.join('') : '', width: lineWidths[lineIdx], ...paragraphs[Math.min(lineIdx, paragraphs.length - 1)] },
      maxLineWidth,
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
  label.analysis = undefined;

  if (glyphs.length === 0) {
    label.bounds = { minX: 0, minY: 0, width: 0, height: 0 };
    label.quad = { cx: 0, cy: 0, width: 0, height: 0 };
    return label;
  }

  // Ink box, and the union of drawn bitmaps.
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

/**
 * Paragraph direction and `endsParagraph` for each line `breakIndices` cuts,
 * in logical order. The bidi pass keeps one visual line per logical line.
 */
function paragraphsOf(text: string, breakIndices: number[], rtl: boolean): { isRTL: boolean; endsParagraph: boolean }[] {
  const out: { isRTL: boolean; endsParagraph: boolean }[] = [];
  const direction = new Map<number, boolean>();
  let start = 0;
  for (let i = 0; i < breakIndices.length; i++) {
    const end = breakIndices[i];
    const endsParagraph = i === breakIndices.length - 1 || text[end - 1] === '\n';
    const paragraphStart = rtl ? text.lastIndexOf('\n', start - 1) + 1 : 0;
    let isRTL = rtl ? direction.get(paragraphStart) : false;
    if (isRTL === undefined) {
      const paragraphEnd = text.indexOf('\n', paragraphStart);
      isRTL = isParagraphRTL(text.slice(paragraphStart, paragraphEnd < 0 ? text.length : paragraphEnd));
      direction.set(paragraphStart, isRTL);
    }
    out.push({ isRTL, endsParagraph });
    start = end;
  }
  return out.length > 0 ? out : [{ isRTL: false, endsParagraph: true }];
}

/** Drops spaces and line breaks from both ends of a line. */
function trimLine(cps: string[]): string[] {
  let start = 0;
  let end = cps.length;
  while (start < end && LINE_TRIM.has(cps[start])) start++;
  while (end > start && LINE_TRIM.has(cps[end - 1])) end--;
  return start === 0 && end === cps.length ? cps : cps.slice(start, end);
}

/** Atlas entry with size and metrics in CSS px. */
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
