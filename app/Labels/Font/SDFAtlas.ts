import TinySDF from "@mapbox/tiny-sdf";
import { CanvasTexture } from "three";
import { FontKey } from "./FontKey";

// TODO : try generating larger canva then downsample for better text quality

export interface GlyphInfo {
  uv: number[];
  w: number;
  h: number;
  advance: number;
  top: number;
}

export interface SDFAtlas {
  texture: CanvasTexture;
  glyphs: Map<string, GlyphInfo>;
  cutoff: number;
  radius: number;
}

export default function buildSDFAtlas(
  chars: string[],
  fontKey: FontKey
): SDFAtlas {
  // ensure enough glyph space for halo and blur without artefacts
  const buffer = fontKey.size / 2,
    radius = fontKey.size,
    cutoff = 0.5;
  const sdf = new TinySDF({
    fontSize: fontKey.size,
    fontFamily: fontKey.font,
    fontWeight: fontKey.weight,
    buffer,
    radius,
    cutoff,
  });

  const cellSize = fontKey.size + buffer * 2;
  const cols = Math.ceil(Math.sqrt(chars.length));
  const atlasW = cols * cellSize;
  const atlasH = Math.ceil(chars.length / cols) * cellSize;

  const canvas = document.createElement("canvas");
  canvas.width = atlasW;
  canvas.height = atlasH;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, atlasW, atlasH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const glyphs = new Map<string, GlyphInfo>();

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const x = (i % cols) * cellSize;
    const y = Math.floor(i / cols) * cellSize;
    const g = sdf.draw(c);

    if (g.width > 0 && g.height > 0) {
      const img = ctx.createImageData(g.width, g.height);
      for (let j = 0; j < g.data.length; j++) {
        img.data[j * 4] = img.data[j * 4 + 1] = img.data[j * 4 + 2] = g.data[j];
        img.data[j * 4 + 3] = 255;
      }
      ctx.putImageData(img, x, y);
    }

    glyphs.set(c, {
      uv: [
        x / atlasW,
        y / atlasH,
        (x + g.width) / atlasW,
        (y + g.height) / atlasH,
      ],
      w: g.width || 1,
      h: g.height || 1,
      advance: g.glyphAdvance,
      top: g.glyphTop,
    });
  };

  const texture = new CanvasTexture(canvas);
  texture.flipY = false;
  texture.generateMipmaps = true;

  canvas.remove();

  return {
    texture,
    glyphs,
    cutoff,
    radius,
  };
}
