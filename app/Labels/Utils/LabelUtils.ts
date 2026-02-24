import { Color, Euler, Quaternion, Vector2, Vector3 } from "three";
import { LabelInstance } from "../Layout/GlyphRun";
import { Label } from "../Core/Label";

export function toBinary(value: boolean | 0 | 1): 0 | 1 {
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

export function toColor(value: string | number | Color | Vector3): Color {
  if (value instanceof Color) return value.clone();
  if (value instanceof Vector3) return new Color(value.x, value.y, value.z);
  return new Color(value);
}

export function toVector2(value: [number, number] | Vector2): Vector2 {
  if (value instanceof Vector2) return value.clone();
  return new Vector2(...value);
}

export function toVector3(value: [number, number, number] | Vector3 | Color): Vector3 {
  if (value instanceof Vector3) return value.clone();
  if (value instanceof Color) return new Vector3(value.r, value.g, value.b);
  return new Vector3(...value);
}

export function toEuler(value: [number, number, number] | Euler): Euler {
  if (value instanceof Euler) return value.clone();
  return new Euler(...value, "XYZ");
}

export function toQuaternion(value: [number, number, number] | Euler | Quaternion): Quaternion {
  if (value instanceof Quaternion) return value.clone();
  if (value instanceof Euler) return new Quaternion().setFromEuler(value);
  return new Quaternion().setFromEuler(new Euler(...value, "XYZ"));
}

export function toLabelInstance(label: Label): LabelInstance {
  return {
    ...label,
    position: label.position.clone(),
    rotation: label.rotation.clone(),
    color: toVector3(label.color),
    haloColor: toVector3(label.haloColor),
    haloOpacity: label.hasHalo() ? label.haloOpacity : 0,
    visible: (label.opacity + label.haloOpacity > 0 && label.visible) ? 1 : 0,
    glyphs: [],
  };
}