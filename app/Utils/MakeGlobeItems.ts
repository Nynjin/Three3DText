import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { mulberry32 } from './SeededRandom';
import type { Item } from '../Types/Item';
import { TextOptions } from '../Commons/Constants';
import { makeStyle } from './MakeItems';

/** Radius of the sphere standing in for the Earth, in metres: the WGS84 semi-major axis. */
export const EARTH_RADIUS = 6378137;

/** Height of the labels above the sphere, in metres. */
const LABEL_HEIGHT = 2000;

const NORTH = new Vector3(0, 0, 1);

/**
 * Items spread uniformly over the sphere, as geocentric coordinates in metres,
 * each lying flat on the surface with its text reading east and its top to the
 * north.
 *
 * @param count - Number of items.
 * @param seed - Seed of the positions and texts.
 * @param styleSeed - Offsets the style stream, as in `makeItems`.
 */
export function makeGlobeItems(count: number, seed: number, styleSeed = 0): Item[] {
  const rand = mulberry32(seed);
  const items: Item[] = new Array<Item>(count);
  const len = TextOptions.length;

  const up = new Vector3();
  const east = new Vector3();
  const north = new Vector3();
  const basis = new Matrix4();
  const orientation = new Quaternion();
  const euler = new Euler();

  for (let i = 0; i < count; i++) {
    // A uniform z gives a uniform area density on the sphere.
    const z = rand() * 2 - 1;
    const lon = rand() * Math.PI * 2;
    const ring = Math.sqrt(1 - z * z);
    up.set(ring * Math.cos(lon), ring * Math.sin(lon), z);

    east.crossVectors(NORTH, up);
    if (east.lengthSq() < 1e-12) east.set(1, 0, 0);
    east.normalize();
    north.crossVectors(up, east);

    orientation.setFromRotationMatrix(basis.makeBasis(east, north, up));
    euler.setFromQuaternion(orientation, 'XYZ');

    const text = TextOptions[Math.floor(rand() * len)];
    const radius = EARTH_RADIUS + LABEL_HEIGHT;
    items[i] = {
      key: i,
      text,
      position: [up.x * radius, up.y * radius, up.z * radius],
      rotation: [euler.x, euler.y, euler.z],
      style: makeStyle(i, text, styleSeed),
    };
  }
  return items;
}
