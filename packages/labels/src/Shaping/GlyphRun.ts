import type { Vector2, Quaternion } from 'three';

/**
 * One glyph's bitmap and metrics. `px`/`py`/`pw`/`ph`: atlas texels. Other
 * fields: raster px in an atlas entry, CSS px once placed by layout.
 */
export interface GlyphInfo {
  /** Bitmap position in the atlas. */
  px: number;
  py: number;
  /** Bitmap size in the atlas. `0` for an inkless glyph, such as a space. */
  pw: number;
  ph: number;

  /** Bitmap size, SDF buffer included. */
  w: number;
  h: number;
  /** Bitmap left edge, right of the pen position. */
  left: number;
  /** Bitmap top edge, above the baseline. */
  top: number;
  /** Pen advance. */
  advance: number;
}

export type GlyphResolver = (char: string) => GlyphInfo;

/** For reading {@link GlyphInfo}. Raster px. */
export interface AtlasMetrics {
  /** Rasterization font size. */
  fontSize: number;
  /** SDF buffer, both sides summed: the ink box is `w - padding` by `h - padding`. */
  padding: number;
}

/** A glyph placed by layout. */
export interface GlyphInstance {
  glyph: GlyphInfo;

  /** Bitmap centre in label-local space, in CSS px. */
  offset: Vector2;

  /**
   * Per-glyph orientation, for line-following text.
   *
   * TODO: unused; the label draws as one quad.
   */
  rotation?: Quaternion;
}
