import type { Label } from '../Label';
import type { GlyphResolver } from './GlyphRun';

/**
 * Finds where a label's text has to break to fit its `maxWidth`. `glyphScale`
 * converts atlas em metrics to the label's px, matching what layout applies —
 * otherwise breaks are measured at the wrong size.
 *
 * @returns The index just past the end of each line.
 */
export default function lineBreak(
  label: Label,
  resolve: GlyphResolver,
  glyphScale: number,
  text = label.getDisplayText(),
): number[] {
  if (!text) return [0];
  if (label.maxWidth >= Infinity) return [text.length];

  const letterSpacing = label.letterSpacing * label.fontSize;
  const maxWidth = label.maxWidth * label.fontSize;
  const breakIndices: number[] = [];

  let i = 0;
  while (i < text.length) {
    // Skip leading spaces at the start of each line
    while (i < text.length && text[i] === ' ') i++;
    if (i >= text.length) break;

    let lineLen = 0;
    let lineWidth = 0;
    let overflowed = false;

    // Index in `text` of the last space that fit, to break on a word boundary
    let lastSpaceI = -1;

    while (i < text.length) {
      const c = text[i];
      const adv = resolve(c).advance * glyphScale;
      const charW = adv + (lineLen > 0 ? letterSpacing : 0);

      // Overflow — only after at least one char is on the line
      if (lineLen > 0 && lineWidth + charW > maxWidth) {
        // Break just after the last word boundary, or mid-word when there is none.
        if (lastSpaceI >= 0) i = lastSpaceI + 1;
        breakIndices.push(i);
        overflowed = true;
        break;
      }

      if (c === ' ') lastSpaceI = i;

      lineLen++;
      lineWidth += charW;
      i++;
    }

    // The inner loop ran to the end of the text, so `i` closes the last line.
    if (!overflowed && lineLen > 0) breakIndices.push(i);
  }

  if (breakIndices.length === 0) breakIndices.push(text.length);

  return breakIndices;
}
