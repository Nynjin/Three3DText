import TinySDF from "@mapbox/tiny-sdf";
import { CanvasTexture, LinearFilter } from "three";

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
  fontSize: number;
  cutoff: number;
  radius: number;
}

export default function buildSDFAtlas(
  chars: string,
  fontSize: number,
  fontFamily: string,
  fontWeight: string
): SDFAtlas {
  // ensure enough glyph space for halo and blur without artefacts
  const buffer = fontSize / 2,
    radius = fontSize,
    cutoff = 0.5;
  const sdf = new TinySDF({
    fontSize,
    fontFamily,
    fontWeight,
    buffer,
    radius,
    cutoff,
  });

  const uniqueChars = [...new Set(chars)];
  const cellSize = fontSize + buffer * 2;
  const cols = Math.ceil(Math.sqrt(uniqueChars.length));
  const atlasW = cols * cellSize;
  const atlasH = Math.ceil(uniqueChars.length / cols) * cellSize;

  const canvas = document.createElement("canvas");
  canvas.width = atlasW;
  canvas.height = atlasH;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, atlasW, atlasH);

  const glyphs = new Map<string, GlyphInfo>();

  uniqueChars.forEach((char, i) => {
    const x = (i % cols) * cellSize;
    const y = Math.floor(i / cols) * cellSize;
    const g = sdf.draw(char);

    if (g.width > 0 && g.height > 0) {
      const img = ctx.createImageData(g.width, g.height);
      for (let j = 0; j < g.data.length; j++) {
        img.data[j * 4] = img.data[j * 4 + 1] = img.data[j * 4 + 2] = g.data[j];
        img.data[j * 4 + 3] = 255;
      }
      ctx.putImageData(img, x, y);
    }

    glyphs.set(char, {
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
  });

  const texture = new CanvasTexture(canvas);
  texture.flipY = false;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;

  canvas.remove();

  return {
    texture,
    glyphs,
    fontSize,
    cutoff,
    radius,
  };
}
