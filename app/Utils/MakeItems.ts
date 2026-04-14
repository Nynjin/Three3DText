import { mulberry32 } from "./SeededRandom";
import type { Item } from "../Types/Item";
import { TextOptions } from "../Commons/Constants";

export function makeItems(count: number, seed: number): Item[] {
  const rand = mulberry32(seed);
  const items: Item[] = new Array(count);
  const len = TextOptions.length;
  for (let i = 0; i < count; i++) {
    const x = rand() * 30 - 15;
    const y = rand() * 30 - 15;
    const z = rand() * -100;
    const rotX = (rand() - 0.5) * Math.PI * 0.33;
    const rotY = (rand() - 0.5) * Math.PI * 0.33;
    const rotZ = (rand() - 0.5) * Math.PI * 0.33;
    const idx = len ? Math.floor(rand() * len) : 0;
    const text = len ? TextOptions[idx] : "";
    items[i] = {
      key: i,
      text,
      position: [x, y, z],
      rotation: [rotX, rotY, rotZ],
    };
  }
  return items;
}
