'use client';

import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { UIKitCloud } from './TextRenderers/UIKit';
import { CSS3DCloud } from './TextRenderers/CSS3DRenderer';
import {
  TroikaCloud,
  BatchedTroikaCloud,
  BatchedTroikaCloudCulled,
} from './TextRenderers/Troika';
import { InstancedLabelComponent } from './TextRenderers/InstancedLabelComponent';
import { makeItems } from './Utils/MakeItems';
import { StatsPanel } from './Commons/StatsPanel';

const MODES = [
  ['uikit', 'UIKit'],
  ['troika', 'Troika'],
  ['troika-batched', 'Batched Troika'],
  ['troika-batched-cull', 'Batched Troika + Cull'],
  ['css3d', 'CSS3D'],
  ['custom-instanced', '@itowns/labels'],
] as const;

type Mode = (typeof MODES)[number][0];

const MAX_INSTANCES: Record<Mode, number> = {
  uikit: 500,
  troika: 500,
  'troika-batched': 10000,
  'troika-batched-cull': 10000,
  css3d: 1000,
  'custom-instanced': 300000,
};

const PANEL = 'absolute z-[10000] rounded-[10px] border border-white/[0.12] '
  + 'bg-zinc-900/[0.86] text-[#e8e8ea] shadow-[0_6px_20px_rgba(0,0,0,0.35)] '
  + 'backdrop-blur-[8px] text-[13px]/[1.4] [font-family:system-ui,sans-serif]';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-sky-300 focus-visible:outline-offset-1';

const MODE_BUTTON = 'block w-full cursor-pointer appearance-none rounded-[7px] border-0 '
  + 'bg-transparent px-3 py-[7px] text-left text-[#b9b9c0] [font:inherit] '
  + 'transition-[background-color,color] duration-[120ms] '
  + 'hover:bg-white/[0.08] hover:text-[#f2f2f4] '
  + 'aria-pressed:bg-zinc-100 aria-pressed:font-semibold aria-pressed:text-zinc-900 '
  + FOCUS;

const ROW = 'flex items-center gap-[10px]';

const LABEL = 'cursor-pointer select-none text-[#b9b9c0]';

const NUMBER_INPUT = 'w-[88px] rounded-md border border-white/[0.14] bg-white/[0.06] '
  + 'px-2 py-1 text-right text-[#f2f2f4] [font:inherit] ' + FOCUS;

function App() {
  const [mode, setMode] = useState<Mode>('custom-instanced');
  const [halo, setHalo] = useState(false);
  const [count, setCount] = useState(100);

  const seed = 12345;
  const items = useMemo(() => makeItems(count, seed), [count, seed]);
  const max = MAX_INSTANCES[mode];

  return (
    <>
      <div className={`${PANEL} top-3 right-3 flex w-[190px] flex-col gap-0.5 p-1.5`}>
        {MODES.map(([m, label]) => (
          <button
            key={m}
            type="button"
            className={MODE_BUTTON}
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              setCount(c => Math.min(c, MAX_INSTANCES[m]));
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={`${PANEL} bottom-3 left-3 px-3.5 py-2`}>
        <label className={`${ROW} ${LABEL}`}>
          <input
            type="checkbox"
            className="m-0 h-[15px] w-[15px] cursor-pointer accent-sky-300"
            checked={halo}
            onChange={e => setHalo(e.target.checked)}
          />
          Halo
        </label>
      </div>

      <div className={`${PANEL} ${ROW} right-3 bottom-3 px-3.5 py-2`}>
        <span className={LABEL}>Count</span>
        <input
          type="range"
          className="w-[220px] cursor-pointer accent-sky-300"
          min={0}
          max={max}
          step={1}
          value={count}
          onChange={e => setCount(Number(e.target.value))}
        />
        <input
          type="number"
          className={NUMBER_INPUT}
          min={0}
          max={max}
          step={1}
          value={count}
          onChange={e =>
            setCount(Math.max(0, Math.min(max, Number(e.target.value) || 0)))}
        />
      </div>

      <Canvas
        key={mode}
        // No tone mapping: every renderer draws the label colours as given.
        flat
        dpr={1}
        camera={{ fov: 45, near: 0.1, far: 10000, position: [0, 0, 50] }}
        // Inline: the Canvas wrapper sets its own inline position, which a class cannot override.
        style={{ position: 'absolute', inset: 0, background: '#505050' }}
      >
        <StatsPanel position="top-left" />
        <OrbitControls />

        {mode === 'uikit'
          ? <UIKitCloud key="uikit" items={items} halo={halo} />
          : mode === 'troika'
            ? <TroikaCloud key="troika" items={items} halo={halo} />
            : mode === 'troika-batched'
              ? <BatchedTroikaCloud key="troika-batched" items={items} halo={halo} />
              : mode === 'troika-batched-cull'
                ? (
                    <BatchedTroikaCloudCulled
                      key="troika-batched-cull"
                      items={items}
                      halo={halo}
                    />
                  )
                : mode === 'css3d'
                  ? <CSS3DCloud key="css3d" items={items} halo={halo} />
                  : <InstancedLabelComponent items={items} halo={halo} />}
      </Canvas>
    </>
  );
}

export default App;
