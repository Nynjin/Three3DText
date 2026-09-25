import { needsShaping } from './RTL';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Combining marks (variation selectors included), joiners and astral code points: text that needs segmenting. */
const CLUSTERED = /\p{M}|‍|[\u{10000}-\u{10FFFF}]/u;

/**
 * The user-perceived characters of `text`, in order: a joined emoji, a flag or
 * a letter with its combining marks is one element.
 */
function graphemes(text: string): string[] {
  if (!CLUSTERED.test(text)) return text.split('');
  return Array.from(segmenter.segment(text), s => s.segment);
}

function codePoints(text: string): string[] {
  return Array.from(text);
}

/**
 * How a label's shaped text splits into the characters layout draws and the
 * atlas holds: user-perceived characters, or code points for text with an RTL
 * script, whose bidi pass drops joiners. Decide once per label, for all its lines.
 */
export function charSplitter(text: string): (s: string) => string[] {
  return needsShaping(text) ? codePoints : graphemes;
}
