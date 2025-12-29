import { ShaderMaterial, FrontSide } from "three";
import { LABEL_VERT } from "./Shaders/Label.vert.glsl";
import { FILL_FRAG } from "./Shaders/Fill.frag.glsl";
import { SDFAtlas } from "../Font/SDFAtlas";

export function createFillMaterial(atlas: SDFAtlas): ShaderMaterial {
    const material = new ShaderMaterial({
        vertexShader: LABEL_VERT,
        fragmentShader: FILL_FRAG,
        uniforms: {
            uAtlas: { value: atlas.texture },
            uCutoff: { value: atlas.cutoff },
            uRadius: { value: atlas.radius },
        },
        transparent: true,
        depthWrite: true,
        depthTest: true,
        side: FrontSide,
    });

    return material;
}