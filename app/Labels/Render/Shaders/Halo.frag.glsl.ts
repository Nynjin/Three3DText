export const HALO_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uAtlas;
uniform float uCutoff;
uniform float uRadius;

varying vec2 vUv;
varying vec4 vUvRect;
varying vec4 vHaloColor;
varying float vHaloOpacity;
varying float vHaloWidth;
varying float vHaloBlur;
varying float vHaloPadding;

void main() {
  // Sample SDF
  vec2 atlasUV = mix(vUvRect.xy, vUvRect.zw, vUv);

  float sdf = texture2D(uAtlas, atlasUV).r;
  float fw = fwidth(sdf);

  // Signed distance from glyph edge in SDF units
  float signedDist = sdf - uCutoff;

  // Distance from glyph edge in SDF units (positive = outside glyph)
  float d = max(-signedDist, 0.0);

  // Scale halo width and blur to SDF units
  float haloWidthSDF = vHaloWidth * fw;
  float haloBlurSDF = vHaloBlur * fw;

  // Ensure minimum blur
  float effectiveBlur = max(haloBlurSDF, fw);

  // Calculate halo alpha with a Gaussian falloff
  float t = max(d - haloWidthSDF, 0.0) / max(effectiveBlur, 1e-5);
  float alpha = exp(-50.0 * t * t);

  // Discard low alpha to limit artefacts
  if (alpha <= 0.25) {
    discard;
  }

  gl_FragColor = vec4(vHaloColor.rgb, alpha * vHaloOpacity);
}
`;