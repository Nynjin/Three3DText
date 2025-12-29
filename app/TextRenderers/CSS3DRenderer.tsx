import { useEffect, useMemo, useRef } from "react";
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

  const cssObjects = useMemo(() => {
    const created: CSS3DObject[] = [];

    if (halo) {
      for (const { text, position, rotation } of items) {
        const div = createDiv(text);
        div.style.backgroundColor = "#cccccc";
        const obj = new CSS3DObject(div);
        obj.position.set(...position);
        obj.rotation.set(...rotation);
        scene.add(obj);
        created.push(obj);
      }
    } else {
      for (const { text, position, rotation } of items) {
        const div = createDiv(text);
        const obj = new CSS3DObject(div);
        obj.position.set(...position);
        obj.rotation.set(...rotation);
        scene.add(obj);
        created.push(obj);
      }
    }

    return created;
  }, [items, scene, halo]);

  useFrame(() => {
    cssRenderer.current?.render(scene, camera);
  });

  useEffect(() => {
    return () => {
      for (const obj of cssObjects) {
        scene.remove(obj);
        obj.element.remove?.();
      }
    };
  }, [cssObjects, scene]);

  return null;
}

// function InstancedCSS3DCloud({ items, halo }: { items: Item[]; halo: boolean }) {
//     const { camera, scene, gl, size } = useThree();
//     const cssRenderer = useRef<CSS3DRenderer | null>(null);
// }