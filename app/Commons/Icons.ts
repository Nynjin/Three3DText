import { imageToSDF, type ImageOptions, type ImageSource, type InstancedLabelManager, type SpriteIndexEntry } from '@itowns/labels';

/** Images drawn here at 2 image px per CSS px. */
const RATIO = 2;

/** Images the demo adds to every manager, by id. */
export const DEMO_IMAGES = ['pin', 'photo', 'pin-sdf', 'dot-sdf', 'shield'] as const;
export type DemoImage = (typeof DEMO_IMAGES)[number];

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas context');
  return [c, ctx];
}

/** Teardrop map pin, tip at the bottom centre. */
function pinPath(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const r = w * 0.42;
  const cx = w / 2, cy = r + w * 0.06;
  ctx.beginPath();
  ctx.moveTo(cx, h - 1);
  ctx.bezierCurveTo(cx - r * 0.3, h * 0.72, cx - r, cy + r * 0.55, cx - r, cy);
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.bezierCurveTo(cx + r, cy + r * 0.55, cx + r * 0.3, h * 0.72, cx, h - 1);
  ctx.closePath();
}

/** Multicolour bitmap pin, 24 x 32 CSS px. */
function drawPin(): HTMLCanvasElement {
  const [c, ctx] = canvas(24 * RATIO, 32 * RATIO);
  pinPath(ctx, c.width, c.height);
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, '#ff6b4a');
  g.addColorStop(1, '#c2261a');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#7a140c';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c.width / 2, c.width * 0.48, c.width * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  return c;
}

/** Multicolour picture: a framed landscape, 28 x 22 CSS px. */
function drawPhoto(): HTMLCanvasElement {
  const [c, ctx] = canvas(28 * RATIO, 22 * RATIO);
  const w = c.width, h = c.height;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#5aa9e6');
  sky.addColorStop(1, '#bde0fe');
  ctx.fillStyle = sky;
  ctx.fillRect(3, 3, w - 6, h - 6);
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.arc(w * 0.72, h * 0.32, h * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2d6a4f';
  ctx.beginPath();
  ctx.moveTo(3, h - 3);
  ctx.lineTo(w * 0.35, h * 0.38);
  ctx.lineTo(w * 0.6, h - 3);
  ctx.fill();
  ctx.fillStyle = '#52b788';
  ctx.beginPath();
  ctx.moveTo(w * 0.4, h - 3);
  ctx.lineTo(w * 0.68, h * 0.5);
  ctx.lineTo(w - 3, h - 3);
  ctx.fill();
  return c;
}

/** One-colour pin silhouette with a hole, for an SDF. */
function drawPinMask(): HTMLCanvasElement {
  const [c, ctx] = canvas(24 * RATIO, 32 * RATIO);
  pinPath(ctx, c.width, c.height);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(c.width / 2, c.width * 0.48, c.width * 0.16, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

function drawDotMask(): HTMLCanvasElement {
  const [c, ctx] = canvas(14 * RATIO, 14 * RATIO);
  ctx.beginPath();
  ctx.arc(c.width / 2, c.height / 2, c.width / 2 - 1, 0, Math.PI * 2);
  ctx.fillStyle = '#000';
  ctx.fill();
  return c;
}

/** Road shield, 9-slice: rounded corners and a border stay put, the middle stretches. */
function drawShield(): { image: HTMLCanvasElement; options: ImageOptions } {
  const w = 40, h = 28;
  const [c, ctx] = canvas(w, h);
  const r = 7;
  const round = (x: number, y: number, ww: number, hh: number, rr: number) => {
    ctx.beginPath();
    ctx.roundRect(x, y, ww, hh, rr);
  };
  round(1, 1, w - 2, h - 2, r);
  ctx.fillStyle = '#1e5aa8';
  ctx.fill();
  round(4, 4, w - 8, h - 8, r - 3);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  return {
    image: c,
    options: { pixelRatio: RATIO, stretchX: [[10, 30]], stretchY: [[10, 18]], content: [7, 6, 33, 22] },
  };
}

/** Adds the demo images to a manager. */
export function addDemoImages(manager: InstancedLabelManager) {
  manager.addImage('pin', drawPin(), { pixelRatio: RATIO });
  manager.addImage('photo', drawPhoto(), { pixelRatio: RATIO });
  manager.addImage('pin-sdf', imageToSDF(drawPinMask(), 6 * RATIO), { pixelRatio: RATIO, sdf: true });
  manager.addImage('dot-sdf', imageToSDF(drawDotMask(), 6 * RATIO), { pixelRatio: RATIO, sdf: true });
  const shield = drawShield();
  manager.addImage('shield', shield.image, shield.options);
}

export interface Sprite {
  index: Record<string, SpriteIndexEntry>;
  sheet: ImageSource;
}

/**
 * Loads a MapLibre/Mapbox sprite: `<url>.json` and `<url>.png`, or their `@2x`.
 *
 * @throws {Error} If either file fails to load.
 */
export async function loadSprite(url: string, hiDpi: boolean): Promise<Sprite> {
  const base = url.replace(/(@2x)?\.(json|png)$/, '') + (hiDpi ? '@2x' : '');
  const [indexResponse, sheet] = await Promise.all([
    fetch(`${base}.json`),
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load ${base}.png`));
      img.src = `${base}.png`;
    }),
  ]);
  if (!indexResponse.ok) throw new Error(`Could not load ${base}.json (${indexResponse.status})`);
  return { index: await indexResponse.json() as Record<string, SpriteIndexEntry>, sheet };
}
