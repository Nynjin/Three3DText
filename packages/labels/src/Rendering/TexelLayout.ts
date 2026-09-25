/**
 * Layout of the label data texture, one item per label.
 *
 * T0: position in world units (x, y, z, -)
 * T1: rotation quaternion (x, y, z, w)
 * T2: colour (r, g, b), opacity
 * T3: halo colour (r, g, b), halo opacity times opacity, 0 without a halo
 * T4: haloWidth, haloBlur, quad centre (x, y); all in CSS px
 * T5: rotationAlignment, symbolPlacement, quad size (w, h) in CSS px
 *
 * The quad is the union of the label's glyph bitmaps, label-local.
 */
export const LABEL_TEXELS = 6;

/**
 * Layout of the glyph data texture, one item per glyph with ink.
 *
 * T0: texel index of the label's next glyph, -1 at the end (next, -, -, -)
 * T1: bitmap centre (x, y) and size (w, h), label-local, in CSS px
 * T2: bitmap origin (px, py) and size (pw, ph), in atlas texels
 */
export const GLYPH_TEXELS = 3;

/** Float within a glyph item holding the link to the label's next glyph. */
export const GLYPH_NEXT_FLOAT = 0;
