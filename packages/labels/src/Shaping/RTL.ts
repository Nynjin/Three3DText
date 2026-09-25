// @ts-expect-error - no types available
import rtlText from '@mapbox/mapbox-gl-rtl-text';

interface RTLModule {
  applyArabicShaping: (text: string) => string;
  processBidirectionalText: (text: string, breakIndices: number[]) => string[];
}

/** The loaded shaper: `null` until {@link rtlReady} settles, and for good after a load failure. */
let rtl: RTLModule | null = null;

/**
 * Settles once the WASM shaper has loaded or failed to load; never rejects.
 * Until it loads, and for good after a failure, text is laid out unshaped and
 * in logical order.
 */
export const rtlReady: Promise<void> = (rtlText as Promise<RTLModule>)
  .then((module) => {
    rtl = module;
  })
  .catch((error: unknown) => {
    console.error('RTL shaping unavailable, falling back to unshaped text', error);
  });

export function applyShaping(text: string): string {
  if (!text || !rtl) return text;
  return rtl.applyArabicShaping(text);
}

/** The lines of `text` in visual order. Text with no RTL code point is only split, keeping its joiners. */
export function reorderParagraph(text: string, breakIndices: number[]): string[] {
  if (!text) return [''];
  if (!rtl || !needsShaping(text)) return splitAtBreaks(text, breakIndices);
  return rtl.processBidirectionalText(text, breakIndices);
}

/** Whether the text holds a code point from an RTL script, which shaping reorders or reshapes. */
export function needsShaping(text: string): boolean {
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp !== undefined && isRTLCodePoint(cp)) return true;
  }
  return false;
}

const LETTER = /\p{L}/u;

/** Whether the first strongly directional letter is from an RTL script. */
export function isParagraphRTL(text: string): boolean {
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;
    if (isRTLCodePoint(cp)) return true;
    if (LETTER.test(char)) return false;
  }
  return false;
}

/**
 * Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, Mandaic, their presentation
 * forms, and the RTL scripts of U+10800-10FFF and U+1E800-1EFFF.
 */
function isRTLCodePoint(cp: number): boolean {
  return (
    (cp >= 0x0590 && cp <= 0x08FF)
    || (cp >= 0xFB1D && cp <= 0xFDFF)
    || (cp >= 0xFE70 && cp <= 0xFEFC)
    || (cp >= 0x10800 && cp <= 0x10FFF)
    || (cp >= 0x1E800 && cp <= 0x1EFFF)
  );
}

/** Line split with no reordering, standing in for the bidi pass. */
function splitAtBreaks(text: string, breakIndices: number[]): string[] {
  const lines: string[] = [];
  let start = 0;
  for (const end of breakIndices) {
    lines.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}
