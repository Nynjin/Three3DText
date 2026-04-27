import { DoubleSide, NoBlending, ShaderMaterial } from "three";
import { COLLISION_FRAG } from "../Shaders/Collision.frag.glsl";
import { COLLISION_VERT } from "../Shaders/Collision.vert.glsl";

export function createCollisionMaterial(): ShaderMaterial {
  const material = new ShaderMaterial({
    transparent: false,
    blending: NoBlending,
    depthTest: true,
    depthWrite: true,
    side: DoubleSide,
    vertexShader: COLLISION_VERT,
    fragmentShader: COLLISION_FRAG,
  });

  material.toneMapped = false;
  return material;
}
