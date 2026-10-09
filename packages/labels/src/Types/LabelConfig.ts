/**
 * Label manager settings. The manager keeps its own copy, `manager.config`, and
 * reads it live, except for the fields marked as read at construction.
 */
export interface LabelManagerConfig {
  /**
   * Font size every glyph is rasterized at, in raster px. Labels drawn at twice it or
   * more show lumpy edges. Read at construction. Construction throws if the
   * glyph cell this size implies exceeds the device's texture size. A label's
   * `fontSize` scales the glyphs; changing it never rasterizes them again.
   */
  atlasFontSize: number;

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

  /** Opacity is the linear fade raised to this power, over the same fade time. 1 is linear. */
  fadeGamma: number;

  /**
   * Factor the screen is divided by, on each axis, to get the collision grid: a
   * cell covers `downscale` × `downscale` CSS px. A power of two. Larger is
   * faster and spaces labels more coarsely; 1 is pixel-exact. Read at construction.
   */
  downscale: number;

  /**
   * CSS px some label placed by the last pass has to move on screen before the
   * view counts as moved and a pass opens. With no label placed, any change of
   * the view counts.
   */
  moveThresholdPx: number;

  /**
   * NDC units past the screen edge a label's anchor may sit and still be
   * considered. A label is placed only when its whole box is on screen.
   */
  ndcCullMargin: number;

  /** Camera distance below which a label is not placed and fades out, in world units. `0` disables it. */
  labelNear: number;
  /**
   * Camera distance beyond which a label is not placed and fades out, in world
   * units. `Infinity` disables it.
   */
  labelFar: number;

  /**
   * Sort penalty on labels not placed by the last pass: their squared distance
   * is multiplied by it, so a contender must be `sqrt(renderPenaltyMultiplier)`
   * times nearer to take a placed label's region.
   */
  renderPenaltyMultiplier: number;

  /** Whether what was drawn before the labels hides them. */
  depthTest: boolean;
}

export const DefaultLabelConfig: LabelManagerConfig = {
  atlasFontSize: 32,

  autoUpdate: true,
  placementIntervalMs: 200,
  placementBudgetMs: 3,
  fadeDurationMs: 650,
  fadeGamma: 3,

  downscale: 4,
  moveThresholdPx: 1,

  ndcCullMargin: 0.2,

  labelNear: 0,
  labelFar: Infinity,

  renderPenaltyMultiplier: 1.5,

  depthTest: false,
};
