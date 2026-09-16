import { mulberry32 } from './SeededRandom';
import type { Item } from '../Types/Item';
import { TextOptions } from '../Commons/Constants';

export function makeItems(count: number, seed: number): Item[] {
  const rand = mulberry32(seed);
  const items: Item[] = new Array<Item>(count);
  const len = TextOptions.length;
  for (let i = 0; i < count; i++) {
    // Spread scales with depth so the cloud fills the frustum, not a box.
    // Factors are the half-extents of the 45 deg / 16:9 camera, pulled in a bit.
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
    };
  }
  return items;
}
