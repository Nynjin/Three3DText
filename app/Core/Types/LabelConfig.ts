export interface LabelManagerConfig {
  pxPerUnit: number;

  // Manager behavior
  autoUpdate: boolean;
  cullingRate: number; // in seconds
  fadeDurationMs: number;

  // Collision Grid settings
  downscale: number;
  coarseScale: number;
  acceptableOcclusion: number;
  maxOcclusion: number;
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
  coarseScale: 32,
  acceptableOcclusion: 0.1,
  maxOcclusion: 0.2,
  viewProjThreshold: 0.05,

  ndcCullMargin: 0.2,

  renderPenaltyMultiplier: 1.5,
};
