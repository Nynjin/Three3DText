import { useState } from 'react';
import { RotationAlignment, type LabelManagerConfig } from '@itowns/labels';
import { FOCUS, LABEL, NUMBER_INPUT, PANEL } from './Ui';

/** The manager options the panel edits. */
export type LabelSettings = Pick<
  LabelManagerConfig,
  | 'atlasFontSize'
  | 'downscale'
  | 'placementIntervalMs'
  | 'placementBudgetMs'
  | 'fadeDurationMs'
  | 'fadeGamma'
  | 'moveThresholdPx'
  | 'ndcCullMargin'
  | 'labelNear'
  | 'labelFar'
  | 'renderPenaltyMultiplier'
  | 'depthTest'
>;

export const DEFAULT_LABEL_SETTINGS: LabelSettings = {
  atlasFontSize: 32,
  downscale: 8,
  placementIntervalMs: 100,
  placementBudgetMs: 8,
  fadeDurationMs: 650,
  fadeGamma: 3,
  moveThresholdPx: 1,
  ndcCullMargin: 0.2,
  labelNear: 0,
  labelFar: Infinity,
  renderPenaltyMultiplier: 2,
  depthTest: false,
};

/** How the labels are drawn, set on each label. */
export interface LabelStyle {
  /** Draws a halo around the text. */
  halo: boolean;
  rotationAlignment: RotationAlignment;
  /** Places labels even where they overlap another. */
  allowOverlap: boolean;
}

export const DEFAULT_LABEL_STYLE: LabelStyle = {
  halo: false,
  rotationAlignment: RotationAlignment.Map,
  allowOverlap: false,
};

/** What the scene holds besides the labels. */
export interface SceneOptions {
  /** A sphere of the Earth's radius, the labels on its surface. */
  globe: boolean;
  /** A block to drag in front of the labels. */
  occluder: boolean;
}

export const DEFAULT_SCENE: SceneOptions = { globe: false, occluder: false };

/** The settings that are numbers. */
type NumericKey = { [K in keyof LabelSettings]: LabelSettings[K] extends number ? K : never }[keyof LabelSettings];

interface Setting {
  label: string;
  unit?: string;
  /** What it does, shown on hover or focus. */
  hint: string;
  /** The option it sets, shown beside the label; the key of a manager option by default. */
  name?: string;
}

interface ManagerSetting extends Setting {
  key: keyof LabelSettings;
}

interface NumberSetting extends ManagerSetting {
  key: NumericKey;
  min: number;
  step: number;
  /** An empty box means no limit. */
  unbounded?: boolean;
}

interface ChoiceSetting extends ManagerSetting {
  key: NumericKey;
  values: number[];
  /** How a value reads in the list; the number itself by default. */
  display?: (value: number) => string;
}

const GROUPS: { title: string; settings: NumberSetting[] }[] = [
  {
    title: 'Placement',
    settings: [
      {
        key: 'placementIntervalMs',
        label: 'Pass interval',
        unit: 'ms',
        min: 0,
        step: 10,
        hint: 'Shortest time between the starts of two placement passes. A pass decides which labels fit without overlapping, nearest first. Lower reacts sooner and costs more CPU.',
      },
      {
        key: 'placementBudgetMs',
        label: 'Pass budget per frame',
        unit: 'ms',
        min: 1,
        step: 1,
        hint: 'Time a frame aims to spend on a pass, which continues over several frames. A frame runs at least one step and the sort is one step, so a frame can overrun it. Higher finishes passes sooner.',
      },
      {
        key: 'moveThresholdPx',
        label: 'Label move threshold',
        unit: 'px',
        min: 0,
        step: 0.5,
        hint: 'A new pass starts only once a placed label has moved this many CSS px on screen (or the labels changed). Higher means fewer passes during slow camera moves.',
      },
      {
        key: 'renderPenaltyMultiplier',
        label: 'Favour placed labels',
        unit: '×',
        min: 1,
        step: 0.25,
        hint: 'A label the last pass did not place has its squared distance multiplied by this when labels are sorted, so it must be its square root times nearer to take a placed label’s place. 1 means no preference; higher means steadier labels.',
      },
      {
        key: 'ndcCullMargin',
        label: 'Off-screen margin',
        min: 0,
        step: 0.05,
        hint: 'How far past the screen edge a label’s anchor may sit and still be considered, in normalised screen units (the screen spans −1 to 1 on each axis). A label is placed only once its whole box is on screen, so this matters only for labels moved away from their anchor.',
      },
    ],
  },
  {
    title: 'Fading',
    settings: [
      {
        key: 'fadeDurationMs',
        label: 'Fade time',
        unit: 'ms',
        min: 0,
        step: 50,
        hint: 'Time for a label to fade fully in or out. 0 shows and hides labels at once.',
      },
      {
        key: 'fadeGamma',
        label: 'Fade curve',
        min: 0.25,
        step: 0.25,
        hint: 'Opacity is the linear fade raised to this power, over the same fade time. 1 is linear; higher keeps labels faint longer as they appear and dims them sooner as they go.',
      },
    ],
  },
  {
    title: 'Distance',
    settings: [
      {
        key: 'labelNear',
        label: 'Nearest distance',
        unit: 'units',
        min: 0,
        step: 1,
        hint: 'Labels closer to the camera than this are not placed and fade out. 0 means no limit. In world units.',
      },
      {
        key: 'labelFar',
        label: 'Farthest distance',
        unit: 'units',
        min: 0,
        step: 10,
        unbounded: true,
        hint: 'Labels farther from the camera than this are not placed and fade out. Empty means no limit. In world units.',
      },
    ],
  },
];

const DEPTH_TEST: ManagerSetting = {
  key: 'depthTest',
  label: 'Depth test',
  hint: 'With it on, anything drawn before the labels (a block, terrain, the near side of a globe) hides the labels behind it. Off draws labels over everything, but only their front face: a Map label on the far side of the globe is seen from behind and stays hidden, a Viewport label shows through.',
};

const HALO: Setting = {
  label: 'Halo',
  name: 'haloWidth',
  hint: 'Sets haloWidth to 1 px and haloBlur to 10 px on every label; a halo reaches at most a quarter of the font size. Its colour marks the label’s language.',
};

const ROTATION_ALIGNMENT: Setting = {
  label: 'Rotation alignment',
  name: 'rotationAlignment',
  hint: 'Map keeps each label oriented in the world by its own rotation: on the globe it lies on the surface. Viewport keeps it facing the screen, whatever the camera does, and ignores that rotation.',
};

const ALLOW_OVERLAP: Setting = {
  label: 'Allow overlap',
  name: 'allowOverlap',
  hint: 'Places labels even over another label, as MapLibre’s text-allow-overlap does. Labels whose box crosses the screen edge or that are outside the distance limits are still removed. Each label still takes its area on the grid.',
};

const GLOBE: Setting = {
  label: 'Globe',
  hint: 'Puts the labels 2 000 m above a sphere of the Earth’s radius, in geocentric metres, with a logarithmic depth buffer. The camera orbits a point on the surface and zooms from orbit down to 100 m.',
};

const OCCLUDER: Setting = {
  label: 'Block to drag',
  hint: 'An opaque block with a move gizmo. Drag it in front of the labels to see which ones it hides: with Depth test on, the labels behind it; off, none.',
};

const CHOICES: ChoiceSetting[] = [
  {
    key: 'downscale',
    label: 'Collision grid resolution',
    values: [1, 2, 4, 8, 16],
    display: v => `÷${v}`,
    hint: 'The screen is divided by this on each axis to get the grid that tracks which areas are taken: ÷8 means each cell covers 8 × 8 CSS px. Larger is faster but spaces labels more coarsely; ÷1 is pixel-exact. Read once, so changing it starts the labels over.',
  },
  {
    key: 'atlasFontSize',
    label: 'Glyph raster size',
    unit: 'px',
    values: [16, 24, 32, 48, 64],
    hint: 'Size every glyph is drawn at in the shared atlas. Labels drawn at twice this or more look lumpy; larger is sharper and uses more memory. Read once, so changing it starts the labels over.',
  },
];

const ROTATION_ALIGNMENTS = [
  [RotationAlignment.Map, 'Map'],
  [RotationAlignment.Viewport, 'Viewport'],
] as const;

const SELECT = `rounded-md border border-white/[0.14] bg-zinc-800 px-2 py-1 text-[#f2f2f4] [font:inherit] ${FOCUS}`;

const HEADING = 'mt-1 text-[11px] font-semibold uppercase tracking-wide text-[#8e8e96]';

const ROW_CLASS = `${LABEL} flex items-center justify-between gap-3 rounded-md px-1 py-0.5 hover:bg-white/[0.05]`;

const NAME = 'ml-1.5 text-[11px] text-[#8e8e96] [font-family:ui-monospace,monospace]';

const HELP = 'h-[116px] flex-none overflow-y-auto rounded-md border border-white/[0.1] bg-black/30 p-2 text-[12px]/[1.45] text-[#c9c9d0]';

const nameOf = (setting: Setting) => setting.name ?? ('key' in setting ? String(setting.key) : undefined);

export interface LabelSettingsPanelProps {
  settings: LabelSettings;
  onChange: (settings: LabelSettings) => void;
  style: LabelStyle;
  onStyleChange: (style: LabelStyle) => void;
  scene: SceneOptions;
  onSceneChange: (scene: SceneOptions) => void;
}

/** Editor for the `@itowns/labels` options of the benchmark, and for the scene they are drawn in. */
export function LabelSettingsPanel({
  settings,
  onChange,
  style,
  onStyleChange,
  scene,
  onSceneChange,
}: LabelSettingsPanelProps) {
  const [shown, setShown] = useState<Setting | null>(null);

  const describe = (setting: Setting) => ({
    onMouseEnter: () => setShown(setting),
    onFocus: () => setShown(setting),
  });

  const title = (setting: Setting) => {
    const name = nameOf(setting);
    return (
      <span>
        {setting.label}
        {setting.unit ? <span className="text-[#8e8e96]">{` (${setting.unit})`}</span> : null}
        {name ? <code className={NAME}>{name}</code> : null}
      </span>
    );
  };

  const checkRow = (setting: Setting, checked: boolean, onToggle: (checked: boolean) => void) => (
    <label className={ROW_CLASS} {...describe(setting)}>
      {title(setting)}
      <input
        type="checkbox"
        className="m-0 h-[15px] w-[15px] cursor-pointer accent-sky-300"
        checked={checked}
        onChange={e => onToggle(e.target.checked)}
      />
    </label>
  );

  return (
    <details open className={`${PANEL} top-[152px] left-3 w-[360px] px-3.5 py-2`}>
      <summary className={`${LABEL} font-semibold`}>Label settings</summary>
      {/* The list scrolls; the help and reset button stay in view. */}
      <div className="mt-2 flex max-h-[calc(100vh-14rem)] flex-col gap-2" onMouseLeave={() => setShown(null)}>
        <div className="flex min-h-0 flex-col gap-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-0.5">
            <div className={HEADING}>Labels</div>
            {checkRow(HALO, style.halo, halo => onStyleChange({ ...style, halo }))}
            {checkRow(ALLOW_OVERLAP, style.allowOverlap, allowOverlap => onStyleChange({ ...style, allowOverlap }))}
            <label className={ROW_CLASS} {...describe(ROTATION_ALIGNMENT)}>
              {title(ROTATION_ALIGNMENT)}
              <select
                className={SELECT}
                value={style.rotationAlignment}
                onChange={e => onStyleChange({ ...style, rotationAlignment: Number(e.target.value) })}
              >
                {ROTATION_ALIGNMENTS.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-col gap-0.5">
            <div className={HEADING}>Scene</div>
            {checkRow(GLOBE, scene.globe, globe => onSceneChange({ ...scene, globe }))}
            {checkRow(OCCLUDER, scene.occluder, occluder => onSceneChange({ ...scene, occluder }))}
          </div>
          {GROUPS.map(({ title: group, settings: rows }) => (
            <div key={group} className="flex flex-col gap-0.5">
              <div className={HEADING}>{group}</div>
              {rows.map((setting) => {
                const { key, min, step, unbounded } = setting;
                return (
                  <label key={key} className={ROW_CLASS} {...describe(setting)}>
                    {title(setting)}
                    <input
                      type="number"
                      className={NUMBER_INPUT}
                      min={min}
                      step={step}
                      placeholder={unbounded ? '∞' : undefined}
                      value={Number.isFinite(settings[key]) ? settings[key] : ''}
                      onChange={(e) => {
                        const value = e.target.valueAsNumber;
                        if (Number.isNaN(value)) {
                          if (unbounded) onChange({ ...settings, [key]: Infinity });
                          return;
                        }
                        onChange({ ...settings, [key]: Math.max(min, value) });
                      }}
                    />
                  </label>
                );
              })}
            </div>
          ))}
          <div className="flex flex-col gap-0.5">
            <div className={HEADING}>Depth</div>
            {checkRow(DEPTH_TEST, settings.depthTest, depthTest => onChange({ ...settings, depthTest }))}
          </div>
          <div className="flex flex-col gap-0.5">
            <div className={HEADING}>Read once (starts the labels over)</div>
            {CHOICES.map((setting) => {
              const { key, values, display } = setting;
              return (
                <label key={key} className={ROW_CLASS} {...describe(setting)}>
                  {title(setting)}
                  <select
                    className={SELECT}
                    value={settings[key]}
                    onChange={e => onChange({ ...settings, [key]: Number(e.target.value) })}
                  >
                    {values.map(v => <option key={v} value={v}>{display ? display(v) : v}</option>)}
                  </select>
                </label>
              );
            })}
          </div>
        </div>
        <div className={HELP} aria-live="polite">
          {shown
            ? (
                <>
                  <code className="text-sky-300 [font-family:ui-monospace,monospace]">{nameOf(shown) ?? shown.label}</code>
                  <span>{`: ${shown.hint}`}</span>
                </>
              )
            : 'Hover or focus a setting to see what it does.'}
        </div>
        <button
          type="button"
          className={`flex-none cursor-pointer rounded-md border border-white/[0.14] bg-white/[0.06] px-2 py-1 text-[#f2f2f4] [font:inherit] ${FOCUS}`}
          onClick={() => {
            onChange(DEFAULT_LABEL_SETTINGS);
            onStyleChange(DEFAULT_LABEL_STYLE);
            onSceneChange(DEFAULT_SCENE);
          }}
        >
          Reset to defaults
        </button>
      </div>
    </details>
  );
}
