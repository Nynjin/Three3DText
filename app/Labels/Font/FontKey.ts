import { Label } from "../Core/Label";

export type FontKey = {
  font: string;
  size: number;
  weight: string;
};

export function fontKeyOf(label: Label): FontKey {
  return {
    font: label.font,
    size: label.fontSize,
    weight: label.fontWeight,
  };
}

export function fontKeyString(key: FontKey): string {
  return `${key.font}|${key.size}|${key.weight}`;
}