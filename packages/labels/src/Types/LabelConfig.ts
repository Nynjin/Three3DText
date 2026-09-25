/**
 * Label manager settings. The manager keeps its own copy, `manager.config`, and
 * reads it live, except for the fields marked as read at construction.
 */
export interface LabelManagerConfig {
  /**
   * Raster size every glyph is drawn at, in CSS px. Labels drawn at twice it or
   * more show lumpy edges. Read at construction.
   */
  atlasFontSize: number;
  /** Atlas headroom on a resize, at least 1, within the device's texture size. Read at construction. */
  atlasCapacityMultiplier: number;

  /** Commit pending work on the microtask after a change. Off means calling `update()`. */
  autoUpdate: boolean;

  /**
   * Minimum time between placement pass starts, in milliseconds, rounded up to a
   * whole multiple when a pass outruns it.
   */
  placementIntervalMs: number;

  /**
   * Time one frame spends on placement before resuming on the next, in
   * milliseconds. A target, not a cap: a frame runs at least one step, and the
   * sort is one step.
   */
  placementBudgetMs: number;

  /** Time for a label to fade fully in or out, in milliseconds. `0` shows and hides at once. */
  fadeDurationMs: number;

  /** Fade curve. 1 is linear; lower fades in faster, higher fades out faster. */
  fadeGamma: number;

  /** CSS px per occupancy cell edge, a power of two. Read at construction. */
  downscale: number;

  /**
   * Fraction of its cells, from 0 to 1, an already placed label may find taken
   * and still keep. A label placed for the first time needs all of its cells free.
   * Known issue: a small label covering less than this fraction of a large
   * placed label's box can sit on top of it.
   */
  occlusionTolerance: number;

  /**
   * Largest element-wise change of the view-projection matrix since the last
   * pass below which the camera counts as still and placement is skipped.
   * Translation elements scale with world coordinates, so a scene far from the
   * origin needs a larger value.
   */
  viewProjThreshold: number;

  /** NDC units past the cube a label's position may sit and still be projected. */
  ndcCullMargin: number;

  /** Camera distance below which a label is not placed, in world units. `0` disables it. */
  labelNear: number;
  /** Camera distance beyond which a label is not placed, in world units. `Infinity` disables it. */
  labelFar: number;

  /**
   * Sort penalty on labels not placed by the last pass: their squared distance
   * is multiplied by it, so a contender must be `sqrt(renderPenaltyMultiplier)`
   * times nearer to take a placed label's region.
   */
  renderPenaltyMultiplier: number;
}

export const DefaultLabelConfig: LabelManagerConfig = {
  atlasFontSize: 32,
  atlasCapacityMultiplier: 1.5,

  autoUpdate: true,
  placementIntervalMs: 200,
  placementBudgetMs: 3,
  fadeDurationMs: 650,
  fadeGamma: 3,

  downscale: 4,
  occlusionTolerance: 0.2,
  viewProjThreshold: 0.05,

  ndcCullMargin: 0.2,

  labelNear: 0,
  labelFar: Infinity,

  renderPenaltyMultiplier: 1.5,
};
