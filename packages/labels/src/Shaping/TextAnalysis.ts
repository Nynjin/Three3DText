import type { Label } from '../Label';
import { applyShaping, needsShaping, shaperLoaded } from './RTL';
import { charSplitter } from './Graphemes';

/** A label's text, analyzed once for character requests, line breaking and layout. */
export interface TextAnalysis {
  /** Shaper load state at analysis time. */
  shaperLoaded: boolean;
  /** Shaped text, as layout places it. */
  shaped: string;
  /** Holds an RTL code point. */
  rtl: boolean;
  /** Splits `shaped` and its lines into characters. */
  split: (s: string) => string[];
  /** `shaped` split into characters. */
  chars: string[];
}

/** Cached on `label.analysis` until cleared there; redone once the RTL shaper loads. */
export function analyze(label: Label): TextAnalysis {
  const loaded = shaperLoaded();
  const cached = label.analysis;
  if (cached?.shaperLoaded === loaded) return cached;

  const text = label.getDisplayText();
  const rtl = needsShaping(text);
  const shaped = rtl ? applyShaping(text) : text;
  const split = charSplitter(shaped, rtl);
  const analysis: TextAnalysis = { shaperLoaded: loaded, shaped, rtl, split, chars: split(shaped) };
  label.analysis = analysis;
  return analysis;
}
