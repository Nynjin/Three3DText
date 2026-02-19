import { Mesh } from "three";
import { fontKeyOf, fontKeyString } from "../Font/FontKey";
import layoutText from "../Layout/TextLayout";
import { createFillMaterial } from "../Render/Materials/FillMaterial";
import { createHaloMaterial } from "../Render/Materials/HaloMaterial";
import { InstancedLabelGroup } from "./InstancedLabelGroup";
import { Label } from "./Label";
import { LabelGeometryManager } from "../Render/Geometries/LabelGeometry";

/**
 * 
 */
export class InstancedLabelManager {
  autoUpdate = false;

  private labelKeys = new Map<Label, string>();
  private groups = new Map<string, InstancedLabelGroup>();
  private geometryManagers = new Map<string, LabelGeometryManager>();
  private pxPerUnit: number;
  private _unsubs = new Map<Label, () => void>();

  constructor(pxPerUnit: number = 48) {
    this.pxPerUnit = pxPerUnit;
  }

  update() {
    for (const group of this.groups.values()) {
      if (group.dirtyAtlas) {
        group.generateAtlas();
      }
    }
  }

  addLabel(label: Label) {
    const key = fontKeyString(fontKeyOf(label));
    let group = this.groups.get(key);

    if (!group) {
      group = new InstancedLabelGroup(fontKeyOf(label));
      this.groups.set(key, group);
    }

    group.addLabel(label);
    this.labelKeys.set(label, key);
  }

  addLabels(labels: Label[]) {
    for (const label of labels) {
      const key = fontKeyString(fontKeyOf(label));
      let group = this.groups.get(key);

      if (!group) {
        group = new InstancedLabelGroup(fontKeyOf(label));
        this.groups.set(key, group);
      }
      group.addLabel(label);
      this.labelKeys.set(label, key);
    }
  }

  removeLabel(label: Label) {
    const key = this.labelKeys.get(label);
    if (!key) {
      console.warn(`Failed to delete label from manager`);
      return;
    }
    this.labelKeys.delete(label);

    const group = this.groups.get(key);
    if (group) {
      group.removeLabel(label);
      if (group.labels.size === 0) {
        this.groups.delete(key);
      }
    }
  }

  dispose() {
    this.labelKeys.clear();
    this.groups.clear();
  }

  buildMeshes(): Mesh[] {
    const meshes: Mesh[] = [];

    for (const group of this.groups.values()) {
      const visibleLabels = [...group.labels].filter((l) => l.visible);
      if (visibleLabels.length === 0) continue;

      meshes.push(...this._buildMesh(group));
    }

    return meshes;
  }

  private _buildMesh(group: InstancedLabelGroup): Mesh[] {
    const labelInstances = [];
    const atlas = group.generateAtlas();

    for (const label of group.labels) {
      labelInstances.push(layoutText(label, atlas.glyphs, this.pxPerUnit));
    }

    const geomManager = this.geometryManagers.get(fontKeyString(group.key)) || new LabelGeometryManager();
    this.geometryManagers.set(fontKeyString(group.key), geomManager);

    geomManager.addLabels(labelInstances, this.pxPerUnit);

    const fillMesh = new Mesh(geomManager.geom, createFillMaterial(atlas, geomManager.labelTex, geomManager.glyphTex, geomManager.labelTexWidth, geomManager.glyphTexWidth));
    const haloMesh = new Mesh(geomManager.geom, createHaloMaterial(atlas, geomManager.labelTex, geomManager.glyphTex, geomManager.labelTexWidth, geomManager.glyphTexWidth));

    haloMesh.renderOrder = 0;
    fillMesh.renderOrder = 1;

    haloMesh.frustumCulled = false;
    fillMesh.frustumCulled = false;

    return [haloMesh, fillMesh];
  }
}