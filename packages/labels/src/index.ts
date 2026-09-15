/**
 * Instanced SDF labels for three.js.
 *
 * Everything needed to create, configure and drive labels is re-exported here.
 * The API is plain classes and functions over a three.js `WebGLRenderer` and
 * `Camera`.
 */

// Manager — the entry point. Owns the atlas, the mesh pair and the collision pass.
export { InstancedLabelManager, type LabelMeshPair } from './InstancedLabelManager';

// Label — the unit of content, and every option/enum needed to describe one.
export {
  Label,
  type LabelOptions,
  type LabelBounds,
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

// Manager configuration and its defaults.
export { type LabelManagerConfig, DefaultLabelConfig } from './Types/LabelConfig';

// Font descriptors — parsing and normalizing the `font` string on a Label.
export {
  type FontKey,
  type FontStyle,
  type FontWeight,
  type FontWeightName,
  DEFAULT_FONT,
  DEFAULT_FONT_KEY,
  DEFAULT_STYLE,
  DEFAULT_WEIGHT,
  fontKeyStr,
  normalizeFontWeight,
  parseFontDescriptor,
} from './Shaping/FontKey';

// Glyph and atlas shapes, for consumers inspecting layout output.
export type {
  AtlasMetrics,
  GlyphInfo,
  GlyphInstance,
  GlyphResolver,
} from './Shaping/GlyphRun';

// SDF atlas — exposed for advanced use (pre-warming, custom glyph sets).
export { SDFAtlas, type SDFAtlasOptions, type FontChars, FALLBACK_CHAR } from './Shaping/SDFAtlas';

// RTL shaping readiness: resolves once the WASM-backed shaper is live.
export { rtlReady } from './Shaping/RTL';

// The mesh type the manager hands back, for typing scene-graph code.
export type { LabelMesh } from './Rendering/LabelMeshManager';

// Collision internals — useful for benchmarking and custom placement passes.
export { LabelCollisionEngine } from './Collision/LabelCollisionEngine';
export { LabelProjector, type ScreenAABB } from './Collision/LabelProjector';
export { BitmapOccupancy } from './Collision/BitmapOccupancy';
