import type { Vector2, Quaternion } from 'three';

export interface GlyphInfo {
  px: number;
  py: number;
  pw: number;
  ph: number;

  w: number;
  h: number;
  advance: number;
  top: number;
}

export type GlyphResolver = (char: string) => GlyphInfo;

/**
 * The atlas properties layout needs to interpret {@link GlyphInfo}. Both are in
 * the same em units, so they scale together to a label's own `fontSize`.
 */
export interface AtlasMetrics {
  /**
   * Em size the stored metrics correspond to — the atlas's raster size divided
   * by its SDF oversampling, since {@link GlyphInfo} is stored pre-divided.
   */
  fontSize: number;
  /**
   * SDF buffer baked into every glyph quad, total across both sides — the room
   * the halo renders into, not part of the glyph's ink. The ink is centred in
   * the quad, so the ink box is `w - padding` by `h - padding`.
   */
  padding: number;
}

export interface GlyphInstance {
  glyph: GlyphInfo;

  // label-local position
  offset: Vector2;

  // Optional orientation (identity by default)
  rotation?: Quaternion;
}
