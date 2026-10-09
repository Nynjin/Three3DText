import { Color, Euler, Quaternion, Vector2, Vector3 } from 'three';
import type { GlyphInstance } from './Shaping/GlyphRun';
import type { TextAnalysis } from './Shaping/TextAnalysis';
import {
  DEFAULT_FONT_KEY,
  fontKeyStr,
  normalizeFontWeight,
  parseFontStack,
  type FontKey,
  type FontStyle,
  type FontWeight,
  type FontWeightName,
} from './Shaping/FontKey';

export enum TextAnchorX {
  Left = 0,
  Center = 1,
  Right = 2,
}

export enum TextAnchorY {
  Top = 0,
  Middle = 1,
  Bottom = 2,
  /** The first line's baseline. */
  Baseline = 3,
}

export enum TextAlign {
  /** Left, or Right for a paragraph whose first strong letter is from an RTL script. */
  Auto = 0,
  Left = 1,
  Center = 2,
  Right = 3,
  Justify = 4,
}

export enum TextTransform {
  None = 0,
  Uppercase = 1,
  Lowercase = 2,
  /** First letter of each word upper-cased; an apostrophe does not start a word. */
  Capitalize = 3,
}

export enum RotationAlignment {
  /** Oriented in world space by `rotation`. */
  Map = 0,
  /** Faces the camera; `rotation` is ignored. */
  Viewport = 1,
}

/**
 * MapLibre `symbol-placement`.
 *
 * TODO: only `Point` is implemented. `Line` and `Line-Center` are stored;
 * placement follows {@link RotationAlignment}.
 */
export enum SymbolPlacement {
  Point = 0,
  Line = 1,
  'Line-Center' = 2,
}

/** Change notification bits: what changed since the last one. */
export const LabelChangeType = {
  None: 0,
  Font: 1 << 0,
  Text: 1 << 1,
  Layout: 1 << 2,
  Style: 1 << 3,
  Transform: 1 << 4,
  Visibility: 1 << 5,
  Dispose: 1 << 6,
} as const;

/** Change that can alter placement. Not public. */
export const PLACEMENT_CHANGE = 1 << 7;

export type LabelChangeMask = number;

/** Per-side padding, in CSS px. */
export interface TextPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Collision box, label-local CSS px, y up: ink after anchor and offset, grown by `padding`. */
export interface LabelBounds {
  /** Left edge. */
  minX: number;
  /** Bottom edge. */
  minY: number;
  width: number;
  height: number;
}

/** Centre and size, in CSS px, of the union of the label's glyph bitmaps. */
export interface LabelQuad {
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/** Gets a {@link LabelChangeType} mask and the label. Unnamed bits are reserved. */
export type LabelChangeListener = (changes: LabelChangeMask, label: Label) => void;

/**
 * Units follow the Mapbox style spec: sizes in CSS px of the renderer's canvas,
 * spacing and offsets in em (multiples of `fontSize`). A map-aligned label
 * seen at an angle is foreshortened.
 */
export interface LabelOptions {
  text: string;

  /** Anchor, in world units. */
  position?: [number, number, number] | Vector3;
  /** Orientation under {@link RotationAlignment.Map}. A tuple is XYZ Euler angles, in radians. */
  rotation?: [number, number, number] | Euler | Quaternion;
  /** Shift from the anchor, in em; +x right, +y down. */
  offset?: [number, number] | Vector2;

  /**
   * String: CSS `font-family` list, trimmed; empty means the default font.
   * Weight and style come from {@link fontWeight} and {@link fontStyle}.
   *
   * Array: MapLibre `text-font` stack, e.g. `['Open Sans Semibold', 'Arial Unicode MS Bold']`.
   * Trailing words of a name give weight and style; the first name sets
   * {@link fontWeight} and {@link fontStyle} (normal if it names none). The
   * family list is the distinct families, in order. A `fontWeight` or
   * `fontStyle` in the same call wins.
   */
  font?: string | readonly string[];
  /** Em size, in CSS px. */
  fontSize?: number;
  fontWeight?: FontWeight | FontWeightName | number;
  fontStyle?: FontStyle;
  /** Extra space between glyphs, in em. */
  letterSpacing?: number;
  /** Distance between baselines, in em. */
  lineHeight?: number;

  /** Wrap width, in em. `Infinity` breaks only at `\n`. */
  maxWidth?: number;
  textAlign?: TextAlign;
  anchorX?: TextAnchorX;
  anchorY?: TextAnchorY;
  /** Space reserved from other labels, in CSS px; does not move the text. One number or `[top, right, bottom, left]`. */
  padding?: TextPadding | number | [number, number, number, number];

  color?: string | number | Color | Vector3;
  /** From 0 to 1. */
  opacity?: number;

  haloColor?: string | number | Color | Vector3;
  /** Halo extent past the ink edge, in CSS px. Draws no further than a quarter of `fontSize`. */
  haloWidth?: number;
  /** Fade-out distance past {@link haloWidth}, in CSS px. */
  haloBlur?: number;
  /** From 0 to 1, multiplied by `opacity`. */
  haloOpacity?: number;

  rotationAlignment?: RotationAlignment;
  /** TODO: stored, not acted on. See {@link SymbolPlacement}. */
  symbolPlacement?: SymbolPlacement;
  /** Place even over other labels; still reserves its region. */
  allowOverlap?: boolean;
  visible?: boolean;

  textTransform?: TextTransform;
}

let nextLabelId = 0;

/**
 * A setter notifies listeners when the value changes. Objects returned by
 * `position`, `rotation`, `offset`, `color`, `haloColor` and `padding` are the
 * label's own: in-place edits are not detected; assign a new value.
 */
export class Label {
  /** First listener; later ones go in `_moreListeners`. */
  private _listener: LabelChangeListener | undefined;
  private _moreListeners: LabelChangeListener[] | undefined;

  private readonly _id: string;

  private _text: string = '';
  private _textTransform: TextTransform = TextTransform.None;

  private _position!: Vector3;
  private _rotation!: Quaternion;
  private _offset!: Vector2;

  private _fontKey: FontKey = DEFAULT_FONT_KEY;
  private _fontKeyStr: string = fontKeyStr(DEFAULT_FONT_KEY);
  private _fontSize = 20;
  private _letterSpacing = 0;
  private _lineHeight = 1.2;

  private _maxWidth = Infinity;
  private _textAlign = TextAlign.Auto;
  private _anchorX = TextAnchorX.Left;
  private _anchorY = TextAnchorY.Top;
  private _padding: TextPadding = { top: 20, right: 20, bottom: 20, left: 20 };

  private _color!: Color;
  private _opacity: number = 1;

  private _haloColor!: Color;
  private _haloWidth: number = 0;
  private _haloBlur: number = 0;
  private _haloOpacity: number = 1;

  private _rotationAlignment: RotationAlignment = RotationAlignment.Map;
  private _symbolPlacement: SymbolPlacement = SymbolPlacement.Point;
  private _allowOverlap: boolean = false;

  private _visible: boolean = true;

  /**
   * Fade-out: 0 fully drawn, 1 invisible. Stepped each cull towards 0 while
   * {@link shouldRender} and {@link visible} hold, else towards 1.
   */
  occlusionFade: number = 1;

  /**
   * Whether the label holds a placement slot. Written by placement; set false
   * when the label leaves the mesh (removal, dispose, not fitting). A hand-set
   * value is overwritten.
   */
  shouldRender: boolean = false;

  /** Collision box, written by layout. Zero until laid out. */
  bounds: LabelBounds = { minX: 0, minY: 0, width: 0, height: 0 };

  /** Area the shader draws over. Written by layout. */
  quad: LabelQuad = { cx: 0, cy: 0, width: 0, height: 0 };

  /** Positioned glyphs with ink, label-local. Written by layout. */
  glyphs: GlyphInstance[] = [];

  /**
   * Cached text analysis; cleared when the displayed text changes and after layout.
   *
   * @internal
   */
  analysis: TextAnalysis | undefined;

  /** @throws {RangeError} If `fontWeight` is not 100 to 900 in steps of 100, or a weight name. */
  constructor(options: LabelOptions) {
    this._id = `label-${nextLabelId++}`;
    this._apply(options);
    this._position = orNew(this._position, Vector3);
    this._rotation = orNew(this._rotation, Quaternion);
    this._offset = orNew(this._offset, Vector2);
    this._color = orNew(this._color, Color);
    this._haloColor = orNew(this._haloColor, Color);
  }

  /** Unique within this module instance. */
  get id() {
    return this._id;
  }

  get text() {
    return this._text;
  }

  set text(value: string) {
    this._emit(this._apply({ text: value }));
  }

  get textTransform() {
    return this._textTransform;
  }

  set textTransform(value: TextTransform) {
    this._emit(this._apply({ textTransform: value }));
  }

  /** @returns The text as {@link textTransform} renders it. */
  getDisplayText(): string {
    switch (this._textTransform) {
      case TextTransform.Uppercase:
        return this._text.toUpperCase();
      case TextTransform.Lowercase:
        return this._text.toLowerCase();
      case TextTransform.Capitalize:
        return this._text.replace(/(?<![\p{L}\p{M}\p{N}'’])\p{L}/gu, c => c.toUpperCase());
      default:
        return this._text;
    }
  }

  get position(): Vector3 {
    return this._position;
  }

  set position(value: Vector3 | [number, number, number]) {
    this._emit(this._apply({ position: value }));
  }

  get rotation(): Quaternion {
    return this._rotation;
  }

  set rotation(value: [number, number, number] | Euler | Quaternion) {
    this._emit(this._apply({ rotation: value }));
  }

  get offset(): Vector2 {
    return this._offset;
  }

  set offset(value: Vector2 | [number, number]) {
    this._emit(this._apply({ offset: value }));
  }

  /** Shared by reference. Never mutate. */
  get fontKey(): FontKey {
    return this._fontKey;
  }

  /** String form of {@link fontKey}; equal strings, same font. */
  get fontKeyStr(): string {
    return this._fontKeyStr;
  }

  /** CSS family list: the trimmed string (empty gives the default font), or a `text-font` stack's distinct families, in order. */
  get font(): string {
    return this._fontKey.font;
  }

  set font(value: string | readonly string[]) {
    this._emit(this._apply({ font: value }));
  }

  get fontSize() {
    return this._fontSize;
  }

  set fontSize(value: number) {
    this._emit(this._apply({ fontSize: value }));
  }

  get fontWeight(): FontWeight {
    return this._fontKey.weight;
  }

  /**
   * Number or weight name; reads back as the canonical weight.
   *
   * @throws {RangeError} If not a CSS weight or weight name.
   */
  set fontWeight(value: FontWeight | FontWeightName | number) {
    this._emit(this._apply({ fontWeight: value }));
  }

  get fontStyle() {
    return this._fontKey.style;
  }

  set fontStyle(value: FontStyle) {
    this._emit(this._apply({ fontStyle: value }));
  }

  get letterSpacing() {
    return this._letterSpacing;
  }

  set letterSpacing(value: number) {
    this._emit(this._apply({ letterSpacing: value }));
  }

  get lineHeight() {
    return this._lineHeight;
  }

  set lineHeight(value: number) {
    this._emit(this._apply({ lineHeight: value }));
  }

  get maxWidth() {
    return this._maxWidth;
  }

  set maxWidth(value: number) {
    this._emit(this._apply({ maxWidth: value }));
  }

  get textAlign() {
    return this._textAlign;
  }

  set textAlign(value: TextAlign) {
    this._emit(this._apply({ textAlign: value }));
  }

  get anchorX() {
    return this._anchorX;
  }

  set anchorX(value: TextAnchorX) {
    this._emit(this._apply({ anchorX: value }));
  }

  get anchorY() {
    return this._anchorY;
  }

  set anchorY(value: TextAnchorY) {
    this._emit(this._apply({ anchorY: value }));
  }

  get padding(): TextPadding {
    return this._padding;
  }

  set padding(value: TextPadding | number | [number, number, number, number]) {
    this._emit(this._apply({ padding: value }));
  }

  get color(): Color {
    return this._color;
  }

  set color(value: string | number | Color | Vector3) {
    this._emit(this._apply({ color: value }));
  }

  get opacity() {
    return this._opacity;
  }

  set opacity(value: number) {
    this._emit(this._apply({ opacity: value }));
  }

  get haloColor(): Color {
    return this._haloColor;
  }

  set haloColor(value: string | number | Color | Vector3) {
    this._emit(this._apply({ haloColor: value }));
  }

  get haloWidth() {
    return this._haloWidth;
  }

  set haloWidth(value: number) {
    this._emit(this._apply({ haloWidth: value }));
  }

  get haloBlur() {
    return this._haloBlur;
  }

  set haloBlur(value: number) {
    this._emit(this._apply({ haloBlur: value }));
  }

  get haloOpacity() {
    return this._haloOpacity;
  }

  set haloOpacity(value: number) {
    this._emit(this._apply({ haloOpacity: value }));
  }

  /** @returns Whether halo width and opacity are both above 0. */
  hasHalo(): boolean {
    return this._haloWidth > 0 && this._haloOpacity > 0;
  }

  /** @returns The halo's opacity scaled by the label's, or 0 with no halo. */
  getDisplayedHaloOpacity(): number {
    if (!this.hasHalo()) return 0;
    return this._haloOpacity * this._opacity;
  }

  get rotationAlignment() {
    return this._rotationAlignment;
  }

  set rotationAlignment(value: RotationAlignment) {
    this._emit(this._apply({ rotationAlignment: value }));
  }

  get symbolPlacement() {
    return this._symbolPlacement;
  }

  set symbolPlacement(value: SymbolPlacement) {
    this._emit(this._apply({ symbolPlacement: value }));
  }

  get allowOverlap() {
    return this._allowOverlap;
  }

  set allowOverlap(value: boolean) {
    this._emit(this._apply({ allowOverlap: value }));
  }

  /** The flag and a non-zero {@link opacity}. */
  get visible() {
    return this._visible && this._opacity > 0;
  }

  set visible(value: boolean) {
    this._emit(this._apply({ visible: value }));
  }

  /**
   * Applies several properties with one notification. Omitted ones are left alone.
   *
   * @throws {RangeError} If `fontWeight` is not a CSS weight or weight name.
   *
   * @returns This label.
   */
  set(options: Partial<LabelOptions>): this {
    this._emit(this._apply(options));
    return this;
  }

  /**
   * Writes `options` without notifying.
   *
   * @returns What changed.
   */
  private _apply(options: Partial<LabelOptions>): LabelChangeMask {
    let changes: LabelChangeMask = LabelChangeType.None;

    if (options.position !== undefined) {
      const next = toVector3(options.position);
      if (differs(next, this._position)) {
        this._position = next;
        changes |= LabelChangeType.Transform;
      }
    }
    if (options.rotation !== undefined) {
      const next = toQuaternion(options.rotation);
      if (differs(next, this._rotation)) {
        this._rotation = next;
        changes |= LabelChangeType.Transform;
      }
    }
    if (options.offset !== undefined) {
      const next = toVector2(options.offset);
      if (differs(next, this._offset)) {
        this._offset = next;
        changes |= LabelChangeType.Layout;
      }
    }

    // An explicit `fontWeight` or `fontStyle` beats the stack's.
    if (options.font !== undefined || options.fontWeight !== undefined || options.fontStyle !== undefined) {
      const given = options.font;
      const stack = given !== undefined && typeof given !== 'string' ? parseFontStack(given) : undefined;
      const next: FontKey = {
        font: typeof given === 'string' ? given.trim() || DEFAULT_FONT_KEY.font : stack?.font ?? this._fontKey.font,
        weight: options.fontWeight !== undefined
          ? normalizeFontWeight(options.fontWeight)
          : stack?.weight ?? this._fontKey.weight,
        style: options.fontStyle ?? stack?.style ?? this._fontKey.style,
      };
      const nextStr = fontKeyStr(next);
      if (nextStr !== this._fontKeyStr) {
        this._fontKey = next;
        this._fontKeyStr = nextStr;
        changes |= LabelChangeType.Font;
      }
    }

    if (options.text !== undefined && options.text !== this._text) {
      this._text = options.text;
      this.analysis = undefined;
      changes |= LabelChangeType.Text;
    }
    if (options.textTransform !== undefined && options.textTransform !== this._textTransform) {
      this._textTransform = options.textTransform;
      this.analysis = undefined;
      changes |= LabelChangeType.Text;
    }

    if (options.fontSize !== undefined && options.fontSize !== this._fontSize) {
      this._fontSize = options.fontSize;
      changes |= LabelChangeType.Layout;
    }
    if (options.letterSpacing !== undefined && options.letterSpacing !== this._letterSpacing) {
      this._letterSpacing = options.letterSpacing;
      changes |= LabelChangeType.Layout;
    }
    if (options.lineHeight !== undefined && options.lineHeight !== this._lineHeight) {
      this._lineHeight = options.lineHeight;
      changes |= LabelChangeType.Layout;
    }
    if (options.maxWidth !== undefined && options.maxWidth !== this._maxWidth) {
      this._maxWidth = options.maxWidth;
      changes |= LabelChangeType.Layout;
    }
    if (options.textAlign !== undefined && options.textAlign !== this._textAlign) {
      this._textAlign = options.textAlign;
      changes |= LabelChangeType.Layout;
    }
    if (options.anchorX !== undefined && options.anchorX !== this._anchorX) {
      this._anchorX = options.anchorX;
      changes |= LabelChangeType.Layout;
    }
    if (options.anchorY !== undefined && options.anchorY !== this._anchorY) {
      this._anchorY = options.anchorY;
      changes |= LabelChangeType.Layout;
    }
    if (options.padding !== undefined) {
      const next = parsePadding(options.padding);
      const p = this._padding;
      if (next.top !== p.top || next.right !== p.right || next.bottom !== p.bottom || next.left !== p.left) {
        this._padding = next;
        changes |= LabelChangeType.Layout;
      }
    }

    // Colours, `symbolPlacement` and opacity changes not crossing 0 affect drawing
    // only; the rest can affect placement.
    if (options.color !== undefined) {
      const next = toColor(options.color);
      if (differs(next, this._color)) {
        this._color = next;
        changes |= LabelChangeType.Style;
      }
    }
    if (options.opacity !== undefined && options.opacity !== this._opacity) {
      if ((options.opacity > 0) !== (this._opacity > 0)) changes |= PLACEMENT_CHANGE;
      this._opacity = options.opacity;
      changes |= LabelChangeType.Style;
    }
    if (options.haloColor !== undefined) {
      const next = toColor(options.haloColor);
      if (differs(next, this._haloColor)) {
        this._haloColor = next;
        changes |= LabelChangeType.Style;
      }
    }
    if (options.haloWidth !== undefined && options.haloWidth !== this._haloWidth) {
      this._haloWidth = options.haloWidth;
      changes |= LabelChangeType.Style | PLACEMENT_CHANGE;
    }
    if (options.haloBlur !== undefined && options.haloBlur !== this._haloBlur) {
      this._haloBlur = options.haloBlur;
      changes |= LabelChangeType.Style | PLACEMENT_CHANGE;
    }
    if (options.haloOpacity !== undefined && options.haloOpacity !== this._haloOpacity) {
      if ((options.haloOpacity > 0) !== (this._haloOpacity > 0)) changes |= PLACEMENT_CHANGE;
      this._haloOpacity = options.haloOpacity;
      changes |= LabelChangeType.Style;
    }
    if (options.rotationAlignment !== undefined && options.rotationAlignment !== this._rotationAlignment) {
      this._rotationAlignment = options.rotationAlignment;
      changes |= LabelChangeType.Style | PLACEMENT_CHANGE;
    }
    if (options.symbolPlacement !== undefined && options.symbolPlacement !== this._symbolPlacement) {
      this._symbolPlacement = options.symbolPlacement;
      changes |= LabelChangeType.Style;
    }

    if (options.allowOverlap !== undefined && options.allowOverlap !== this._allowOverlap) {
      this._allowOverlap = options.allowOverlap;
      changes |= PLACEMENT_CHANGE;
    }

    if (options.visible !== undefined && options.visible !== this._visible) {
      this._visible = options.visible;
      changes |= LabelChangeType.Visibility;
    }

    return changes;
  }

  /** @returns Copy of every option, with a new id and no listeners. Layout output is not copied. */
  clone(): Label {
    return new Label({
      text: this._text,
      position: this._position,
      rotation: this._rotation,
      offset: this._offset,
      font: this._fontKey.font,
      fontSize: this._fontSize,
      fontWeight: this._fontKey.weight,
      fontStyle: this._fontKey.style,
      letterSpacing: this._letterSpacing,
      lineHeight: this._lineHeight,
      maxWidth: this._maxWidth,
      textAlign: this._textAlign,
      anchorX: this._anchorX,
      anchorY: this._anchorY,
      padding: this._padding,
      color: this._color,
      opacity: this._opacity,
      haloColor: this._haloColor,
      haloWidth: this._haloWidth,
      haloBlur: this._haloBlur,
      haloOpacity: this._haloOpacity,
      rotationAlignment: this._rotationAlignment,
      symbolPlacement: this._symbolPlacement,
      allowOverlap: this._allowOverlap,
      visible: this._visible,
      textTransform: this._textTransform,
    });
  }

  /**
   * Emits {@link LabelChangeType.Dispose}, which releases the label from its
   * manager, then drops every listener. The label stays usable.
   */
  dispose() {
    this._emit(LabelChangeType.Dispose);
    this._listener = undefined;
    this._moreListeners = undefined;
  }

  /**
   * Subscribes to property changes. A listener already subscribed is not added twice.
   *
   * @returns Unsubscribe function.
   */
  onChange(listener: LabelChangeListener): () => void {
    if (this._listener === listener || this._moreListeners?.includes(listener)) return () => this.offChange(listener);
    if (this._listener === undefined) this._listener = listener;
    else (this._moreListeners ??= []).push(listener);
    return () => this.offChange(listener);
  }

  /**
   * Undoes {@link onChange}. An unknown listener is ignored.
   *
   * @internal
   */
  offChange(listener: LabelChangeListener): void {
    const more = this._moreListeners;
    if (this._listener === listener) {
      this._listener = more === undefined ? undefined : more.shift();
      return;
    }
    if (more === undefined) return;
    const at = more.indexOf(listener);
    if (at >= 0) more.splice(at, 1);
  }

  /** A `None` mask is dropped. */
  private _emit(changes: LabelChangeMask): void {
    const first = this._listener;
    if (changes === LabelChangeType.None || first === undefined) return;
    // A listener may unsubscribe while it runs.
    const more = this._moreListeners && [...this._moreListeners];
    first(changes, this);
    if (more) for (const listener of more) listener(changes, this);
  }
}

function parsePadding(value: TextPadding | number | [number, number, number, number]): TextPadding {
  if (Array.isArray(value)) return { top: value[0], right: value[1], bottom: value[2], left: value[3] };
  if (typeof value === 'number') return { top: value, right: value, bottom: value, left: value };
  return { ...value };
}

/** `current`, or a new `Type`. */
function orNew<T>(current: T | undefined, Type: new () => T): T {
  return current ?? new Type();
}

/** `current` is unset or not equal to `next`. */
function differs<T extends { equals(other: T): boolean }>(next: T, current: T | undefined): boolean {
  return current === undefined || !next.equals(current);
}

/** Parsed colour strings; at most `MAX_PARSED_COLORS`. */
const PARSED_COLORS = new Map<string, Color>();
const MAX_PARSED_COLORS = 512;

function toColor(value: string | number | Color | Vector3): Color {
  if (value instanceof Color) return value.clone();
  if (value instanceof Vector3) return new Color(value.x, value.y, value.z);
  if (typeof value !== 'string') return new Color(value);
  let parsed = PARSED_COLORS.get(value);
  if (!parsed) {
    parsed = new Color(value);
    if (PARSED_COLORS.size < MAX_PARSED_COLORS) PARSED_COLORS.set(value, parsed);
    return parsed.clone();
  }
  return parsed.clone();
}

function toVector2(value: [number, number] | Vector2): Vector2 {
  if (value instanceof Vector2) return value.clone();
  return new Vector2(...value);
}

function toVector3(value: [number, number, number] | Vector3): Vector3 {
  if (value instanceof Vector3) return value.clone();
  return new Vector3(value[0], value[1], value[2]);
}

const SCRATCH_EULER = new Euler();

function toQuaternion(value: [number, number, number] | Euler | Quaternion): Quaternion {
  if (value instanceof Quaternion) return value.clone();
  if (value instanceof Euler) return new Quaternion().setFromEuler(value);
  return new Quaternion().setFromEuler(SCRATCH_EULER.set(value[0], value[1], value[2], 'XYZ'));
}
