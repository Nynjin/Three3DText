import { ShaderMaterial } from "three";
import { GLYPH_VERT } from "./Shaders/Glyph.vert.glsl";
import { HALO_FRAG } from "./Shaders/Halo.frag.glsl";
import { SDFAtlas } from "../Font/SDFAtlas";

export function createHaloMaterial(atlas: SDFAtlas): ShaderMaterial {
    const material = new ShaderMaterial({
        vertexShader: GLYPH_VERT,
        fragmentShader: HALO_FRAG,
        uniforms: {
            uAtlas: { value: atlas.texture },
            uCutoff: { value: atlas.cutoff },
            uRadius: { value: atlas.radius },
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