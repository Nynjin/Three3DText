import type { Label } from '../Label';
import { applyShaping, needsShaping, shaperLoaded } from './RTL';
import { charSplitter } from './Graphemes';

/** What character requests, line breaking and layout each need from a label's text, worked out once. */
export interface TextAnalysis {
  /** Whether the RTL shaper was loaded when this was worked out. */
  shaperLoaded: boolean;
  /** The text layout places, shaped. */
  shaped: string;
  /** The text holds an RTL code point. */
  rtl: boolean;
  /** How `shaped` and its lines split into characters. */
  split: (s: string) => string[];
  /** `shaped` split into characters. */
  chars: string[];
}

/** The label's text analysis, cached on the label until its displayed text changes or layout has used it, and worked out again once the RTL shaper loads. */
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
