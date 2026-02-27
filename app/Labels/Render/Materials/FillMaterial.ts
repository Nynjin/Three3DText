import { DataTexture, GLSL3, ShaderMaterial } from "three";
import { GLYPH_VERT } from "../Shaders/Glyph.vert.glsl";
import { FILL_FRAG } from "../Shaders/Fill.frag.glsl";
import { SDFAtlas } from "../../Font/SDFAtlas";

export function createFillMaterial(
    atlas: SDFAtlas,
    labelTex: DataTexture,
    glyphTex: DataTexture,
    labelTexWidth: number,
    glyphTexWidth: number,
): ShaderMaterial {
    const material = new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: GLYPH_VERT,
        fragmentShader: FILL_FRAG,
        uniforms: {
            uAtlas: { value: atlas.texture },
            uAtlasSize: { value: atlas.atlasSize },
            uCutoff:{ value: atlas.cutoff },
            uRadius: { value: atlas.radius },
            uLabelTex: { value: labelTex },
            uGlyphTex: { value: glyphTex },
            uLabelTexWidth: { value: labelTexWidth },
            uGlyphTexWidth: { value: glyphTexWidth },
        },
        transparent: true,
        depthWrite: true,
        depthTest: true,
    });

    return material;
}

export function updateFillAtlas(
    material: ShaderMaterial,
    atlas: SDFAtlas,
) {
    material.uniforms.uAtlas.value = atlas.texture;
    material.uniforms.uAtlasSize.value = atlas.atlasSize;
    material.uniforms.uCutoff.value = atlas.cutoff;
    material.uniforms.uRadius.value = atlas.radius;
}

export function updateFillUniforms(
    material: ShaderMaterial,
    labelTex: DataTexture,
    glyphTex: DataTexture,
    labelTexWidth: number,
    glyphTexWidth: number,
) {
    material.uniforms.uLabelTex.value = labelTex;
    material.uniforms.uGlyphTex.value = glyphTex;
    material.uniforms.uLabelTexWidth.value = labelTexWidth;
    material.uniforms.uGlyphTexWidth.value = glyphTexWidth;
}