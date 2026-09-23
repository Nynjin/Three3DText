/**
 * Layout of the label data texture.
 *
 * T0: position (x, y, z, -)
 * T1: rotation quaternion (x, y, z, w)
 * T2: colour + opacity (r, g, b, a)
 * T3: halo colour + halo opacity (r, g, b, a)
 * T4: haloWidth, haloBlur, label quad centre (x, y)
 * T5: rotationAlignment, symbolPlacement, label quad size (w, h)
 *
 * The quad is the union of the label's glyph bitmaps, label-local.
 */
export const LABEL_TEXELS = 6;

/**
 * Layout of the glyph data texture.
 *
 * T0: owning label's texel index + next glyph of this label (i, next, -, -)
 * T1: offset from the label origin (x, y) + bitmap size (w, h)
 * T2: atlas position (px, py) + atlas size (pw, ph)
 *
 * A label's glyphs are a linked list: the shader starts at the head and follows
 * `next` until -1.
 */
export const GLYPH_TEXELS = 3;

/** Float within a glyph item holding the link to the label's next glyph. */
export const GLYPH_NEXT_FLOAT = 1;
