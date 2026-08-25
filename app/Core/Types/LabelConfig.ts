export interface LabelManagerConfig {
  pxPerUnit: number;

  // Manager behavior
  autoUpdate: boolean;
  cullingRate: number; // in seconds
  fadeDurationMs: number;

  // Collision Grid settings
  downscale: number;
  occlusionTolerance: number;
  viewProjThreshold: number;

  // Projector settings
  ndcCullMargin: number;

  // Sorting settings
  renderPenaltyMultiplier: number;
}

export const DefaultLabelConfig: LabelManagerConfig = {
  pxPerUnit: 48,

  autoUpdate: true,
  cullingRate: 0.5,
  fadeDurationMs: 300.0,

  downscale: 4,
  occlusionTolerance: 0.2,
  viewProjThreshold: 0.05,

  ndcCullMargin: 0.2,

  renderPenaltyMultiplier: 1.5,
};
