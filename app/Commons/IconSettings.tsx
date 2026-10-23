import type { ReactNode } from 'react';
import type { IconTextFit, SymbolAnchor } from '@itowns/labels';
import { FOCUS, LABEL, NUMBER_INPUT, PANEL } from './Ui';

/** Which image each label shows. */
export type IconChoice = 'none' | 'pin' | 'photo' | 'pin-sdf' | 'dot-sdf' | 'shield' | 'mixed' | 'sprite';

/** Icon options, set on every label. Lengths in CSS px unless noted. */
export interface IconStyle {
  choice: IconChoice;
  iconSize: number;
  iconAnchor: SymbolAnchor;
  /** Image px times `iconSize`. */
  iconOffsetX: number;
  iconOffsetY: number;
  iconTextFit: IconTextFit;
  iconTextFitPadding: number;
  iconPadding: number;
  iconColor: string;
  iconHaloWidth: number;
  iconAllowOverlap: boolean;
  iconOptional: boolean;
  textOptional: boolean;
  /** Text anchor, MapLibre names. */
  textAnchor: SymbolAnchor;
  /** Em. */
  textOffsetX: number;
  /** Em. */
  textOffsetY: number;
  /** Base URL of a MapLibre sprite, without `.json`. */
  spriteUrl: string;
  spriteHiDpi: boolean;
}

export const DEFAULT_ICON_STYLE: IconStyle = {
  choice: 'none',
  iconSize: 1,
  iconAnchor: 'bottom',
  iconOffsetX: 0,
  iconOffsetY: 0,
  iconTextFit: 'none',
  iconTextFitPadding: 2,
  iconPadding: 2,
  iconColor: '#0f766e',
  iconHaloWidth: 0,
  iconAllowOverlap: false,
  iconOptional: false,
  textOptional: false,
  textAnchor: 'center',
  textOffsetX: 0,
  textOffsetY: 0,
  spriteUrl: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
  spriteHiDpi: true,
};

/** Starting points, applied over the current style. */
const PRESETS: { name: string; style: Partial<IconStyle> }[] = [
  { name: 'Pin above text', style: { choice: 'pin', iconAnchor: 'bottom', textAnchor: 'top', textOffsetX: 0, textOffsetY: 0.2, iconTextFit: 'none' } },
  { name: 'Mixed images', style: { choice: 'mixed', iconAnchor: 'bottom', textAnchor: 'top', textOffsetX: 0, textOffsetY: 0.2, iconTextFit: 'none' } },
  { name: 'SDF dot, text right', style: { choice: 'dot-sdf', iconAnchor: 'center', textAnchor: 'left', textOffsetX: 0.6, textOffsetY: 0, iconTextFit: 'none', iconHaloWidth: 2 } },
  { name: 'Road shield', style: { choice: 'shield', iconTextFit: 'both', iconTextFitPadding: 2, textAnchor: 'center', textOffsetX: 0, textOffsetY: 0 } },
  { name: 'Icon may stand alone', style: { choice: 'pin', iconAnchor: 'bottom', textAnchor: 'top', textOffsetX: 0, textOffsetY: 0.2, iconTextFit: 'none', textOptional: true } },
];

const ANCHORS: SymbolAnchor[] = ['center', 'left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
const FITS: IconTextFit[] = ['none', 'width', 'height', 'both'];
const CHOICES: [IconChoice, string][] = [
  ['none', 'None'],
  ['pin', 'Pin (bitmap)'],
  ['photo', 'Picture (bitmap)'],
  ['pin-sdf', 'Pin (SDF)'],
  ['dot-sdf', 'Dot (SDF)'],
  ['shield', 'Shield (stretchable)'],
  ['mixed', 'Mixed, per label'],
  ['sprite', 'Sprite sheet, per label'],
];

const SELECT = `rounded-md border border-white/[0.14] bg-zinc-800 px-2 py-1 text-[#f2f2f4] [font:inherit] ${FOCUS}`;
const HEADING = 'mt-1 text-[11px] font-semibold uppercase tracking-wide text-[#8e8e96]';
const ROW_CLASS = `${LABEL} flex items-center justify-between gap-3 rounded-md px-1 py-0.5 hover:bg-white/[0.05]`;
const NAME = 'ml-1.5 text-[11px] text-[#8e8e96] [font-family:ui-monospace,monospace]';
const BUTTON = `cursor-pointer rounded-md border border-white/[0.14] bg-white/[0.06] px-2 py-1 text-[12px] text-[#f2f2f4] [font:inherit] ${FOCUS}`;

export interface IconSettingsPanelProps {
  style: IconStyle;
  onChange: (style: IconStyle) => void;
  /** Sprite load state, shown under the URL. */
  spriteStatus: string;
  onLoadSprite: () => void;
}

/** Editor for the icon options of every label. */
export function IconSettingsPanel({ style, onChange, spriteStatus, onLoadSprite }: IconSettingsPanelProps) {
  const set = (patch: Partial<IconStyle>) => onChange({ ...style, ...patch });

  const row = (label: string, name: string, control: ReactNode) => (
    <label className={ROW_CLASS}>
      <span>
        {label}
        <code className={NAME}>{name}</code>
      </span>
      {control}
    </label>
  );
  const num = (key: keyof IconStyle, step: number, min?: number) => (
    <input
      type="number"
      className={NUMBER_INPUT}
      step={step}
      min={min}
      value={style[key] as number}
      onChange={(e) => {
        const v = e.target.valueAsNumber;
        if (!Number.isNaN(v)) set({ [key]: min === undefined ? v : Math.max(min, v) });
      }}
    />
  );
  const check = (key: keyof IconStyle) => (
    <input
      type="checkbox"
      className="m-0 h-[15px] w-[15px] cursor-pointer accent-sky-300"
      checked={style[key] as boolean}
      onChange={e => set({ [key]: e.target.checked })}
    />
  );
  const select = <T extends string>(key: keyof IconStyle, values: readonly T[] | [T, string][]) => (
    <select className={SELECT} value={style[key] as string} onChange={e => set({ [key]: e.target.value })}>
      {values.map(v => Array.isArray(v)
        ? <option key={v[0]} value={v[0]}>{v[1]}</option>
        : <option key={v} value={v}>{v}</option>)}
    </select>
  );

  return (
    <details open className={`${PANEL} top-[300px] right-3 w-[340px] px-3.5 py-2`}>
      <summary className={`${LABEL} font-semibold`}>Icons (prototype)</summary>
      <div className="mt-2 flex max-h-[calc(100vh-22rem)] flex-col gap-1 overflow-y-auto pr-1">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map(p => (
            <button key={p.name} type="button" className={BUTTON} onClick={() => set(p.style)}>{p.name}</button>
          ))}
        </div>

        <div className={HEADING}>Image</div>
        {row('Image', 'iconImage', select('choice', CHOICES))}
        {style.choice === 'sprite' && (
          <div className="flex flex-col gap-1 px-1">
            <input
              type="text"
              className={`${NUMBER_INPUT} w-full text-left`}
              value={style.spriteUrl}
              onChange={e => set({ spriteUrl: e.target.value })}
              aria-label="Sprite URL, without .json"
            />
            <div className="flex items-center justify-between gap-2">
              <label className={`${LABEL} flex items-center gap-2`}>
                {check('spriteHiDpi')}
                @2x
              </label>
              <button type="button" className={BUTTON} onClick={onLoadSprite}>Load sprite</button>
            </div>
            <div className="text-[12px] text-[#8e8e96]">{spriteStatus}</div>
          </div>
        )}
        {row('Size', 'iconSize', num('iconSize', 0.25, 0))}
        {row('Anchor', 'iconAnchor', select('iconAnchor', ANCHORS))}
        {row('Offset x (icon px)', 'iconOffset[0]', num('iconOffsetX', 1))}
        {row('Offset y (icon px)', 'iconOffset[1]', num('iconOffsetY', 1))}
        {row('Fit to text', 'iconTextFit', select('iconTextFit', FITS))}
        {row('Fit padding (px)', 'iconTextFitPadding', num('iconTextFitPadding', 1, 0))}

        <div className={HEADING}>SDF images only</div>
        {row('Colour', 'iconColor', (
          <input type="color" className="h-[22px] w-[44px] cursor-pointer" value={style.iconColor} onChange={e => set({ iconColor: e.target.value })} />
        ))}
        {row('Halo width (px)', 'iconHaloWidth', num('iconHaloWidth', 0.5, 0))}

        <div className={HEADING}>Text beside the icon</div>
        {row('Text anchor', 'anchorX / anchorY', select('textAnchor', ANCHORS))}
        {row('Text offset x (em)', 'offset[0]', num('textOffsetX', 0.1))}
        {row('Text offset y (em)', 'offset[1]', num('textOffsetY', 0.1))}

        <div className={HEADING}>Collision</div>
        {row('Icon padding (px)', 'iconPadding', num('iconPadding', 1, 0))}
        {row('Icon overlaps others', 'iconAllowOverlap', check('iconAllowOverlap'))}
        {row('Text may drop the icon', 'iconOptional', check('iconOptional'))}
        {row('Icon may drop the text', 'textOptional', check('textOptional'))}
      </div>
    </details>
  );
}
