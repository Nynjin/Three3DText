import { useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { EARTH_RADIUS } from '../Utils/MakeGlobeItems';

/** Degrees between two graticule lines. */
const GRATICULE_STEP = 10;

/** Points along each graticule line: a chord of the sphere sags below it by under a kilometre. */
const LINE_POINTS = 256;

/** Height of the graticule over the sphere, in metres. */
const GRATICULE_HEIGHT = 600;

/** Segments of the sphere, around and from pole to pole. */
const SPHERE_SEGMENTS: [number, number] = [256, 128];

/** Meridians and parallels as line segments, in geocentric metres. */
function makeGraticule(): BufferGeometry {
  const radius = EARTH_RADIUS + GRATICULE_HEIGHT;
  const positions: number[] = [];

  const line = (point: (t: number) => [number, number]) => {
    for (let i = 0; i < LINE_POINTS; i++) {
      for (const t of [i / LINE_POINTS, (i + 1) / LINE_POINTS]) {
        const [lon, lat] = point(t);
        const ring = Math.cos(lat);
        positions.push(radius * ring * Math.cos(lon), radius * ring * Math.sin(lon), radius * Math.sin(lat));
      }
    }
  };

  const step = (GRATICULE_STEP * Math.PI) / 180;
  for (let lon = 0; lon < 2 * Math.PI - 1e-9; lon += step) {
    line(t => [lon, -Math.PI / 2 + t * Math.PI]);
  }
  for (let lat = -Math.PI / 2 + step; lat < Math.PI / 2 - 1e-9; lat += step) {
    line(t => [t * 2 * Math.PI, lat]);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

/**
 * A sphere of the Earth's radius with a graticule, standing in for a globe view:
 * geocentric metres, a camera from orbit down to 100 m over the surface, and a
 * logarithmic depth buffer (set on the canvas).
 */
export function Globe() {
  const graticule = useMemo(() => makeGraticule(), []);

  return (
    <>
      <mesh>
        <sphereGeometry args={[EARTH_RADIUS, ...SPHERE_SEGMENTS]} />
        <meshStandardMaterial color="#2f5d80" roughness={1} />
      </mesh>
      <lineSegments geometry={graticule}>
        <lineBasicMaterial color="#8fb7d6" />
      </lineSegments>
    </>
  );
}
