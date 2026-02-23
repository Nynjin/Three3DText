import { DataTexture, GLSL3, ShaderMaterial } from "three";
import { GLYPH_VERT } from "../Shaders/Glyph.vert.glsl";
import { HALO_FRAG } from "../Shaders/Halo.frag.glsl";
import { SDFAtlas } from "../../Font/SDFAtlas";

export function createHaloMaterial(
    atlas: SDFAtlas,
    labelTex: DataTexture,
    glyphTex: DataTexture,
    labelTexWidth: number,
    glyphTexWidth: number,
): ShaderMaterial {
    const material = new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: GLYPH_VERT,
        fragmentShader: HALO_FRAG,
        uniforms: {
            uAtlas: { value: atlas.texture },
            uCutoff: { value: atlas.cutoff },
            uRadius: { value: atlas.radius },
            uLabelTex: { value: labelTex },
            uGlyphTex: { value: glyphTex },
            uLabelTexWidth: { value: labelTexWidth },
            uGlyphTexWidth: { value: glyphTexWidth },
        },
        transparent: true,

        // TODO : either set to false and handle label collision or keep to true and handle glyph collision
        depthWrite: true,
        depthTest: true,

        // prevent overlap with glyph fill
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
    });

    return material;
}

export function updateHaloAtlas(
    material: ShaderMaterial,
    atlas: SDFAtlas,
) {
    material.uniforms.uAtlas.value        = atlas.texture;
    material.uniforms.uCutoff.value       = atlas.cutoff;
    material.uniforms.uRadius.value       = atlas.radius;
}

export function updateHaloUniforms(
    material: ShaderMaterial,
    labelTex: DataTexture,
    glyphTex: DataTexture,
    labelTexWidth: number,
    glyphTexWidth: number,
) {
    material.uniforms.uLabelTex.value     = labelTex;
    material.uniforms.uGlyphTex.value     = glyphTex;
    material.uniforms.uLabelTexWidth.value = labelTexWidth;
    material.uniforms.uGlyphTexWidth.value = glyphTexWidth;
}