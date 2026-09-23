export interface LabelManagerConfig {
  pxPerUnit: number;

  // SDF atlas, shared by every font.
  /** Fixed raster size for every glyph. Labels scale from it, whatever their own fontSize. */
  atlasFontSize: number;
  /** Slot pre-allocation growth factor on atlas resize. */
  atlasCapacityMultiplier: number;

  // Manager behavior
  autoUpdate: boolean;
  cullingRate: number; // in seconds
  fadeDurationMs: number;

  /**
   * Gamma for fade interpolation.
   * 1 = linear
   * lower = faster fade-in, slower fade-out.
   * higher = slower fade-in, faster fade-out.
   */
  fadeGamma: number;

  // Collision Grid settings
  downscale: number;
  occlusionTolerance: number;
  viewProjThreshold: number;

  // Projector settings
  ndcCullMargin: number;

  /**
   * Camera distance, in world units, below which a label is not placed. Culls
   * labels the camera has moved into. `0` disables it.
   */
  labelNear: number;
  /**
   * Camera distance, in world units, beyond which a label is not placed.
   *
   * The candidate gate can only reject on the label's position against the view
   * frustum, so a far plane much larger than the content leaves nearly every
   * label a candidate and the expensive projection runs on all of them. This
   * bounds the set by distance instead. `Infinity` disables it.
   */
  labelFar: number;

  // Sorting settings
  renderPenaltyMultiplier: number;
}

export const DefaultLabelConfig: LabelManagerConfig = {
  pxPerUnit: 48,

  atlasFontSize: 24,
  atlasCapacityMultiplier: 1.5,

  autoUpdate: true,
  cullingRate: 0.5,
  fadeDurationMs: 500.0,
  fadeGamma: 3.0,

  downscale: 4,
  occlusionTolerance: 0.2,
  viewProjThreshold: 0.05,

  ndcCullMargin: 0.2,

  labelNear: 0,
  labelFar: Infinity,

  renderPenaltyMultiplier: 1.5,
};
