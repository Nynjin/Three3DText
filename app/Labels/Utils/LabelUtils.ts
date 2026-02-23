import { Color, Euler, Quaternion, Vector2, Vector3 } from "three";

export function toBinary(value: boolean | 0 | 1): 0 | 1 {
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

export function toColor(value: string | number | Color | Vector3): Vector3 {
  if (value instanceof Vector3) return value.clone();
  if (value instanceof Color) return new Vector3(value.r, value.g, value.b);
  const c = new Color(value);
  return new Vector3(c.r, c.g, c.b);
}

export function toVector2(value: [number, number] | Vector2): Vector2 {
  if (value instanceof Vector2) return value.clone();
  return new Vector2(...value);
}

export function toVector3(value: [number, number, number] | Vector3): Vector3 {
  if (value instanceof Vector3) return value.clone();
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
