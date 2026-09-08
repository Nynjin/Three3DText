// @ts-expect-error - no types available
import rtlText from '@mapbox/mapbox-gl-rtl-text';

interface RTLModule {
  applyArabicShaping: (text: string) => string;
  processBidirectionalText: (text: string, breakIndices: number[]) => string[];
}

/**
 * The module is WASM-backed and resolves after startup. Awaiting it at the top
 * level would turn every importer into an async module, so it is assigned when
 * it lands and shaping falls back to the text as given until then.
 */
let rtl: RTLModule | null = null;

/** Resolves once shaping is live. Labels laid out before that need a relayout. */
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

export function reorderParagraph(text: string, breakIndices: number[]): string[] {
  if (!text) return [''];
  if (!rtl) return splitAtBreaks(text, breakIndices);
  return rtl.processBidirectionalText(text, breakIndices);
}

/**
 * Whether shaping can change this text at all: only text carrying an RTL
 * codepoint does, so anything else lays out identically before and after
 * {@link rtlReady} resolves and never needs a relayout.
 */
export function needsShaping(text: string): boolean {
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp !== undefined && isRTLCodePoint(cp)) return true;
  }
  return false;
}

export function isParagraphRTL(text: string): boolean {
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;
    if (isRTLCodePoint(cp)) return true;
    // Strongly LTR: Latin, Greek, Cyrillic, etc.
    if (
      (cp >= 0x0041 && cp <= 0x007A)
      || (cp >= 0x00C0 && cp <= 0x024F)
      || (cp >= 0x0370 && cp <= 0x03FF)
      || (cp >= 0x0400 && cp <= 0x04FF)
    ) return false;
  }
  return false;
}

/** Hebrew, Arabic, Syriac, Thaana, NKo and the Arabic presentation forms. */
function isRTLCodePoint(cp: number): boolean {
  return (
    (cp >= 0x0590 && cp <= 0x08FF)
    || (cp >= 0xFB1D && cp <= 0xFDFF)
    || (cp >= 0xFE70 && cp <= 0xFEFF)
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
