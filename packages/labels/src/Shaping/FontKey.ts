const WEIGHTS = ['100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;
const STYLES = ['normal', 'italic', 'oblique'] as const;

export type FontWeight = (typeof WEIGHTS)[number];
export type FontStyle = (typeof STYLES)[number];

export type FontWeightName = keyof typeof WEIGHT_ALIASES;

/** Immutable, shared by reference. Replace, never mutate. */
export interface FontKey {
  /** CSS family, or comma-separated family list. */
  readonly font: string;
  readonly weight: FontWeight;
  readonly style: FontStyle;
}

export const DEFAULT_FONT = 'Arial';
export const DEFAULT_WEIGHT: FontWeight = '400';
export const DEFAULT_STYLE: FontStyle = 'normal';

export const DEFAULT_FONT_KEY: FontKey = {
  font: DEFAULT_FONT,
  weight: DEFAULT_WEIGHT,
  style: DEFAULT_STYLE,
};

const WEIGHT_ALIASES = {
  thin: '100',
  hairline: '100',
  extralight: '200',
  ultralight: '200',
  light: '300',
  normal: '400',
  regular: '400',
  medium: '500',
  semibold: '600',
  demibold: '600',
  bold: '700',
  extrabold: '800',
  ultrabold: '800',
  black: '900',
  heavy: '900',
} as const satisfies Record<string, FontWeight>;

const ALIASES: ReadonlyMap<string, FontWeight> = new Map(Object.entries(WEIGHT_ALIASES));
const WEIGHT_SET: ReadonlySet<string> = new Set(WEIGHTS);
const STYLE_SET: ReadonlySet<string> = new Set(STYLES);

/** CSS generic families: unquoted in the canvas `font` shorthand. */
const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong',
]);

function isFontWeight(token: string): token is FontWeight {
  return WEIGHT_SET.has(token);
}

function isFontStyle(token: string): token is FontStyle {
  return STYLE_SET.has(token);
}

/** Weight for a token or alias, ignoring case and hyphens. `undefined` if unknown. */
function weightOf(token: string): FontWeight | undefined {
  const t = token.toLowerCase().replace(/-/g, '');
  return isFontWeight(t) ? t : ALIASES.get(t);
}

/**
 * Canonical weight for a number, weight string or alias such as `bold`.
 *
 * @throws {RangeError} If not one of the nine CSS weights or a known alias.
 */
export function normalizeFontWeight(value: FontWeight | FontWeightName | number): FontWeight {
  const weight = weightOf(String(value));
  if (weight === undefined) throw new RangeError(`Unknown font weight: ${value}`);
  return weight;
}

/**
 * Splits a name such as `"Helvetica Neue Extra Bold Italic"` into family,
 * weight and style. Weight and style words are read from the end, one or two
 * words at a time; the rest is the family. `weight`/`style` set only if named.
 */
function parseFontName(descriptor: string): { font: string; weight?: FontWeight; style?: FontStyle } {
  const parts = descriptor.trim().split(/\s+/).filter(Boolean);
  let weight: FontWeight | undefined;
  let style: FontStyle | undefined;

  // Keep at least one word for the family.
  while (parts.length > 1) {
    const last = parts[parts.length - 1];
    const lastLower = last.toLowerCase();

    if (style === undefined && isFontStyle(lastLower)) {
      style = lastLower;
      parts.pop();
      continue;
    }
    if (weight !== undefined) break;

    if (parts.length > 2) {
      const pair = weightOf(parts[parts.length - 2] + last);
      if (pair !== undefined) {
        weight = pair;
        parts.length -= 2;
        continue;
      }
    }
    const single = weightOf(last);
    if (single === undefined) break;
    weight = single;
    parts.pop();
  }

  return { font: parts.join(' ') || DEFAULT_FONT, weight, style };
}

/**
 * Reads a MapLibre/Mapbox `text-font` stack of names carrying weight and
 * style, such as `['Open Sans Semibold', 'Arial Unicode MS Bold']`. The first
 * non-blank name sets weight and style (normal if unnamed). Yields the distinct
 * families, in order; duplicates and blank names dropped.
 *
 * @returns `font`: a family list as {@link canvasFontFamily} reads it.
 */
export function parseFontStack(names: readonly string[]): { font: string; weight: FontWeight; style: FontStyle } {
  const families: string[] = [];
  let weight: FontWeight | undefined;
  let style: FontStyle | undefined;

  for (const name of names) {
    if (!name.trim()) continue;
    const parsed = parseFontName(name);
    if (families.length === 0) {
      weight = parsed.weight;
      style = parsed.style;
    }
    if (!families.includes(parsed.font)) families.push(parsed.font);
  }

  return { font: families.join(', ') || DEFAULT_FONT, weight: weight ?? DEFAULT_FONT_KEY.weight, style: style ?? DEFAULT_STYLE };
}

/**
 * Family part of a canvas `font` shorthand. Quotes every family that is
 * neither a CSS generic family nor already quoted.
 */
export function canvasFontFamily(font: string): string {
  return font
    .split(',')
    .map(name => name.trim())
    .filter(Boolean)
    .map((name) => {
      if (/^["'].*["']$/.test(name) || GENERIC_FAMILIES.has(name.toLowerCase())) return name;
      return `"${name.replace(/["\\]/g, '\\$&')}"`;
    })
    .join(', ');
}

export function fontKeyStr(key: FontKey): string {
  return `${key.font}\x00${key.weight}\x00${key.style}`;
}
