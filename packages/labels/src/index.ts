/**
 * Instanced SDF labels for three.js: many labels drawn through one mesh and
 * placed so they do not overlap.
 */

export { InstancedLabelManager } from './InstancedLabelManager';

export {
  Label,
  type LabelOptions,
  type LabelBounds,
  type LabelQuad,
  type LabelChangeListener,
  type LabelChangeMask,
  type TextPadding,
  LabelChangeType,
  RotationAlignment,
  SymbolPlacement,
  TextAlign,
  TextAnchorX,
  TextAnchorY,
  TextTransform,
} from './Label';

export { type LabelManagerConfig, DefaultLabelConfig } from './Types/LabelConfig';

export type { FontKey, FontStyle, FontWeight, FontWeightName } from './Shaping/FontKey';

export type { GlyphInfo, GlyphInstance } from './Shaping/GlyphRun';

/** Settles once the RTL shaper has loaded or failed to load; never rejects. */
export { rtlReady } from './Shaping/RTL';

export type { LabelMesh } from './Rendering/LabelMeshManager';
