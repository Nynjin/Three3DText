import { useState } from 'react';
import type { LabelManagerConfig } from '@itowns/labels';
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
};

interface Setting {
  key: keyof LabelSettings;
  label: string;
  unit?: string;
  /** What it does, shown on hover or focus. */
  hint: string;
}

interface NumberSetting extends Setting {
  min: number;
  step: number;
  /** An empty box means no limit. */
  unbounded?: boolean;
}

interface ChoiceSetting extends Setting {
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
        hint: 'Time one frame spends on a pass; a pass continues over several frames. Higher finishes passes sooner but takes more of each frame.',
      },
      {
        key: 'moveThresholdPx',
        label: 'Camera move threshold',
        unit: 'px',
        min: 0,
        step: 0.5,
        hint: 'A new pass starts only once a placed label has moved this many screen pixels (or the labels changed). Higher means fewer passes during slow camera moves.',
      },
      {
        key: 'renderPenaltyMultiplier',
        label: 'Favour shown labels',
        unit: '×',
        min: 1,
        step: 0.25,
        hint: 'A label not shown by the last pass has its squared distance multiplied by this when labels are sorted, so a newcomer must be its square root times nearer to take a shown label’s place. 1 means no preference; higher means steadier labels.',
      },
      {
        key: 'ndcCullMargin',
        label: 'Off-screen margin',
        min: 0,
        step: 0.05,
        hint: 'How far past the screen edge a label’s anchor may sit and still take part, in normalised screen units (the screen spans −1 to 1, so 0.2 is 10% of its width on each side). Keeps labels from popping in at the edge.',
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
        hint: '1 is a linear fade. Lower fades labels in faster; higher fades them out faster.',
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
        hint: 'Labels closer to the camera than this are not placed. 0 means no limit. In world units.',
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

const CHOICES: ChoiceSetting[] = [
  {
    key: 'downscale',
    label: 'Collision grid resolution',
    values: [1, 2, 4, 8, 16],
    display: v => `÷${v}`,
    hint: 'The screen is divided by this on each axis to get the grid that tracks which areas are taken: ÷8 means each cell covers 8 × 8 screen px. Larger is faster but spaces labels more coarsely; ÷1 is pixel-exact. Read once, so changing it starts the labels over.',
  },
  {
    key: 'atlasFontSize',
    label: 'Glyph raster size',
    unit: 'px',
    values: [16, 24, 32, 48, 64],
    hint: 'Size every glyph is drawn at in the shared atlas. Labels drawn at twice this or more look lumpy; larger is sharper and uses more memory. Read once, so changing it starts the labels over.',
  },
];

const SELECT = `rounded-md border border-white/[0.14] bg-zinc-800 px-2 py-1 text-[#f2f2f4] [font:inherit] ${FOCUS}`;

const HEADING = 'mt-1 text-[11px] font-semibold uppercase tracking-wide text-[#8e8e96]';

const ROW_CLASS = `${LABEL} flex items-center justify-between gap-3 rounded-md px-1 py-0.5 hover:bg-white/[0.05]`;

const NAME = 'ml-1.5 text-[11px] text-[#8e8e96] [font-family:ui-monospace,monospace]';

const HELP = 'h-[116px] flex-none overflow-y-auto rounded-md border border-white/[0.1] bg-black/30 p-2 text-[12px]/[1.45] text-[#c9c9d0]';

export interface LabelSettingsPanelProps {
  settings: LabelSettings;
  onChange: (settings: LabelSettings) => void;
}

/** Editor for the `@itowns/labels` manager options of the benchmark. */
export function LabelSettingsPanel({ settings, onChange }: LabelSettingsPanelProps) {
  const [shown, setShown] = useState<Setting | null>(null);

  const describe = (setting: Setting) => ({
    onMouseEnter: () => setShown(setting),
    onFocus: () => setShown(setting),
  });

  const title = (setting: Setting) => (
    <span>
      {setting.label}
      {setting.unit ? <span className="text-[#8e8e96]">{` (${setting.unit})`}</span> : null}
      <code className={NAME}>{setting.key}</code>
    </span>
  );

  return (
    <details className={`${PANEL} bottom-14 left-3 w-[360px] px-3.5 py-2`}>
      <summary className={`${LABEL} font-semibold`}>Label settings</summary>
      {/* The list scrolls; the help and reset button stay in view. */}
      <div className="mt-2 flex max-h-[calc(100vh-190px)] flex-col gap-2" onMouseLeave={() => setShown(null)}>
        <div className="flex min-h-0 flex-col gap-1 overflow-y-auto pr-1">
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
                  <code className="text-sky-300 [font-family:ui-monospace,monospace]">{shown.key}</code>
                  <span>{`: ${shown.hint}`}</span>
                </>
              )
            : 'Hover or focus a setting to see what it does.'}
        </div>
        <button
          type="button"
          className={`flex-none cursor-pointer rounded-md border border-white/[0.14] bg-white/[0.06] px-2 py-1 text-[#f2f2f4] [font:inherit] ${FOCUS}`}
          onClick={() => onChange(DEFAULT_LABEL_SETTINGS)}
        >
          Reset to defaults
        </button>
      </div>
    </details>
  );
}
