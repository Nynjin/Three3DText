const WEIGHTS = ['100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;
const STYLES = ['normal', 'italic', 'oblique'] as const;

export type FontWeight = (typeof WEIGHTS)[number];
export type FontStyle = (typeof STYLES)[number];

export type FontWeightName = keyof typeof WEIGHT_ALIASES;

/**
 * Immutable font identity. Holders share the object rather than copying it, so
 * a change must replace the key, never mutate it in place.
 */
export interface FontKey {
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

// Keyed on `string` so a token of unknown provenance resolves without a cast.
const ALIASES: ReadonlyMap<string, FontWeight> = new Map(Object.entries(WEIGHT_ALIASES));
const WEIGHT_SET: ReadonlySet<string> = new Set(WEIGHTS);
const STYLE_SET: ReadonlySet<string> = new Set(STYLES);

function isFontWeight(token: string): token is FontWeight {
  return WEIGHT_SET.has(token);
}

function isFontStyle(token: string): token is FontStyle {
  return STYLE_SET.has(token);
}

/**
 * Collapses an author-facing weight to its canonical form. Aliases must be
 * normalized before a weight reaches a {@link FontKey}, otherwise `thin` and
 * `hairline` would key two atlases for identical glyphs.
 */
export function normalizeFontWeight(value: FontWeight | FontWeightName): FontWeight {
  return isFontWeight(value) ? value : WEIGHT_ALIASES[value];
}

/**
 * Parses a descriptor such as `"Helvetica Neue Bold Italic"`. Weight and style
 * tokens are consumed from the end; whatever remains is the family name.
 */
export function parseFontDescriptor(descriptor: string): FontKey {
  const parts = descriptor.trim().split(/\s+/).filter(Boolean);
  let weight: FontWeight = DEFAULT_WEIGHT;
  let style: FontStyle = DEFAULT_STYLE;

  // Keep at least one token for the family name.
  while (parts.length > 1) {
    const token = parts[parts.length - 1].toLowerCase();

    if (isFontStyle(token)) {
      style = token;
    } else {
      const parsed = isFontWeight(token) ? token : ALIASES.get(token);
      if (parsed === undefined) break;
      weight = parsed;
    }

    parts.pop();
  }

  return {
    font: parts.join(' ') || DEFAULT_FONT,
    weight,
    style,
  };
}

export function fontKeyStr(key: FontKey): string {
  return `${key.font}\x00${key.weight}\x00${key.style}`;
}

/**
 * Prefix shared by every glyph key of one font. Resolve many characters of the
 * same font by concatenating onto this instead of rebuilding the whole key.
 */
export function glyphKeyPrefix(fontKey: FontKey): string {
  return `${fontKeyStr(fontKey)}\x00`;
}

export function glyphKey(fontKey: FontKey, char: string): string {
  return glyphKeyPrefix(fontKey) + char;
}
