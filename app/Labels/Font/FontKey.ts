import { Label } from "../Core/Label";

export type FontKey = {
  font: string;
  fontSize: number;
  fontWeight: string;
};

export function fontKeyOf(label: Label): FontKey {
  return {
    font: label.font,
    fontSize: label.fontSize,
    fontWeight: label.fontWeight,
  };
}

export function fontKeyString(key: FontKey): string {
  return `${key.font}|${key.fontSize}|${key.fontWeight}`;
}