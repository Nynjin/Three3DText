export interface LabelManagerConfig {
  // SDF atlas, shared by every font.
  /** Fixed raster size for every glyph. Labels scale from it, whatever their own fontSize. */
  atlasFontSize: number;
  /** Atlas headroom on a resize, at least 1, within the device's texture size. */
  atlasCapacityMultiplier: number;

  /** Commit pending work on the microtask after a change. Off means calling `update()`. */
  autoUpdate: boolean;

  /**
   * Minimum seconds between placement pass starts, rounded up to a whole
   * multiple when a pass outruns it. Far below `fadeDurationMs` reads as flicker.
   */
  cullingRate: number;

  /** Milliseconds one frame may spend on placement. A pass resumes across frames. */
  placementBudgetMs: number;

  /** Milliseconds for a label to fade fully in or out. */
  fadeDurationMs: number;

  /** Fade curve. 1 is linear; lower fades in faster, higher fades out faster. */
  fadeGamma: number;

  // Collision Grid settings

  /**
   * Screen pixels per occupancy cell, a power of two, read once at construction.
   * Coarser cells pack fewer labels; 4 costs 16 KiB at 1080p.
   */
  downscale: number;

  /**
   * Fraction of its cells an already placed label may find taken and still keep.
   * A label placed for the first time needs all of its cells free.
   */
  occlusionTolerance: number;

  /** View-projection change below which the camera counts as still and placement is skipped. */
  viewProjThreshold: number;

  // Projector settings

  /** NDC units past the cube a label's position may sit and still be projected. */
  ndcCullMargin: number;

  /** Camera distance below which a label is not placed. `0` disables it. */
  labelNear: number;
  /** Camera distance beyond which a label is not placed. `Infinity` disables it. */
  labelFar: number;

  // Sorting settings

  /**
   * Sort penalty on unplaced labels, against squared distance: a contender must
   * be `sqrt(renderPenaltyMultiplier)` times nearer to take a placed region.
   */
  renderPenaltyMultiplier: number;
}

export const DefaultLabelConfig: LabelManagerConfig = {
  atlasFontSize: 24,
  atlasCapacityMultiplier: 1.5,

  autoUpdate: true,
  cullingRate: 0.2,
  placementBudgetMs: 3,
  fadeDurationMs: 650.0,
  fadeGamma: 3.0,

  downscale: 4,
  occlusionTolerance: 0.2,
  viewProjThreshold: 0.05,

  ndcCullMargin: 0.2,

  labelNear: 0,
  labelFar: Infinity,

  renderPenaltyMultiplier: 1.5,
};
