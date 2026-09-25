import type { Vector2, Quaternion } from 'three';

/**
 * One glyph's bitmap and metrics. `px`/`py`/`pw`/`ph` locate the bitmap in the
 * atlas texture, in texels. The other fields are raster px in an atlas entry,
 * and CSS px on a glyph that layout placed.
 */
export interface GlyphInfo {
  /** Bitmap position in the atlas texture. */
  px: number;
  py: number;
  /** Bitmap size in the atlas texture. `0` for a glyph with no ink, such as a space. */
  pw: number;
  ph: number;

  /** Bitmap size, SDF buffer included. */
  w: number;
  h: number;
  /** Bitmap left edge, right of the pen position. */
  left: number;
  /** Bitmap top edge, above the baseline. */
  top: number;
  /** Pen advance to the next glyph. */
  advance: number;
}

export type GlyphResolver = (char: string) => GlyphInfo;

/** What layout needs to interpret {@link GlyphInfo}, in raster px. */
export interface AtlasMetrics {
  /** Raster font size the glyphs were rasterized at. */
  fontSize: number;
  /** SDF buffer around every glyph bitmap, both sides together: the ink box is `w - padding` by `h - padding`. */
  padding: number;
}

/** A glyph placed by layout. */
export interface GlyphInstance {
  glyph: GlyphInfo;

  /** Bitmap centre in label-local space, in CSS px. */
  offset: Vector2;

  /**
   * Per-glyph orientation, for text following a line.
   *
   * TODO: nothing writes or reads it yet. The label is placed as one quad, by
   * its own rotation, so this waits on `SymbolPlacement.Line`.
   */
  rotation?: Quaternion;
}
