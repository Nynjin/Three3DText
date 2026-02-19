import { Vector2, Vector3, Quaternion } from "three";
import type { GlyphInfo } from "../Font/SDFAtlas";
import { RotationAlignment, SymbolPlacement } from "../Core/Label";

export interface LabelInstance {
  // Unique identifier linked to the source Label
  id: string;

  // world anchor
  position: Vector3;

  // visual style
  color: Vector3;
  haloColor: Vector3;
  opacity: number;
  haloOpacity: number;
  haloWidth: number;
  haloBlur: number;

  // orientation
  rotation: Quaternion;
  rotationAlignment: RotationAlignment;
  symbolPlacement: SymbolPlacement;

  // glyphs belonging to this label
  glyphs: GlyphInstance[];
}

export interface GlyphInstance {
  glyph: GlyphInfo;

  // label-local position
  offset: Vector2;

  // OPTIONAL orientation (identity by default)
  rotation?: Quaternion;
}

export interface GlyphRun {
  glyphs: GlyphInstance[];

  width: number;
  height: number;

  // layout-space bounding box
  bounds: {
    min: Vector2;
    max: Vector2;
  };
}
