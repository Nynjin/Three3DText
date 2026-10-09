import type { Label } from '../Label';
import type { GlyphResolver } from './GlyphRun';

/**
 * Line breaks: after every `\n`, and where a line would pass `maxWidth`. A
 * width break falls after the line's last space, else between characters.
 * Spaces never overflow; they stay at the line end. Leading spaces are neither
 * measured nor break points.
 *
 * @param label - Reads `maxWidth`, `letterSpacing` (em) and `fontSize`.
 * @param resolve - Glyph lookup bound to the label's font.
 * @param glyphScale - Raster px to CSS px.
 * @param text - Shaped text.
 * @param chars - `text` split into the characters layout draws.
 *
 * @returns `breakIndices`: end of each line, in UTF-16 code units;
 * `breakChars`: the same, in characters. Lines keep trailing spaces and `\n`.
 */
export default function lineBreak(
  label: Label,
  resolve: GlyphResolver,
  glyphScale: number,
  text: string,
  chars: string[],
): { breakIndices: number[]; breakChars: number[] } {
  if (!text) return { breakIndices: [0], breakChars: [0] };

  const letterSpacing = label.letterSpacing * label.fontSize;
  const maxWidth = label.maxWidth * label.fontSize;
  const breakIndices: number[] = [];
  const breakChars: number[] = [];

  // `k` indexes `chars`; `at` is the UTF-16 offset where chars[k] starts.
  let k = 0;
  let at = 0;
  while (k < chars.length) {
    let lineLen = 0;
    let lineWidth = 0;
    // Width break point: just past the last space.
    let afterSpaceK = -1;
    let afterSpaceAt = -1;
    let broke = false;

    while (k < chars.length) {
      const c = chars[k];
      if (c === '\n' || c === '\r\n') {
        at += c.length;
        k++;
        breakIndices.push(at);
        breakChars.push(k);
        broke = true;
        break;
      }

      // Layout trims leading spaces.
      if (c === ' ' && lineLen === 0) {
        at += 1;
        k++;
        continue;
      }

      // Infinite maxWidth: only `\n` breaks; nothing measured.
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
        breakChars.push(k);
        broke = true;
        break;
      }

      lineLen++;
      lineWidth += charW;
      at += c.length;
      k++;
    }

    if (!broke) {
      breakIndices.push(at);
      breakChars.push(k);
    }
  }

  return { breakIndices, breakChars };
}
