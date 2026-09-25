import { mulberry32 } from './SeededRandom';
import type { Item, ItemStyle } from '../Types/Item';
import { TextOptions, haloColorOf } from '../Commons/Constants';

const FONTS = ['Arial', 'Georgia', 'Verdana', 'Tahoma', 'Trebuchet MS'];
const FONT_WEIGHTS = [400, 600, 700] as const;
const FONT_STYLES = ['normal', 'italic'] as const;
const FONT_SIZES = [16, 18, 22, 28, 36, 48];
const FILL_COLORS = ['#14181c', '#1d2b36', '#2c2118', '#331c24', '#17301f'];

/** Label font size, in CSS px, that Troika, UIKit and CSS3D draw at their base size. */
export const BASE_FONT_SIZE_PX = 24;

function pick<T>(values: readonly T[], random: () => number): T {
  return values[Math.floor(random() * values.length)];
}

/**
 * Style for one item, from a stream keyed by the item so it does not depend on
 * how many items were generated before it. The halo colour marks the text's
 * language group.
 *
 * @param key - Item key.
 * @param text - Item text.
 * @param styleSeed - Offsets the stream; the same key and seed give the same style.
 */
export function makeStyle(key: number, text: string, styleSeed = 0): ItemStyle {
  const random = mulberry32(key + styleSeed);
  // Reordering these draws restyles every item, so runs stop being comparable.
  const fillColor = pick(FILL_COLORS, random);
  const haloColor = haloColorOf(text);
  const fontFamily = pick(FONTS, random);
  const fontWeight = pick(FONT_WEIGHTS, random);
  const fontStyle = pick(FONT_STYLES, random);
  const fontSizePx = pick(FONT_SIZES, random);
  return { fontFamily, fontWeight, fontStyle, fontSizePx, fillColor, haloColor };
}

export function makeItems(count: number, seed: number, styleSeed = 0): Item[] {
  const rand = mulberry32(seed);
  const items: Item[] = new Array<Item>(count);
  const len = TextOptions.length;
  for (let i = 0; i < count; i++) {
    // Half-extents per unit depth of the 45 deg, 16:9 camera, pulled in a bit:
    // x and y scale with depth.
    const z = rand() * -100;
    const depth = 50 - z;
    const x = (rand() * 2 - 1) * 0.68 * depth;
    const y = (rand() * 2 - 1) * 0.38 * depth;
    const rotX = (rand() - 0.5) * Math.PI * 0.33;
    const rotY = (rand() - 0.5) * Math.PI * 0.33;
    const rotZ = (rand() - 0.5) * Math.PI * 0.33;
    const text = TextOptions[Math.floor(rand() * len)];
    items[i] = {
      key: i,
      text,
      position: [x, y, z],
      rotation: [rotX, rotY, rotZ],
      style: makeStyle(i, text, styleSeed),
    };
  }
  return items;
}
