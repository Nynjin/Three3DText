import { Color, Euler, Quaternion, Vector2, Vector3 } from "three";
// @ts-expect-error - no types available
import rtlText from '@mapbox/mapbox-gl-rtl-text';

const { applyArabicShaping, processBidirectionalText } = await rtlText;

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

export function toVector3(
  value: [number, number, number] | Vector3 | Color,
): Vector3 {
  if (value instanceof Vector3) return value.clone();
  if (value instanceof Color) return new Vector3(value.r, value.g, value.b);
  return new Vector3(...value);
}

export function toEuler(value: [number, number, number] | Euler): Euler {
  if (value instanceof Euler) return value.clone();
  return new Euler(...value, "XYZ");
}

export function toQuaternion(
  value: [number, number, number] | Euler | Quaternion,
): Quaternion {
  if (value instanceof Quaternion) return value.clone();
  if (value instanceof Euler) return new Quaternion().setFromEuler(value);
  return new Quaternion().setFromEuler(new Euler(...value, "XYZ"));
}



export function applyShaping(text: string): string {
  if (!text) {return text};
  return applyArabicShaping(text);
}

export function reorderParagraph(text: string, breakIndices: number[]): string[] {
  if (!text) {return [""]};
  return processBidirectionalText(text, breakIndices);
}

export function isParagraphRTL(text: string): boolean {
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    // Strongly RTL: Hebrew, Arabic, Syriac, Thaana, NKo, etc.
    if (
      (cp >= 0x0590 && cp <= 0x08FF) ||
      (cp >= 0xFB1D && cp <= 0xFDFF) ||
      (cp >= 0xFE70 && cp <= 0xFEFF)
    ) return true;
    // Strongly LTR: Latin, Greek, Cyrillic, etc.
    if (
      (cp >= 0x0041 && cp <= 0x007A) ||
      (cp >= 0x00C0 && cp <= 0x024F) ||
      (cp >= 0x0370 && cp <= 0x03FF) ||
      (cp >= 0x0400 && cp <= 0x04FF)
    ) return false;
  }
  return false;
}
