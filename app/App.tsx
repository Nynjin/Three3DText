"use client";

import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { UIKitCloud } from "./TextRenderers/UIKit";
import { CSS3DCloud } from "./TextRenderers/CSS3DRenderer";
import {
  TroikaCloud,
  BatchedTroikaCloud,
  BatchedTroikaCloudOpt,
} from "./TextRenderers/Troika";
import { InstancedLabelComponent } from './TextRenderers/InstancedLabelComponent'
import { makeItems } from "./Utils/MakeItems";
import { Perf } from "r3f-perf";

function App() {
  const [mode, setMode] = useState<
    | "uikit"
    | "troika"
    | "troika-batched"
    | "troika-batched-opt"
    | "css3d"
    | "custom-instanced"
  >("custom-instanced");

  const maxInstances = {
    "uikit": 500,
    "troika": 500,
    "troika-batched": 10000,
    "troika-batched-opt": 10000,
    "css3d": 1000,
    "custom-instanced": 300000,
  }

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
            min={0}
            max={maxInstances[mode]}
            step={1}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
          <input
            type="number"
            min={0}
            max={maxInstances[mode]}
            step={1}
            value={count}
            onChange={(e) =>
              setCount(
                Math.max(0, Math.min(maxInstances[mode], Number(e.target.value) || 0))
              )
            }
          />
        </div>
      </div>

      <Canvas
        key={canvasKey}
        dpr={1}
        camera={{ fov: 45, near: 0.1, far: 10000, position: [0, 0, 50] }}
        style={{ position: "absolute", inset: 0, background: "#505050" }}
      >
        <Perf position="top-left" overClock={true} matrixUpdate={true} deepAnalyze={true} />
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
        ) : mode === "css3d" ? (
          <CSS3DCloud key="css3d" items={items} halo={halo} />
        ) : (
            <InstancedLabelComponent
                items={items}
                halo={halo}
                viewportPredicate={(item) => item.key % 2 === 0}
            />
        )}
      </Canvas>
    </>
  );
}

export default App;