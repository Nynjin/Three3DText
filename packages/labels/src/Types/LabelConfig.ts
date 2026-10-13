/** Label manager settings, read live except fields marked read at construction. */
export interface LabelManagerConfig {
  /**
   * Raster size of every glyph, in px. Edges turn lumpy at twice it or more.
   * Read at construction; throws if the implied glyph cell exceeds the device's
   * texture size. A label's `fontSize` scales glyphs without rasterizing again.
   */
  atlasFontSize: number;

  /** Commit pending work on the microtask after a change. Off: commit by hand. */
  autoUpdate: boolean;

  /** Minimum time between pass starts, in ms; rounded up to a whole multiple when a pass overruns. */
  placementIntervalMs: number;

  /**
   * Placement time per frame, in ms. A target, not a cap: a frame runs at least
   * one step, and the sort is one step.
   */
  placementBudgetMs: number;

  /** Full fade in or out, in ms. `0` is instant. */
  fadeDurationMs: number;

  /** Opacity is the linear fade raised to this power. 1 is linear. */
  fadeGamma: number;

  /**
   * Collision grid at 1/`downscale` of the canvas resolution. Power of two;
   * 1 is pixel-exact, larger is faster and coarser. Read at construction.
   */
  downscale: number;

  /**
   * On-screen move, in CSS px, of a label placed by the last pass that opens a
   * pass. With none placed, any view change does.
   */
  moveThresholdPx: number;

  /**
   * How far past the screen edge, in NDC, an anchor may sit and still be
   * considered. A label is placed only with its whole box on screen.
   */
  ndcCullMargin: number;

  /** Camera distance, in world units, below which a label is not placed and fades out. `0` disables. */
  labelNear: number;
  /** Camera distance, in world units, beyond which a label is not placed and fades out. `Infinity` disables. */
  labelFar: number;

  /**
   * Squared-distance multiplier on labels not placed by the last pass: a
   * contender must be `sqrt(renderPenaltyMultiplier)` times nearer to take a
   * placed label's region.
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
