import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Color, Frustum, Matrix4, Sphere, Vector3 } from "three";
import type { Item } from "../Types/Item";
import {
  Text as TroikaText,
  BatchedText as BatchedTroikaText,
// @ts-expect-error no troika types
} from "troika-three-text";
import { FrustrumCullRate } from "../Commons/Constants";

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

function CreateTroikaText({
  text,
  position,
  rotation,
  halo,
}: {
  text: string;
  position: [number, number, number];
  rotation: [number, number, number];
  halo: boolean;
}) {
  const mesh = new TroikaText();
  mesh.text = text;
  mesh.color = "#000000";
  mesh.fontSize = 1;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.anchorX = "center";
  mesh.anchorY = "center";

  if (halo) {
    mesh.outlineColor = new Color("#bbbbbb");
    mesh.outlineWidth = 0.35;
    mesh.outlineBlur = 0.5;
    mesh.material.opacity = 1;
  } else {
    mesh.outlineWidth = 0;
  }

  return mesh;
}

export function TroikaCloud({ items, halo }: { items: Item[]; halo: boolean }) {
  const { scene } = useThree();
  const texts = useMemo(
    () =>
      items.map(({ text, position, rotation }) =>
        CreateTroikaText({ text, position, rotation, halo })
      ),
    [items, halo]
  );

  useEffect(() => {
    return () => {
      for (const txt of texts) {
        scene.remove(txt);
        txt.dispose();
      }
    };
  }, [scene, texts]);

  return (
    <>
      {texts.map((obj, i) => (
        <primitive key={items[i].key} object={obj} />
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
    [halo, items.length]
  );
  const texts = useMemo(
    () =>
      items.map(({ text, position, rotation }) =>
        CreateTroikaText({ text, position, rotation, halo })
      ),
    [items, halo]
  );

  useEffect(() => {
    for (const txt of texts) {
      batchedText.addText(txt);
    }

    return () => {
      for (const txt of texts) {
        txt.dispose();
      }
      scene.remove(batchedText);
      batchedText.dispose();
    };
  }, [batchedText, scene, texts]);

  return <primitive object={batchedText} />;
}

export function BatchedTroikaCloudOpt({
  items,
  halo,
}: {
  items: Item[];
  halo: boolean;
}) {
  const { scene } = useThree();
  const { camera } = useThree();

  const batchedText = useMemo(
    () => Object.assign(new BatchedTroikaText(), { frustumCulled: false }),
    [halo, items.length]
  );
  const texts = useMemo(
    () =>
      items.map(({ text, position, rotation }) =>
        CreateTroikaText({ text, position, rotation, halo })
      ),
    [items, halo]
  );
  const inBatch = useRef(new Set<TroikaText>());

  const frustum = useRef(new Frustum());
  const proj = useRef(new Matrix4());
  const sphere = useRef(new Sphere());
  const scale = useRef(new Vector3());
  const last = useRef(0);

  useEffect(() => {
    inBatch.current.clear();
    for (const txt of texts) {
      batchedText.addText(txt);
      inBatch.current.add(txt);
    }

    return () => {
      for (const txt of texts) {
        scene.remove(txt);
      }
      scene.remove(batchedText);
      batchedText.dispose();
    };
  }, [batchedText, scene, texts]);

  useFrame(({ clock }) => {
    if (clock.elapsedTime - last.current < FrustrumCullRate) return;
    last.current = clock.elapsedTime;

    camera.updateMatrixWorld(true);
    proj.current.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    frustum.current.setFromProjectionMatrix(proj.current);

    for (const t of texts) {
      t.updateMatrixWorld(true);
      const g = t.geometry;
      if (!g?.boundingSphere) continue;

      sphere.current.copy(g.boundingSphere);
      sphere.current.center.applyMatrix4(t.matrixWorld);
      scale.current.setFromMatrixScale(t.matrixWorld);
      sphere.current.radius *= Math.max(
        scale.current.x,
        scale.current.y,
        scale.current.z
      );

      const vis = frustum.current.intersectsSphere(sphere.current);
      const has = inBatch.current.has(t);

      if (vis && !has) {
        batchedText.addText(t);
        inBatch.current.add(t);
      }
      else if (!vis && has) {
        batchedText.removeText(t);
        inBatch.current.delete(t);
      }
    }
  });

  return <primitive object={batchedText} />;
}
