import { useEffect, useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  CSS3DRenderer,
  CSS3DObject,
} from "three/examples/jsm/renderers/CSS3DRenderer.js";
import type { Item } from "../Types/Item";

function createDiv(text: Item["text"]) {
  const div = document.createElement("div");
  div.textContent = text;
  div.style.cssText = `
        color: black;
        font: 1px sans-serif;
        will-change: transform;
        anchor = center;
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
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.top = "0";
    renderer.domElement.style.pointerEvents = "none";
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
        obj.element.remove?.();
        map.delete(key);
      }
    }
    for (const { key, text, position, rotation } of items) {
      if (!map.has(key)) {
        const div = createDiv(text);
        div.style.backgroundColor = halo ? "#cccccc" : "";
        const obj = new CSS3DObject(div);
        div.remove?.();
        obj.position.set(...position);
        obj.rotation.set(...rotation);
        scene.add(obj);
        map.set(key, obj);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, scene]);

  useEffect(() => {
    for (const obj of mapRef.current.values()) {
      obj.element.style.backgroundColor = halo ? "#cccccc" : "";
    }
  }, [halo]);

  useEffect(() => () => {
    for (const obj of mapRef.current.values()) {
      scene.remove(obj);
      obj.element.remove?.();
    }
    mapRef.current.clear();
  }, [scene]);

  useFrame(() => {
    cssRenderer.current?.render(scene, camera);
  });

  return null;
}