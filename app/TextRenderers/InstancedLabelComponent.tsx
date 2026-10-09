import { useEffect, useRef } from 'react';
import type { Group } from 'three';
import {
  InstancedLabelManager,
  Label,
  type LabelOptions,
  type SymbolAnchor,
  TextAnchorX,
  TextAnchorY,
  rtlReady,
} from '@itowns/labels';
import type { Item } from '../Types/Item';
import type { LabelSettings, LabelStyle } from '../Commons/LabelSettings';
import type { IconStyle } from '../Commons/IconSettings';
import { addDemoImages, type Sprite } from '../Commons/Icons';
import { useFrame, useThree } from '@react-three/fiber';

/** Halo distance and fade-out, in CSS px. */
const HALO_WIDTH = 1;
const HALO_BLUR = 10;

/** Sprite images are added under this prefix. */
const SPRITE_PREFIX = 'sprite:';

/** Images `mixed` cycles through. */
const MIXED = ['pin', 'photo', 'pin-sdf', 'dot-sdf'];

export interface InstancedLabelsProps {
  items: Item[];
  style: LabelStyle;
  /** Manager options. Those read at construction apply on remount. */
  settings: LabelSettings;
  icons: IconStyle;
  /** Loaded sprite sheet, added to the manager; `null` before any load. */
  sprite: Sprite | null;
}

/** MapLibre text anchor names to the label's two anchor enums. */
function textAnchor(anchor: SymbolAnchor): [TextAnchorX, TextAnchorY] {
  const x = anchor.includes('left') ? TextAnchorX.Left : anchor.includes('right') ? TextAnchorX.Right : TextAnchorX.Center;
  const y = anchor.includes('top') ? TextAnchorY.Top : anchor.includes('bottom') ? TextAnchorY.Bottom : TextAnchorY.Middle;
  return [x, y];
}

function iconImageOf(item: Item, icons: IconStyle, spriteIds: string[]): string {
  switch (icons.choice) {
    case 'none':
      return '';
    case 'mixed':
      return MIXED[item.key % MIXED.length];
    case 'sprite':
      return spriteIds.length > 0 ? SPRITE_PREFIX + spriteIds[item.key % spriteIds.length] : '';
    default:
      return icons.choice;
  }
}

function iconOptions(item: Item, icons: IconStyle, spriteIds: string[]): Partial<LabelOptions> {
  const [anchorX, anchorY] = textAnchor(icons.textAnchor);
  return {
    iconImage: iconImageOf(item, icons, spriteIds),
    iconSize: icons.iconSize,
    iconAnchor: icons.iconAnchor,
    iconOffset: [icons.iconOffsetX, icons.iconOffsetY],
    iconTextFit: icons.iconTextFit,
    iconTextFitPadding: icons.iconTextFitPadding,
    iconPadding: icons.iconPadding,
    iconColor: icons.iconColor,
    iconHaloColor: '#ffffff',
    iconHaloWidth: icons.iconHaloWidth,
    iconHaloBlur: icons.iconHaloWidth > 0 ? 1 : 0,
    iconAllowOverlap: icons.iconAllowOverlap,
    iconOptional: icons.iconOptional,
    textOptional: icons.textOptional,
    anchorX,
    anchorY,
    offset: [icons.textOffsetX, icons.textOffsetY],
  };
}

function makeLabel(item: Item, { halo, rotationAlignment, allowOverlap }: LabelStyle, icons: IconStyle, spriteIds: string[]): Label {
  const style = item.style;

  return new Label({
    text: item.text,
    position: item.position,
    rotation: item.rotation,
    rotationAlignment,
    allowOverlap,
    color: style.fillColor,
    haloColor: style.haloColor,
    haloWidth: halo ? HALO_WIDTH : 0,
    haloBlur: halo ? HALO_BLUR : 0,
    font: style.fontFamily,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fontSize: style.fontSizePx,
    maxWidth: 24,
    padding: 10,
    ...iconOptions(item, icons, spriteIds),
  });
}

export function InstancedLabelComponent({ items, style, settings, icons, sprite }: InstancedLabelsProps) {
  const { halo, rotationAlignment, allowOverlap } = style;
  const groupRef = useRef<Group>(null);
  const camera = useThree(state => state.camera);
  const renderer = useThree(state => state.gl);

  const managerRef = useRef<InstancedLabelManager | null>(null);
  const labelMapRef = useRef(new Map<number, Label>());
  const itemMapRef = useRef(new Map<number, Item>());
  /** The style the labels were last built or updated with. */
  const styleRef = useRef(style);
  const iconsRef = useRef(icons);
  const spriteIdsRef = useRef<string[]>([]);
  /** Settings the manager is constructed with. */
  const initialSettings = useRef(settings);

  // Created, attached and disposed together, so a remount starts from a new
  // manager and an empty label map. Declared first: the effects below run after
  // it in the same commit, and list `renderer` to follow a new manager.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    const manager = new InstancedLabelManager(renderer, { ...initialSettings.current, autoUpdate: false });
    addDemoImages(manager);
    group.add(manager.mesh);
    managerRef.current = manager;
    labelMapRef.current = new Map();
    itemMapRef.current = new Map();
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
    if (manager) Object.assign(manager.config, settings);
  }, [settings, renderer]);

  // A new sprite: add its images, then point the labels at them.
  useEffect(() => {
    const manager = managerRef.current;
    if (!manager || !sprite) return;
    manager.addSprite(sprite.index, sprite.sheet, SPRITE_PREFIX);
    spriteIdsRef.current = Object.keys(sprite.index);
    for (const [key, label] of labelMapRef.current) {
      const item = itemMapRef.current.get(key);
      if (item) label.set(iconOptions(item, iconsRef.current, spriteIdsRef.current));
    }
    manager.update();
  }, [sprite, renderer]);

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;

    const labelMap = labelMapRef.current;
    const itemMap = itemMapRef.current;
    const currentKeys = new Set(items.map(i => i.key));

    const toRemove: Label[] = [];
    for (const [key, label] of labelMap) {
      if (!currentKeys.has(key)) {
        toRemove.push(label);
        labelMap.delete(key);
        itemMap.delete(key);
      }
    }

    const toAdd: Label[] = [];
    for (const item of items) {
      if (!labelMap.has(item.key)) {
        const label = makeLabel(item, styleRef.current, iconsRef.current, spriteIdsRef.current);
        labelMap.set(item.key, label);
        itemMap.set(item.key, item);
        toAdd.push(label);
      }
    }

    manager.removeLabels(toRemove);
    manager.addLabels(toAdd);
    manager.update();
  }, [items, renderer]);

  useEffect(() => {
    const manager = managerRef.current;
    const last = styleRef.current;
    if (
      !manager
      || (last.halo === halo && last.rotationAlignment === rotationAlignment && last.allowOverlap === allowOverlap)
    ) return;
    styleRef.current = { halo, rotationAlignment, allowOverlap };
    for (const label of labelMapRef.current.values()) {
      label.set({
        haloWidth: halo ? HALO_WIDTH : 0,
        haloBlur: halo ? HALO_BLUR : 0,
        rotationAlignment,
        allowOverlap,
      });
    }
    manager.update();
  }, [halo, rotationAlignment, allowOverlap, renderer]);

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager || iconsRef.current === icons) return;
    iconsRef.current = icons;
    for (const [key, label] of labelMapRef.current) {
      const item = itemMapRef.current.get(key);
      if (item) label.set(iconOptions(item, icons, spriteIdsRef.current));
    }
    manager.update();
  }, [icons, renderer]);

  useFrame(() => {
    managerRef.current?.cull(camera);
  });

  return <group ref={groupRef} />;
}
