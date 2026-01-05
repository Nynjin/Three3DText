import { ShaderMaterial } from "three";
import { GLYPH_VERT } from "./Shaders/Glyph.vert.glsl";
import { FILL_FRAG } from "./Shaders/Fill.frag.glsl";
import { SDFAtlas } from "../Font/SDFAtlas";

export function createFillMaterial(atlas: SDFAtlas): ShaderMaterial {
    const material = new ShaderMaterial({
        vertexShader: GLYPH_VERT,
        fragmentShader: FILL_FRAG,
        uniforms: {
            uAtlas: { value: atlas.texture },
            uCutoff: { value: atlas.cutoff },
            uRadius: { value: atlas.radius },
        },
        transparent: true,
        depthWrite: true,
        depthTest: true,
    });

    return material;
}