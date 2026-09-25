import type { Label } from '../Label';
import type { GlyphResolver } from './GlyphRun';

/**
 * Finds where a label's text has to break to fit its `maxWidth`.
 *
 * Measurement walks code points, so a surrogate pair is one glyph with one
 * advance. The returned offsets stay in UTF-16 units because the bidi pass
 * consumes them that way.
 *
 * @param label - Label whose `maxWidth`, `fontSize` and `letterSpacing` are read.
 * @param resolve - Glyph lookup bound to the label's font.
 * @param glyphScale - Atlas raster pixels to the label's px. Must be the same
 * factor layout applies, or breaks are measured at the wrong size.
 * @param text - Text to break, already shaped. Defaults to the label's own.
 *
 * @returns The index just past the end of each line, in UTF-16 code units.
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
    // Skip leading spaces at the start of each line.
    while (i < text.length && text[i] === ' ') i++;
    if (i >= text.length) break;

    let lineLen = 0;
    let lineWidth = 0;
    let overflowed = false;

    // Index in `text` of the last space that fit, to break on a word boundary.
    let lastSpaceI = -1;

    while (i < text.length) {
      // One code point: a leading surrogate takes its trailing half with it, so
      // an astral character is measured and broken as the one glyph it is.
      const unit = text.charCodeAt(i);
      const isLead = unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length;
      const c = isLead ? text.slice(i, i + 2) : text[i];
      const adv = resolve(c).advance * glyphScale;
      const charW = adv + (lineLen > 0 ? letterSpacing : 0);

      // Overflow, but only once at least one char is on the line.
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
      i += c.length;
    }

    // The inner loop ran to the end of the text, so `i` closes the last line.
    if (!overflowed && lineLen > 0) breakIndices.push(i);
  }

  if (breakIndices.length === 0) breakIndices.push(text.length);

  return breakIndices;
}
