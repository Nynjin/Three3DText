import { type DataTexture, GLSL3, ShaderMaterial, Vector2 } from 'three';
import { LABEL_QUAD_VERT } from '../Shaders/LabelQuad.vert.glsl';
import { LABEL_FRAG } from '../Shaders/Label.frag.glsl';
import type { SDFAtlas } from '../../Shaping/SDFAtlas';

/**
 * The label material: ink and halo together, one instance per label.
 *
 * @param atlas - Atlas the shader samples the distance field from.
 * @param labelTex - Per-label data texture.
 * @param glyphTex - Per-glyph data texture.
 */
export function createLabelMaterial(
  atlas: SDFAtlas,
  labelTex: DataTexture,
  glyphTex: DataTexture,
): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: LABEL_QUAD_VERT,
    fragmentShader: LABEL_FRAG,
    uniforms: {
      uAtlas: { value: atlas.texture },
      uCutoff: { value: atlas.cutoff },
      uRadius: { value: atlas.radius },
      uLabelTex: { value: labelTex },
      uGlyphTex: { value: glyphTex },
      uViewport: { value: new Vector2(1, 1) },
    },
    transparent: true,
    // Blended surfaces do not write depth. The test stays on, so a label is
    // still occluded by anything drawn before it.
    depthWrite: false,
    depthTest: true,
  });
}
