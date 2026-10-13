/** Instanced SDF labels for three.js: many labels in one mesh, placed without overlap. */

export { InstancedLabelManager } from './InstancedLabelManager';

export {
  Label,
  type LabelOptions,
  type LabelBounds,
  type LabelQuad,
  type LabelChangeListener,
  type LabelChangeMask,
  type TextPadding,
  type SymbolAnchor,
  type IconTextFit,
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

export { rtlReady } from './Shaping/RTL';

export type { ImageSource, ImageOptions, SpriteIndexEntry } from './Images/ImageAtlas';

export { imageToSDF } from './Images/ImageSDF';

export type { LabelMesh } from './Rendering/LabelMeshManager';
