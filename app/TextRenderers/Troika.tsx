import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Frustum, Matrix4, Sphere, Vector3 } from 'three';
import type { Item, ItemStyle } from '../Types/Item';
import {
  Text as TroikaText,
  BatchedText as BatchedTroikaText,
  // @ts-expect-error no troika types
} from 'troika-three-text';
import { FRUSTUM_CULL_INTERVAL_S } from '../Commons/Constants';
import { BASE_FONT_SIZE_PX } from '../Utils/MakeItems';

/** Troika font size, in world units: 1 stands for BASE_FONT_SIZE_PX. */
const troikaScale = (item: Item) => item.style.fontSizePx / BASE_FONT_SIZE_PX;

function createTroikaText(item: Item) {
  const { text, position, rotation, style } = item;
  const mesh = new TroikaText();
  mesh.text = text;
  mesh.color = style.fillColor;
  mesh.fontSize = troikaScale(item);
  mesh.fontWeight = style.fontWeight;
  mesh.fontStyle = style.fontStyle;
  // No font family: troika renders from a font file it loads itself and cannot
  // resolve a system family by name, so every label shares its default face.
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.anchorX = 'center';
  mesh.anchorY = 'middle';
  // The halo toggle runs over meshes, not items, so the style rides along.
  mesh.userData.itemStyle = style;
  return mesh;
}

function applyHaloProps(mesh: TroikaText, halo: boolean) {
  const style = mesh.userData.itemStyle as ItemStyle;
  if (halo) {
    // Outline sizes are world units, so they track the label's own size.
    const scale = mesh.fontSize as number;
    mesh.outlineColor = new Color(style.haloColor);
    mesh.outlineWidth = 0.35 * scale;
    mesh.outlineBlur = 0.5 * scale;
  } else {
    mesh.outlineWidth = 0;
    mesh.outlineBlur = 0;
  }
}

export function TroikaCloud({ items, halo }: { items: Item[]; halo: boolean }) {
  const mapRef = useRef(new Map<number, TroikaText>());
  const [renderList, setRenderList] = useState<
    { key: number; mesh: TroikaText }[]
  >([]);

  useLayoutEffect(() => {
    const map = mapRef.current;
    const nextKeys = new Set(items.map(i => i.key));
    for (const [key, mesh] of map) {
      if (!nextKeys.has(key)) {
        mesh.dispose();
        map.delete(key);
      }
    }
    for (const item of items) {
      if (map.has(item.key)) continue;
      const mesh = createTroikaText(item);
      applyHaloProps(mesh, halo);
      map.set(item.key, mesh);
    }
    setRenderList(
      items.map((item) => {
        const mesh = map.get(item.key);
        if (!mesh)
          throw new Error('Mesh not found for item: ' + item.key.toString());
        return { key: item.key, mesh };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    for (const mesh of mapRef.current.values()) applyHaloProps(mesh, halo);
  }, [halo]);

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
    const nextKeys = new Set(items.map(i => i.key));
    for (const [key, mesh] of map) {
      if (!nextKeys.has(key)) {
        batchedText.removeText(mesh);
        mesh.dispose();
        map.delete(key);
      }
    }
    for (const item of items) {
      const { key } = item;
      if (!map.has(key)) {
        const mesh = createTroikaText(item);
        applyHaloProps(mesh, halo);
        batchedText.addText(mesh);
        map.set(key, mesh);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

export function BatchedTroikaCloudCulled({
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
    const nextKeys = new Set(items.map(i => i.key));
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
    for (const item of items) {
      const { key } = item;
      if (!map.has(key)) {
        const mesh = createTroikaText(item);
        applyHaloProps(mesh, halo);
        batchedText.addText(mesh);
        inBatch.current.add(mesh);
        map.set(key, mesh);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, batchedText]);

  useEffect(() => {
    for (const mesh of mapRef.current.values()) {
      applyHaloProps(mesh, halo);
    }
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
    if (clock.elapsedTime - last.current < FRUSTUM_CULL_INTERVAL_S) return;
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
