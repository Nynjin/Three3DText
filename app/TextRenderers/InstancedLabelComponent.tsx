import { useEffect, useRef } from 'react';
import type { Group } from 'three';
import {
  InstancedLabelManager,
  Label,
  RotationAlignment,
  TextAnchorX,
  TextAnchorY,
  rtlReady,
} from '@itowns/labels';
import type { Item } from '../Types/Item';
import { useFrame, useThree } from '@react-three/fiber';

/** Halo distance and fade-out, in CSS px. */
const HALO_WIDTH = 1;
const HALO_BLUR = 10;

export interface InstancedLabelsProps {
  items: Item[];
  halo: boolean;
}

function makeLabel(item: Item, halo: boolean): Label {
  const style = item.style;

  return new Label({
    text: item.text,
    position: item.position,
    rotation: item.rotation,
    rotationAlignment: RotationAlignment.Map,
    color: style.fillColor,
    haloColor: style.haloColor,
    haloWidth: halo ? HALO_WIDTH : 0,
    haloBlur: halo ? HALO_BLUR : 0,
    font: style.fontFamily,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fontSize: style.fontSizePx,
    maxWidth: 24,
    anchorX: TextAnchorX.Center,
    anchorY: TextAnchorY.Middle,
    padding: 10,
  });
}

export function InstancedLabelComponent({ items, halo }: InstancedLabelsProps) {
  const groupRef = useRef<Group>(null);
  const camera = useThree(state => state.camera);
  const renderer = useThree(state => state.gl);

  const managerRef = useRef<InstancedLabelManager | null>(null);
  const labelMapRef = useRef(new Map<number, Label>());
  /** The halo setting the labels were last built or updated with. */
  const haloRef = useRef(halo);

  // Created, attached and disposed together, so a remount starts from a new
  // manager and an empty label map. Declared first: the effects below run after
  // it in the same commit, and list `renderer` to follow a new manager.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    const manager = new InstancedLabelManager(renderer, { autoUpdate: false });
    group.add(manager.mesh);
    managerRef.current = manager;
    labelMapRef.current = new Map();
    // autoUpdate is off, so the relayout the RTL shaper queues needs a commit.
    void rtlReady.then(() => manager.update());

    return () => {
      group.remove(manager.mesh);
      manager.dispose();
      managerRef.current = null;
    };
  }, [renderer]);

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;

    const labelMap = labelMapRef.current;
    const currentKeys = new Set(items.map(i => i.key));

    const toRemove: Label[] = [];
    for (const [key, label] of labelMap) {
      if (!currentKeys.has(key)) {
        toRemove.push(label);
        labelMap.delete(key);
      }
    }

    const toAdd: Label[] = [];
    for (const item of items) {
      if (!labelMap.has(item.key)) {
        const label = makeLabel(item, haloRef.current);
        labelMap.set(item.key, label);
        toAdd.push(label);
      }
    }

    manager.removeLabels(toRemove);
    manager.addLabels(toAdd);
    manager.update();
  }, [items, renderer]);

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager || haloRef.current === halo) return;
    haloRef.current = halo;
    for (const label of labelMapRef.current.values()) {
      label.set({ haloWidth: halo ? HALO_WIDTH : 0, haloBlur: halo ? HALO_BLUR : 0 });
    }
    manager.update();
  }, [halo, renderer]);

  useFrame(() => {
    managerRef.current?.cull(camera);
  });

  return <group ref={groupRef} />;
}
