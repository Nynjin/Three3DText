import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Color, Frustum, Matrix4, Sphere, Vector3 } from "three";
import type { Item } from "../Types/Item";
import {
  Text as TroikaText,
  BatchedText as BatchedTroikaText,
  // @ts-expect-error no troika types
} from "troika-three-text";
import { FrustrumCullRate } from "../Commons/Constants";

function createTroikaText({
  text,
  position,
  rotation,
}: {
  text: string;
  position: [number, number, number];
  rotation: [number, number, number];
}) {
  const mesh = new TroikaText();
  mesh.text = text;
  mesh.color = "#000000";
  mesh.fontSize = 1;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.anchorX = "center";
  mesh.anchorY = "center";
  return mesh;
}

function applyHaloProps(mesh: TroikaText, halo: boolean) {
  if (halo) {
    mesh.outlineColor = new Color("#bbbbbb");
    mesh.outlineWidth = 0.35;
    mesh.outlineBlur = 0.5;
    if (mesh.material) mesh.material.opacity = 1;
  } else {
    mesh.outlineWidth = 0;
    mesh.outlineBlur = 0;
  }
}

(function patchTroikaCustomMaterials() {
  for (const key of [
    "customDepthMaterial",
    "customDistanceMaterial",
  ] as const) {
    const d = Object.getOwnPropertyDescriptor(TroikaText.prototype, key);
    if (d?.get && !d?.set) {
      Object.defineProperty(TroikaText.prototype, key, {
        value: null,
        writable: true,
        configurable: true,
      });
    }
  }
})();

export function TroikaCloud({ items, halo }: { items: Item[]; halo: boolean }) {
  const mapRef = useRef(new Map<number, TroikaText>());
  const [renderList, setRenderList] = useState<
    { key: number; mesh: TroikaText }[]
  >([]);

  useLayoutEffect(() => {
    const map = mapRef.current;
    const nextKeys = new Set(items.map((i) => i.key));
    for (const [key, mesh] of map) {
      if (!nextKeys.has(key)) {
        mesh.dispose();
        map.delete(key);
      }
    }
    for (const { key, text, position, rotation } of items) {
      const mesh = createTroikaText({ text, position, rotation });
      applyHaloProps(mesh, halo);
      if (!map.has(key)) map.set(key, mesh);
    }
    setRenderList(
      items.map((item) => ({ key: item.key, mesh: map.get(item.key)! })),
    );
  }, [items]);

  // Halo: update existing meshes in-place
  useEffect(() => {
    for (const mesh of mapRef.current.values()) applyHaloProps(mesh, halo);
  }, [halo]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      for (const mesh of mapRef.current.values()) mesh.dispose();
      mapRef.current.clear();
    },
    [],
  );

  return (
    <>
      {renderList.map(({ key, mesh }) => (
        <primitive key={key} object={mesh} />
      ))}
    </>
  );
}

export function BatchedTroikaCloud({
  items,
  halo,
}: {
  items: Item[];
  halo: boolean;
}) {
  const { scene } = useThree();
  const batchedText = useMemo(
    () => Object.assign(new BatchedTroikaText(), { frustumCulled: false }),
    [],
  );
  const mapRef = useRef(new Map<number, TroikaText>());

  useLayoutEffect(() => {
    const map = mapRef.current;
    const nextKeys = new Set(items.map((i) => i.key));
    for (const [key, mesh] of map) {
      if (!nextKeys.has(key)) {
        batchedText.removeText(mesh);
        mesh.dispose();
        map.delete(key);
      }
    }
    for (const { key, text, position, rotation } of items) {
      if (!map.has(key)) {
        const mesh = createTroikaText({ text, position, rotation });
        batchedText.addText(mesh);
        map.set(key, mesh);
      }
    }
  }, [items, batchedText]);

  useEffect(() => {
    for (const mesh of mapRef.current.values()) applyHaloProps(mesh, halo);
  }, [halo]);

  useEffect(
    () => () => {
      for (const mesh of mapRef.current.values()) mesh.dispose();
      mapRef.current.clear();
      scene.remove(batchedText);
      batchedText.dispose();
    },
    [scene, batchedText],
  );

  return <primitive object={batchedText} />;
}

export function BatchedTroikaCloudOpt({
  items,
  halo,
}: {
  items: Item[];
  halo: boolean;
}) {
  const { scene, camera } = useThree();
  const batchedText = useMemo(
    () => Object.assign(new BatchedTroikaText(), { frustumCulled: false }),
    [],
  );
  const mapRef = useRef(new Map<number, TroikaText>());
  const inBatch = useRef(new Set<TroikaText>());

  useLayoutEffect(() => {
    const map = mapRef.current;
    const nextKeys = new Set(items.map((i) => i.key));
    for (const [key, mesh] of map) {
      if (!nextKeys.has(key)) {
        if (inBatch.current.has(mesh)) {
          batchedText.removeText(mesh);
          inBatch.current.delete(mesh);
        }
        mesh.dispose();
        map.delete(key);
      }
    }
    for (const { key, text, position, rotation } of items) {
      if (!map.has(key)) {
        const mesh = createTroikaText({ text, position, rotation });
        batchedText.addText(mesh);
        inBatch.current.add(mesh);
        map.set(key, mesh);
      }
    }
  }, [items, batchedText]);

  useEffect(() => {
    for (const mesh of mapRef.current.values()) {applyHaloProps(mesh, halo);}
  }, [halo]);

  useEffect(
    () => () => {
      for (const mesh of mapRef.current.values()) {
        mesh.dispose();
      }
      mapRef.current.clear();
      inBatch.current.clear();
      scene.remove(batchedText);
      batchedText.dispose();
    },
    [scene, batchedText],
  );

  const frustum = useRef(new Frustum());
  const proj = useRef(new Matrix4());
  const sphere = useRef(new Sphere());
  const scale = useRef(new Vector3());
  const last = useRef(0);

  useFrame(({ clock }) => {
    if (clock.elapsedTime - last.current < FrustrumCullRate) return;
    last.current = clock.elapsedTime;

    camera.updateMatrixWorld(true);
    proj.current.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    frustum.current.setFromProjectionMatrix(proj.current);

    for (const t of mapRef.current.values()) {
      t.updateMatrixWorld(true);
      const g = t.geometry;
      if (!g?.boundingSphere) continue;

      sphere.current.copy(g.boundingSphere);
      sphere.current.center.applyMatrix4(t.matrixWorld);
      scale.current.setFromMatrixScale(t.matrixWorld);
      sphere.current.radius *= Math.max(
        scale.current.x,
        scale.current.y,
        scale.current.z,
      );

      const vis = frustum.current.intersectsSphere(sphere.current);
      const has = inBatch.current.has(t);

      if (vis && !has) {
        batchedText.addText(t);
        inBatch.current.add(t);
      } else if (!vis && has) {
        batchedText.removeText(t);
        inBatch.current.delete(t);
      }
    }
  });

  return <primitive object={batchedText} />;
}
