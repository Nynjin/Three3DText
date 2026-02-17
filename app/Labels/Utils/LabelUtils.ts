import { Color, Euler, Vector2, Vector3 } from "three";

export function toColor(value: string | number | Color): Color {
  if (value instanceof Color) return value.clone();
  return new Color(value);
}

export function toVector3(value: [number, number, number] | Vector3): Vector3 {
  if (value instanceof Vector3) return value.clone();
  return new Vector3(...value);
}

export function toEuler(value: [number, number, number] | Euler): Euler {
  if (value instanceof Euler) return value.clone();
  return new Euler(...value, "XYZ");
}

export function toVector2(value: [number, number] | Vector2): Vector2 {
  if (value instanceof Vector2) return value.clone();
  return new Vector2(...value);
}