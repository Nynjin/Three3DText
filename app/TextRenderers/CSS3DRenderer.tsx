import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  CSS3DRenderer,
  CSS3DObject,
} from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import type { Item, ItemStyle } from '../Types/Item';
import { BASE_FONT_SIZE_PX } from '../Utils/MakeItems';

/** CSS3D draws at 1 px per world unit, standing for BASE_FONT_SIZE_PX. */
const cssSize = (style: ItemStyle) => style.fontSizePx / BASE_FONT_SIZE_PX;

/** Four offset shadows in the halo colour, each blurred by the same radius. */
function haloShadow(style: ItemStyle): string {
  const r = cssSize(style) * 0.08;
  const c = style.haloColor;
  return [
    `${r}px 0 ${r}px ${c}`,
    `-${r}px 0 ${r}px ${c}`,
    `0 ${r}px ${r}px ${c}`,
    `0 -${r}px ${r}px ${c}`,
  ].join(', ');
}

function createDiv(text: Item['text'], style: ItemStyle) {
  const div = document.createElement('div');
  div.textContent = text;
  div.style.cssText = `
        color: ${style.fillColor};
        font: ${style.fontStyle} ${style.fontWeight} ${cssSize(style)}px ${style.fontFamily}, sans-serif;
        white-space: nowrap;
        will-change: transform;
      `;

  return div;
}

export function CSS3DCloud({ items, halo }: { items: Item[]; halo: boolean }) {
  const { camera, scene, gl, size } = useThree();
  const cssRenderer = useRef<CSS3DRenderer | null>(null);
  const mapRef = useRef(new Map<number, CSS3DObject>());

  useEffect(() => {
    const renderer = new CSS3DRenderer();
    renderer.setSize(size.width, size.height);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.pointerEvents = 'none';
    gl.domElement.parentElement?.appendChild(renderer.domElement);
    cssRenderer.current = renderer;

    return () => {
      renderer.domElement.remove();
    };
  }, [gl, size]);

  useLayoutEffect(() => {
    const map = mapRef.current;
    const nextKeys = new Set(items.map(i => i.key));
    for (const [key, obj] of map) {
      if (!nextKeys.has(key)) {
        scene.remove(obj);
        obj.element.remove();
        map.delete(key);
      }
    }
    for (const { key, text, position, rotation, style } of items) {
      if (!map.has(key)) {
        const div = createDiv(text, style);
        div.style.textShadow = halo ? haloShadow(style) : '';
        const obj = new CSS3DObject(div);
        obj.position.set(...position);
        obj.rotation.set(...rotation);
        // The halo toggle runs over objects, not items, so the style rides along.
        obj.userData.itemStyle = style;
        scene.add(obj);
        map.set(key, obj);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, scene]);

  useEffect(() => {
    for (const obj of mapRef.current.values()) {
      const style = obj.userData.itemStyle as ItemStyle | undefined;
      obj.element.style.textShadow = halo && style ? haloShadow(style) : '';
    }
  }, [halo]);

  useEffect(() => () => {
    for (const obj of mapRef.current.values()) {
      scene.remove(obj);
      obj.element.remove();
    }
    mapRef.current.clear();
  }, [scene]);

  useFrame(() => {
    cssRenderer.current?.render(scene, camera);
  });

  return null;
}
