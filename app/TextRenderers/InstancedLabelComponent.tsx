import { useEffect, useRef } from 'react';
import type { Group } from 'three';
import {
  InstancedLabelManager,
  Label,
  RotationAlignment,
  TextAlign,
  TextAnchorX,
  TextAnchorY,
} from '@itowns/labels';
import type { Item } from '../Types/Item';
import { useFrame, useThree } from '@react-three/fiber';
import { mulberry32 } from '../Utils/SeededRandom';

// Drawn per label so one scene mixes many font keys across the shared atlas.
const FONTS = ['Arial', 'Georgia', 'Verdana', 'Tahoma', 'Trebuchet MS'];
const FONT_WEIGHTS = ['400', '600', '700'] as const;
const FONT_STYLES = ['normal', 'italic'] as const;
const FONT_SIZES = [16, 18, 22, 28, 36, 48];
const FILL_COLORS = ['#14181c', '#1d2b36', '#2c2118', '#331c24', '#17301f'];
const HALO_COLORS = ['#ffd9d9', '#d9e9ff', '#d9ffe4', '#fff3cc', '#ecd9ff'];

function pick<T>(values: readonly T[], random: () => number): T {
  return values[Math.floor(random() * values.length)];
}

export interface InstancedLabelsProps {
  items: Item[];
  halo: boolean;
  /** Seed for the per-item style draw; same seed and key give the same style. */
  styleSeed?: number;
  pxPerUnit?: number;
}

function makeLabel(item: Item, halo: boolean, styleSeed: number): Label {
  const random = mulberry32(item.key + styleSeed);

  return new Label({
    text: item.text,
    position: item.position,
    rotation: item.rotation,
    rotationAlignment: RotationAlignment.Map,
    color: pick(FILL_COLORS, random),
    haloColor: pick(HALO_COLORS, random),
    haloWidth: halo ? 1 : 0,
    haloBlur: halo ? 10 : 0,
    font: pick(FONTS, random),
    fontWeight: pick(FONT_WEIGHTS, random),
    fontStyle: pick(FONT_STYLES, random),
    fontSize: pick(FONT_SIZES, random),
    // Wide enough that place names stay on one line; the longest few wrap.
    maxWidth: 24,
    textAlign: TextAlign.Left,
    lineHeight: 1.2,
    offset: [0, 0],
    anchorX: TextAnchorX.Left,
    anchorY: TextAnchorY.Top,
    // Keeps air between neighbours.
    padding: [10, 10, 10, 10],
  });
}

export function InstancedLabelComponent({
  items,
  halo,
  styleSeed = 0,
  pxPerUnit = 1024,
}: InstancedLabelsProps) {
  const groupRef = useRef<Group>(null);
  const camera = useThree(state => state.camera);
  const renderer = useThree(state => state.gl);

  // Map of item.key to Label
  const labelMapRef = useRef<Map<number, Label>>(new Map());
  // Whether the manager's mesh pair is attached to the group
  const attachedRef = useRef(false);

  const managerRef = useRef<InstancedLabelManager | null>(null);

  managerRef.current ??= new InstancedLabelManager(renderer, {
    pxPerUnit,
    autoUpdate: false,
    labelFar: Infinity,
  });
  const manager = managerRef.current;

  useEffect(() => {
    return () => {
      managerRef.current?.dispose();
      managerRef.current = null;
    };
  }, []); // dispose only on real unmount

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    const labelMap = labelMapRef.current;
    const currentKeys = new Set(items.map(i => i.key));

    // Remove labels whose items are gone
    const toRemove: Label[] = [];
    for (const [key, label] of labelMap) {
      if (!currentKeys.has(key)) {
        toRemove.push(label);
        labelMap.delete(key);
      }
    }
    if (toRemove.length > 0) {
      manager.removeLabels(toRemove);
    }

    // Add labels that are new
    const toAdd: Label[] = [];
    for (const item of items) {
      if (!labelMap.has(item.key)) {
        const label = makeLabel(item, halo, styleSeed);
        labelMap.set(item.key, label);
        toAdd.push(label);
      }
    }
    if (toAdd.length > 0) {
      manager.addLabels(toAdd);
    }

    if (toAdd.length > 0 || toRemove.length > 0) {
      manager.update();
    }

    if (!attachedRef.current) {
      group.add(manager.mesh);
      attachedRef.current = true;
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, manager, styleSeed]);

  useEffect(() => {
    for (const label of labelMapRef.current.values()) {
      label.set({ haloWidth: halo ? 1 : 0, haloBlur: halo ? 10 : 0 });
    }
    manager.update();
  }, [halo, manager]);

  useFrame(() => {
    manager.cull(camera);
  });

  return <group ref={groupRef} />;
}
