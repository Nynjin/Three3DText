"use client";

import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import dynamic from "next/dynamic";
import { UIKitCloud } from "./TextRenderers/UIKit";
import { CSS3DCloud } from "./TextRenderers/CSS3DRenderer";
import {
  TroikaCloud,
  BatchedTroikaCloud,
  BatchedTroikaCloudOpt,
} from "./TextRenderers/Troika";
import { ThomasCloud } from "./TextRenderers/Thomas";
import { InstancedLabelsEZ } from './TextRenderers/Instanced2Mesh'
import { makeItems } from "./Utils/MakeItems";

const Perf = dynamic(() => import("r3f-perf").then((m) => m.Perf), {
  ssr: false,
});

function App() {
  const [mode, setMode] = useState<
    | "uikit"
    | "troika"
    | "troika-batched"
    | "troika-batched-opt"
    | "thomas"
    | "css3d"
    | "custom-instanced"
  >("uikit");

  const [halo, setHalo] = useState(false);
  const [count, setCount] = useState(100);

  const seed = 12345;
  const items = useMemo(() => makeItems(count, seed), [count, seed]);

  const btnBase: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid #bbb",
    background: "#fff",
    cursor: "pointer",
    textAlign: "left",
  };
  const btnActive: React.CSSProperties = {
    border: "1px solid #111",
    background: "#111",
    color: "#fff",
  };

  const canvasKey = `${mode}`;

  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 10000,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          alignItems: "stretch",
          color: "black"
        }}
      >
        {(
          [
            ["uikit", "UIKit"],
            ["troika", "Troika"],
            ["troika-batched", "Batched Troika"],
            ["troika-batched-opt", "Batched Troika Opt"],
            ["thomas", "Thomas"],
            ["css3d", "CSS3D"],
            ["custom-instanced", "Custom Instanced"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{ ...btnBase, ...(mode === m ? btnActive : null) }}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        style={{
          position: "absolute",
          width: "98%",
          bottom: 8,
          zIndex: 10000,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          color: "black",
          justifyContent: "space-between",
          justifySelf: "center",
        }}
      >
        <label
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <input
            type="checkbox"
            checked={halo}
            onChange={(e) => setHalo(e.target.checked)}
          />
          Halo
        </label>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>Count</span>
          <input
            type="range"
            min={1}
            max={10000}
            step={1}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
          <input
            type="number"
            min={1}
            max={10000}
            step={1}
            value={count}
            onChange={(e) =>
              setCount(
                Math.max(1, Math.min(10000, Number(e.target.value) || 1))
              )
            }
          />
        </div>
      </div>

      <Canvas
        key={canvasKey}
        gl={{ antialias: false }}
        dpr={1}
        camera={{ fov: 45, near: 0.1, far: 10000, position: [0, 0, 50] }}
        style={{ position: "absolute", inset: 0, background: "#505050" }}
      >
        <Perf position="top-left" />
        <OrbitControls />

        {mode === "uikit" ? (
          <UIKitCloud key="uikit" items={items} halo={halo} />
        ) : mode === "troika" ? (
          <TroikaCloud key="troika" items={items} halo={halo} />
        ) : mode === "troika-batched" ? (
          <BatchedTroikaCloud key="troika-batched" items={items} halo={halo} />
        ) : mode === "troika-batched-opt" ? (
          <BatchedTroikaCloudOpt
            key="troika-batched-opt"
            items={items}
            halo={halo}
          />
        ) : mode === "thomas" ? (
          <ThomasCloud key="thomas" items={items} halo={halo} />
        ) : mode === "css3d" ? (
          <CSS3DCloud key="css3d" items={items} halo={halo} />
        ) : (
            <InstancedLabelsEZ
                items={items}
                halo={halo}
                pxPerUnit={100}
                viewportPredicate={(item) => item.key % 2 === 0}
            />
        )}
      </Canvas>
    </>
  );
}

export default App;