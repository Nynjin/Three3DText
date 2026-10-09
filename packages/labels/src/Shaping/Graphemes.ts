import { needsShaping } from './RTL';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Marks (variation selectors included), ZWJ, astral code points: text needing grapheme segmentation. */
const CLUSTERED = /\p{M}|‍|[\u{10000}-\u{10FFFF}]/u;

/** User-perceived characters: a joined emoji, a flag, a letter with its marks. */
function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), s => s.segment);
}

function codeUnits(text: string): string[] {
  return text.split('');
}

function codePoints(text: string): string[] {
  return Array.from(text);
}

/**
 * Splitter into the characters layout draws and the atlas holds: code points
 * for RTL text (the bidi pass drops joiners), else graphemes, or UTF-16 code
 * units when nothing clusters. Chosen from the whole text; all lines split alike.
 */
export function charSplitter(text: string, rtl: boolean = needsShaping(text)): (s: string) => string[] {
  if (rtl) return codePoints;
  return CLUSTERED.test(text) ? graphemes : codeUnits;
}
