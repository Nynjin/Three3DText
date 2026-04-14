import { Vector2, Vector3, Quaternion } from "three";
import { RotationAlignment, SymbolPlacement } from "../Core/Label";

export interface GlyphInfo {
  px: number;
  py: number;
  pw: number;
  ph: number;

  w: number;
  h: number;
  advance: number;
  top: number;
}

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
  
  // visibility
  visible: 0 | 1;

  // glyphs belonging to this label
  glyphs: GlyphInstance[];
}

export interface GlyphInstance {
  glyph: GlyphInfo;

  // label-local position
  offset: Vector2;

  // Optional orientation (identity by default)
  rotation?: Quaternion;
}
