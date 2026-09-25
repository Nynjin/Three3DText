import type { Label } from '../Label';
import type { GlyphResolver } from './GlyphRun';
import { charSplitter } from './Graphemes';

/**
 * Finds where a label's text breaks: after every `\n`, and where a line would
 * pass `maxWidth`. A width break falls after the line's last space, or between
 * characters when the line has none. Spaces never overflow a line; they stay at
 * its end. Measures the characters layout draws.
 *
 * @param label - Label whose `maxWidth` and `letterSpacing` (in em) and `fontSize` are read.
 * @param resolve - Glyph lookup bound to the label's font.
 * @param glyphScale - Raster px to CSS px, the factor layout applies.
 * @param text - The text layout will place, already shaped.
 *
 * @returns The offset just past the end of each line, in UTF-16 code units.
 * Lines keep their trailing spaces and `\n`.
 */
export default function lineBreak(
  label: Label,
  resolve: GlyphResolver,
  glyphScale: number,
  text: string,
): number[] {
  if (!text) return [0];

  const letterSpacing = label.letterSpacing * label.fontSize;
  const maxWidth = label.maxWidth * label.fontSize;
  const chars = charSplitter(text)(text);
  const breakIndices: number[] = [];

  // `k` indexes `chars`; `at` is the UTF-16 offset where chars[k] starts.
  let k = 0;
  let at = 0;
  while (k < chars.length) {
    let lineLen = 0;
    let lineWidth = 0;
    // Just past the line's last space, where a width break goes.
    let afterSpaceK = -1;
    let afterSpaceAt = -1;
    let broke = false;

    while (k < chars.length) {
      const c = chars[k];
      if (c === '\n' || c === '\r\n') {
        at += c.length;
        k++;
        breakIndices.push(at);
        broke = true;
        break;
      }

      // Without a finite maxWidth only `\n` breaks, so nothing is measured.
      const charW = maxWidth < Infinity
        ? resolve(c).advance * glyphScale + (lineLen > 0 ? letterSpacing : 0)
        : 0;

      if (c === ' ') {
        afterSpaceK = k + 1;
        afterSpaceAt = at + 1;
      } else if (lineLen > 0 && lineWidth + charW > maxWidth) {
        if (afterSpaceK > 0) {
          k = afterSpaceK;
          at = afterSpaceAt;
        }
        breakIndices.push(at);
        broke = true;
        break;
      }

      lineLen++;
      lineWidth += charW;
      at += c.length;
      k++;
    }

    if (!broke) breakIndices.push(at);
  }

  return breakIndices;
}
