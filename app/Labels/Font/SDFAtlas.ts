import TinySDF from "@mapbox/tiny-sdf";
import { CanvasTexture, LinearFilter, LinearMipMapLinearFilter } from "three";
import { FontKey } from "./FontKey";

const SCALE = 2;
const CAPACITY_MULTIPLIER = 2;

export interface GlyphInfo {
  uv: number[];
  w: number;
  h: number;
  advance: number;
  top: number;
}

export class SDFAtlas {
  readonly texture: CanvasTexture;
  readonly glyphs: Map<string, GlyphInfo> = new Map();
  readonly cutoff: number;
  readonly radius: number;

  private _canvas: HTMLCanvasElement;
  private _ctx: CanvasRenderingContext2D;
  private _sdf: TinySDF;
  private _cellSize: number;
  private _cols: number;
  private _capacity: number;
  private _slotCount = 0;

  constructor(chars: string[], fontKey: FontKey) {
    const buffer = fontKey.size * 2;
    this.radius = buffer;
    this.cutoff = 0.5;

    this._sdf = new TinySDF({
      fontSize: fontKey.size * SCALE,
      fontFamily: fontKey.font,
      fontWeight: fontKey.weight,
      buffer: buffer * SCALE,
      radius: buffer * SCALE,
      cutoff: this.cutoff,
    });

    this._cellSize = (fontKey.size + buffer * 2) * SCALE;
    this._capacity = Math.max(8, Math.ceil(chars.length * CAPACITY_MULTIPLIER));
    this._cols = Math.ceil(Math.sqrt(this._capacity));
    const rows = Math.ceil(this._capacity / this._cols);

    this._canvas = document.createElement("canvas");
    this._canvas.width  = this._cols * this._cellSize;
    this._canvas.height = rows      * this._cellSize;
    this._ctx = this._canvas.getContext("2d")!;
    this._ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);

    this._drawChars(chars);

    this.texture = new CanvasTexture(this._canvas);
    this.texture.flipY = false;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = LinearMipMapLinearFilter;
    this.texture.magFilter = LinearFilter;
  }

  addChars(chars: Iterable<string>): boolean {
    const newChars: string[] = [];
    for (const c of chars) {
      if (!this.glyphs.has(c)) newChars.push(c);
    }
    if (newChars.length === 0) return false;

    if (this._slotCount + newChars.length > this._capacity) {
      this._resize(this._slotCount + newChars.length);
    }

    this._drawChars(newChars);
    this.texture.needsUpdate = true;
    return true;
  }

  dispose() {
    this.texture.dispose();
    this._canvas.remove();
  }

  private _drawChars(chars: string[]) {
    for (const c of chars) {
      if (this.glyphs.has(c)) continue;
      const slot = this._slotCount++;
      const x = (slot % this._cols) * this._cellSize;
      const y = Math.floor(slot / this._cols) * this._cellSize;
      const g = this._sdf.draw(c);

      if (g.width > 0 && g.height > 0) {
        const img = this._ctx.createImageData(g.width, g.height);
        for (let j = 0; j < g.data.length; j++) {
          img.data[j * 4]     = g.data[j];
          img.data[j * 4 + 1] = g.data[j];
          img.data[j * 4 + 2] = g.data[j];
          img.data[j * 4 + 3] = 255;
        }
        this._ctx.putImageData(img, x, y);
      }

      const W = this._canvas.width, H = this._canvas.height;
      this.glyphs.set(c, {
        uv: [x / W, y / H, (x + g.width) / W, (y + g.height) / H],
        w:       g.width        / SCALE || 1,
        h:       g.height       / SCALE || 1,
        advance: g.glyphAdvance / SCALE || 1,
        top:     g.glyphTop     / SCALE || 0,
      });
    }
  }

  private _resize(minChars: number) {
    this._capacity = Math.ceil(minChars * CAPACITY_MULTIPLIER);
    this._cols = Math.ceil(Math.sqrt(this._capacity));
    const rows = Math.ceil(this._capacity / this._cols);

    const oldCanvas = this._canvas;
    this._canvas = document.createElement("canvas");
    this._canvas.width  = this._cols * this._cellSize;
    this._canvas.height = rows      * this._cellSize;
    this._ctx = this._canvas.getContext("2d")!;
    this._ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);

    const allChars = [...this.glyphs.keys()];
    this.glyphs.clear();
    this._slotCount = 0;
    this._drawChars(allChars);

    oldCanvas.remove();
    this.texture.image = this._canvas;
  }
}
