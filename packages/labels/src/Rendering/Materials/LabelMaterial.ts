import { type DataTexture, GLSL3, ShaderMaterial, Vector2, Vector3 } from 'three';
import { LABEL_QUAD_VERT } from '../Shaders/LabelQuad.vert.glsl';
import { LABEL_FRAG } from '../Shaders/Label.frag.glsl';
import type { SDFAtlas } from '../../Shaping/SDFAtlas';

/**
 * Label material: ink and halo, one instance per label.
 *
 * @param atlas - Distance-field atlas.
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
      uEyeHigh: { value: new Vector3() },
      uEyeLow: { value: new Vector3() },
    },
    transparent: true,
    // Blended surfaces do not write depth.
    depthWrite: false,
    depthTest: true,
  });
}
