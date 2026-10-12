'use client';

import { useMemo, useRef, useState, type ComponentRef } from 'react';
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
import { EARTH_RADIUS, makeGlobeItems } from './Utils/MakeGlobeItems';
import { Globe } from './Commons/Globe';
import { Occluder } from './Commons/Occluder';
import { StatsPanel } from './Commons/StatsPanel';
import {
  DEFAULT_LABEL_SETTINGS,
  DEFAULT_LABEL_STYLE,
  DEFAULT_SCENE,
  LabelSettingsPanel,
  type LabelSettings,
  type LabelStyle,
  type SceneOptions,
} from './Commons/LabelSettings';
import { FOCUS, LABEL, NUMBER_INPUT, PANEL, ROW } from './Commons/Ui';

const MODES = [
  ['uikit', 'UIKit'],
  ['troika', 'Troika'],
  ['troika-batched', 'Batched Troika'],
  ['troika-batched-cull', 'Batched Troika + Cull'],
  ['css3d', 'CSS3D'],
  ['custom-instanced', '@itowns/labels'],
] as const;

type Mode = (typeof MODES)[number][0];

/** Slider maximum per mode. */
const MAX_INSTANCES: Record<Mode, number> = {
  uikit: 3000,
  troika: 6000,
  'troika-batched': 15000,
  'troika-batched-cull': 30000,
  css3d: 5000,
  'custom-instanced': 300000,
};

const MODE_BUTTON = 'block w-full cursor-pointer appearance-none rounded-[7px] border-0 '
  + 'bg-transparent px-3 py-[7px] text-left text-[#b9b9c0] [font:inherit] '
  + 'transition-[background-color,color] duration-[120ms] '
  + 'hover:bg-white/[0.08] hover:text-[#f2f2f4] '
  + 'aria-pressed:bg-zinc-100 aria-pressed:font-semibold aria-pressed:text-zinc-900 '
  + FOCUS;

const FLAT_CAMERA = { fov: 45, near: 0.1, far: 10000, position: [0, 0, 50] } as const;

/** From orbit; the near and far planes span a globe seen whole and from 100 m. */
const GLOBE_CAMERA = { fov: 45, near: 1, far: 2e8, position: [EARTH_RADIUS * 2.6, 0, 0] } as const;

/** The globe's controls orbit a point on the surface, so zooming reaches it. */
const GLOBE_CONTROLS = { target: [EARTH_RADIUS, 0, 0], minDistance: 100, maxDistance: EARTH_RADIUS * 8, rotateSpeed: 0.5 } as const;

function App() {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const [mode, setMode] = useState<Mode>('custom-instanced');
  const [labelStyle, setLabelStyle] = useState<LabelStyle>(DEFAULT_LABEL_STYLE);
  const [count, setCount] = useState(100);
  const [labelSettings, setLabelSettings] = useState<LabelSettings>(DEFAULT_LABEL_SETTINGS);
  const [scene, setScene] = useState<SceneOptions>(DEFAULT_SCENE);

  const seed = 12345;
  const items = useMemo(
    () => (scene.globe ? makeGlobeItems(count, seed) : makeItems(count, seed)),
    [count, seed, scene.globe],
  );
  const { globe, occluder } = scene;
  const { halo } = labelStyle;
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
              if (m !== 'custom-instanced') setScene(DEFAULT_SCENE);
            }}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={`${MODE_BUTTON} mt-1 border-t border-white/[0.12]`}
          onClick={() => controls.current?.reset()}
        >
          Reset camera
        </button>
      </div>

      {mode === 'custom-instanced' && (
        <LabelSettingsPanel
          settings={labelSettings}
          onChange={setLabelSettings}
          style={labelStyle}
          onStyleChange={setLabelStyle}
          scene={scene}
          onSceneChange={setScene}
        />
      )}

      {mode !== 'custom-instanced' && (
        <div className={`${PANEL} bottom-3 left-3 px-3.5 py-2`}>
          <label className={`${ROW} ${LABEL}`}>
            <input
              type="checkbox"
              className="m-0 h-[15px] w-[15px] cursor-pointer accent-sky-300"
              checked={halo}
              onChange={e => setLabelStyle({ ...labelStyle, halo: e.target.checked })}
            />
            Halo
          </label>
        </div>
      )}

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
        key={`${mode}-${globe}`}
        // No tone mapping: every renderer draws the label colours as given.
        flat
        dpr={1}
        gl={{ logarithmicDepthBuffer: globe }}
        camera={globe ? { ...GLOBE_CAMERA, position: [...GLOBE_CAMERA.position] } : { ...FLAT_CAMERA, position: [...FLAT_CAMERA.position] }}
        // Inline: the Canvas wrapper sets its own inline position, which a class cannot override.
        style={{ position: 'absolute', inset: 0, background: '#505050' }}
      >
        <StatsPanel position="top-left" />
        <OrbitControls
          ref={controls}
          makeDefault
          {...(globe ? { ...GLOBE_CONTROLS, target: [...GLOBE_CONTROLS.target] as [number, number, number] } : {})}
        />
        {(globe || occluder) && (
          <>
            <ambientLight intensity={1.6} />
            <directionalLight position={[1, 0.6, 0.8]} intensity={2.2} />
          </>
        )}
        {globe && <Globe />}
        {occluder && (
          globe
            ? <Occluder size={1.2e6} start={[EARTH_RADIUS * 1.7, 0, 0]} />
            : <Occluder size={12} start={[0, 0, 25]} />
        )}

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
                  : (
                      <InstancedLabelComponent
                        // downscale and atlasFontSize are read at construction.
                        key={`${labelSettings.downscale}-${labelSettings.atlasFontSize}`}
                        items={items}
                        style={labelStyle}
                        settings={labelSettings}
                      />
                    )}
      </Canvas>
    </>
  );
}

export default App;
