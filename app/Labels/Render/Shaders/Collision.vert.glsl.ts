export const COLLISION_VERT = /* glsl */ `
precision highp float;

attribute vec3 instancePosition;
attribute vec2 instanceBounds;
attribute vec2 instanceAnchor;
attribute vec4 instanceRotation;
attribute float instanceRotationAlignment;
attribute vec3 instanceColor;

varying vec3 vIdColor;

vec3 rotateByQuat(vec3 v, vec4 q) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

float getDistanceScale(vec3 labelPos) {
  vec4 viewPos = modelViewMatrix * vec4(labelPos, 1.0);
  return length(viewPos.xyz);
}

void main() {
  vec2 localSize = instanceBounds;
  vec2 localOrigin = instanceAnchor;
  vec2 local2 = (position.xy + vec2(0.5)) * localSize + localOrigin;

  float sizeScale = getDistanceScale(instancePosition);
  vec3 local = vec3(local2 * sizeScale, 0.0);

  vIdColor = instanceColor;

  if (instanceRotationAlignment > 0.5) {
    vec4 centerVS = viewMatrix * vec4(instancePosition, 1.0);
    vec3 posVS = centerVS.xyz + vec3(local.xy, 0.0);
    gl_Position = projectionMatrix * vec4(posVS, 1.0);
  } else {
    vec3 rotated = rotateByQuat(local, instanceRotation);
    vec4 worldPos = vec4(instancePosition + rotated, 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
}
`;
