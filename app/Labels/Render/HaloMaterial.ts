import { ShaderMaterial, FrontSide } from "three";
import { LABEL_VERT } from "./Shaders/Label.vert.glsl";
import { HALO_FRAG } from "./Shaders/Halo.frag.glsl";
import { SDFAtlas } from "../Font/SDFAtlas";

export function createHaloMaterial(atlas: SDFAtlas): ShaderMaterial {
    const material = new ShaderMaterial({
        vertexShader: LABEL_VERT,
        fragmentShader: HALO_FRAG,
        uniforms: {
            uAtlas: { value: atlas.texture },
            uCutoff: { value: atlas.cutoff },
            uRadius: { value: atlas.radius },
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: FrontSide,
    });

    return material;
}