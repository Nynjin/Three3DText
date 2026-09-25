import { type DataTexture, GLSL3, ShaderMaterial, type Vector2 } from 'three';
import { LABEL_QUAD_VERT } from '../Shaders/LabelQuad.vert.glsl';
import { LABEL_FRAG } from '../Shaders/Label.frag.glsl';
import type { SDFAtlas } from '../../Shaping/SDFAtlas';

/**
 * The material for the label pass: ink and halo together, one instance per
 * label.
 *
 * @param atlas - Atlas the shader samples the distance field from.
 * @param labelTex - Per-label data texture.
 * @param glyphTex - Per-glyph data texture.
 * @param viewport - Canvas size in CSS px, kept current by the caller.
 */
export function createLabelMaterial(
  atlas: SDFAtlas,
  labelTex: DataTexture,
  glyphTex: DataTexture,
  viewport: Vector2,
): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: LABEL_QUAD_VERT,
    fragmentShader: LABEL_FRAG,
    uniforms: {
      uAtlas: { value: atlas.texture },
      uAtlasWidth: { value: atlas.texture.width },
      uCutoff: { value: atlas.cutoff },
      uRadius: { value: atlas.radius },
      uLabelTex: { value: labelTex },
      uGlyphTex: { value: glyphTex },
      uLabelTexWidth: { value: labelTex.width },
      uGlyphTexWidth: { value: glyphTex.width },
      uViewport: { value: viewport },
    },
    transparent: true,
    // Blended surfaces do not write depth. The test stays on, so a label is
    // still occluded by anything drawn before it.
    depthWrite: false,
    depthTest: true,
  });
}

/**
 * Repoint the material at the data textures, after either was reallocated.
 *
 * @param material - Material to update.
 * @param labelTex - Per-label data texture.
 * @param glyphTex - Per-glyph data texture.
 */
export function updateLabelUniforms(
  material: ShaderMaterial,
  labelTex: DataTexture,
  glyphTex: DataTexture,
) {
  material.uniforms.uLabelTex.value = labelTex;
  material.uniforms.uGlyphTex.value = glyphTex;
  material.uniforms.uLabelTexWidth.value = labelTex.width;
  material.uniforms.uGlyphTexWidth.value = glyphTex.width;
}
