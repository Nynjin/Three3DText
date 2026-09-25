import { Color, Euler, Quaternion, Vector2, Vector3 } from 'three';
import type { GlyphInstance } from './Shaping/GlyphRun';
import {
  DEFAULT_FONT_KEY,
  fontKeyStr,
  normalizeFontWeight,
  parseFontDescriptor,
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
  /** Left, or Right when the text's first strong letter is from an RTL script. */
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
 * TODO: only `Point` is implemented. `Line` and `Line-Center` are accepted and
 * stored, but placement follows {@link RotationAlignment} alone.
 */
export enum SymbolPlacement {
  Point = 0,
  Line = 1,
  'Line-Center' = 2,
}

/** Bits of a label's change notification: what changed since the last one. */
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

export type LabelChangeMask = number;

/** Per-side padding, in CSS px. */
export interface TextPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * A label's collision box in label-local space, in CSS px, y up: its ink after
 * the anchor and offset are applied, grown by `padding`.
 */
export interface LabelBounds {
  /** Left edge. */
  minX: number;
  /** Bottom edge. */
  minY: number;
  width: number;
  height: number;
}

/** Centre and size, in CSS px, of the area a label draws over: the union of its glyph bitmaps. */
export interface LabelQuad {
  cx: number;
  cy: number;
  width: number;
  height: number;
}

export type LabelChangeListener = (changes: LabelChangeMask) => void;

/**
 * A label's properties. Units follow the Mapbox style specification: sizes in
 * CSS px of the renderer's canvas, spacing and offsets in em (multiples of
 * `fontSize`). Sizes hold on a label facing the camera; a map-aligned label
 * seen at an angle is foreshortened.
 */
export interface LabelOptions {
  text: string;

  /** Anchor point, in world units. */
  position?: [number, number, number] | Vector3;
  /** Orientation under {@link RotationAlignment.Map}. A tuple is XYZ Euler angles, in radians. */
  rotation?: [number, number, number] | Euler | Quaternion;
  /** Shift from the anchor, in em; +x right, +y down. */
  offset?: [number, number] | Vector2;

  /**
   * CSS family name, or a comma-separated list. Trailing weight and style
   * words, as in `'Open Sans Semi Bold Italic'`, set {@link fontWeight} and
   * {@link fontStyle} unless those are given too.
   */
  font?: string;
  /** Text height, in CSS px. */
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
  /** Space around the text reserved from other labels, in CSS px; it does not move the text. One number, or `[top, right, bottom, left]`. */
  padding?: TextPadding | number | [number, number, number, number];

  color?: string | number | Color | Vector3;
  /** From 0 to 1. */
  opacity?: number;

  haloColor?: string | number | Color | Vector3;
  /**
   * Distance of the halo from the ink edge, in CSS px. The field reaches a
   * quarter of `fontSize` past the ink; a wider halo draws no further.
   */
  haloWidth?: number;
  /** Fade-out distance past {@link haloWidth}, in CSS px. */
  haloBlur?: number;
  /** From 0 to 1, multiplied by `opacity`. */
  haloOpacity?: number;

  rotationAlignment?: RotationAlignment;
  /** TODO: stored and sent to the shader, but not acted on. See {@link SymbolPlacement}. */
  symbolPlacement?: SymbolPlacement;
  visible?: boolean;

  textTransform?: TextTransform;
}

/**
 * One label. Every setter notifies the manager holding it. The objects returned
 * by `position`, `rotation`, `offset`, `color`, `haloColor` and `padding` are the
 * label's own: an edit in place is not detected, so assign a new value instead.
 */
export class Label {
  private _listeners = new Set<LabelChangeListener>();

  private readonly _id: string;

  private _text: string = '';
  private _textTransform: TextTransform = TextTransform.None;

  private _position: Vector3 = new Vector3();
  private _rotation: Quaternion = new Quaternion();
  private _offset: Vector2 = new Vector2();

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

  private _color: Color = new Color();
  private _opacity: number = 1;

  private _haloColor: Color = new Color();
  private _haloWidth: number = 0;
  private _haloBlur: number = 0;
  private _haloOpacity: number = 1;

  private _rotationAlignment: RotationAlignment = RotationAlignment.Map;
  private _symbolPlacement: SymbolPlacement = SymbolPlacement.Point;

  private _visible: boolean = true;

  /**
   * How far the label has faded out: 0 fully drawn, 1 invisible. The manager
   * steps it each cull, towards 0 while {@link shouldRender} holds.
   */
  occlusionFade: number = 1;

  /**
   * Whether placement gave the label a slot on the last pass. Written by the
   * collision engine; setting it by hand is overwritten on the next pass.
   */
  shouldRender: boolean = false;

  /** Collision box, written by layout. Zero-sized until the label is laid out. */
  bounds: LabelBounds = { minX: 0, minY: 0, width: 0, height: 0 };

  /** Area the shader draws over, written by layout. */
  quad: LabelQuad = { cx: 0, cy: 0, width: 0, height: 0 };

  /** Positioned glyphs with ink, in label-local space. Written by layout. */
  glyphs: GlyphInstance[] = [];

  constructor(options: LabelOptions) {
    this._id = crypto.randomUUID();
    this._apply(options);
  }

  get id() {
    return this._id;
  }

  get text() {
    return this._text;
  }

  set text(value: string) {
    this._text = value;
    this._emit(LabelChangeType.Text);
  }

  get textTransform() {
    return this._textTransform;
  }

  set textTransform(value: TextTransform) {
    this._textTransform = value;
    this._emit(LabelChangeType.Text);
  }

  /** @returns The text as {@link textTransform} renders it. */
  getDisplayText(): string {
    switch (this._textTransform) {
      case TextTransform.Uppercase:
        return this._text.toUpperCase();
      case TextTransform.Lowercase:
        return this._text.toLowerCase();
      case TextTransform.Capitalize:
        return this._text.replace(/\b\w/g, c => c.toUpperCase());
      default:
        return this._text;
    }
  }

  get position(): Vector3 {
    return this._position;
  }

  set position(value: Vector3 | [number, number, number]) {
    this._position = toVector3(value);
    this._emit(LabelChangeType.Transform);
  }

  get rotation(): Quaternion {
    return this._rotation;
  }

  set rotation(value: [number, number, number] | Euler | Quaternion) {
    this._rotation = toQuaternion(value);
    this._emit(LabelChangeType.Transform);
  }

  get offset(): Vector2 {
    return this._offset;
  }

  set offset(value: Vector2 | [number, number]) {
    this._offset = toVector2(value);
    this._emit(LabelChangeType.Layout);
  }

  /** The label's font identity, shared by reference. Never mutate it. */
  get fontKey(): FontKey {
    return this._fontKey;
  }

  /** Cached identity of {@link fontKey}, for grouping labels by font. */
  get fontKeyStr(): string {
    return this._fontKeyStr;
  }

  /** The family, without the weight and style words a descriptor may have carried. */
  get font() {
    return this._fontKey.font;
  }

  set font(value: string) {
    const parsed = parseFontDescriptor(value);
    this._setFontKey({
      font: parsed.font,
      weight: parsed.weight ?? this._fontKey.weight,
      style: parsed.style ?? this._fontKey.style,
    });
  }

  get fontSize() {
    return this._fontSize;
  }

  set fontSize(value: number) {
    this._fontSize = value;
    this._emit(LabelChangeType.Layout);
  }

  get fontWeight(): FontWeight {
    return this._fontKey.weight;
  }

  /**
   * Accepts a number or an alias name; always reads back as the canonical weight.
   *
   * @throws {RangeError} If the value is not a CSS weight or a known alias.
   */
  set fontWeight(value: FontWeight | FontWeightName | number) {
    this._setFontKey({ ...this._fontKey, weight: normalizeFontWeight(value) });
  }

  get fontStyle() {
    return this._fontKey.style;
  }

  set fontStyle(value: FontStyle) {
    this._setFontKey({ ...this._fontKey, style: value });
  }

  /** Replaces the font key; a set that does not change it emits nothing. */
  private _setFontKey(next: FontKey) {
    const nextStr = fontKeyStr(next);
    if (nextStr === this._fontKeyStr) return;

    this._fontKey = next;
    this._fontKeyStr = nextStr;
    this._emit(LabelChangeType.Font);
  }

  get letterSpacing() {
    return this._letterSpacing;
  }

  set letterSpacing(value: number) {
    this._letterSpacing = value;
    this._emit(LabelChangeType.Layout);
  }

  get lineHeight() {
    return this._lineHeight;
  }

  set lineHeight(value: number) {
    this._lineHeight = value;
    this._emit(LabelChangeType.Layout);
  }

  get maxWidth() {
    return this._maxWidth;
  }

  set maxWidth(value: number) {
    this._maxWidth = value;
    this._emit(LabelChangeType.Layout);
  }

  get textAlign() {
    return this._textAlign;
  }

  set textAlign(value: TextAlign) {
    this._textAlign = value;
    this._emit(LabelChangeType.Layout);
  }

  get anchorX() {
    return this._anchorX;
  }

  set anchorX(value: TextAnchorX) {
    this._anchorX = value;
    this._emit(LabelChangeType.Layout);
  }

  get anchorY() {
    return this._anchorY;
  }

  set anchorY(value: TextAnchorY) {
    this._anchorY = value;
    this._emit(LabelChangeType.Layout);
  }

  get padding(): TextPadding {
    return this._padding;
  }

  set padding(value: TextPadding | number | [number, number, number, number]) {
    this._padding = parsePadding(value);
    this._emit(LabelChangeType.Layout);
  }

  get color(): Color {
    return this._color;
  }

  set color(value: string | number | Color | Vector3) {
    this._color = toColor(value);
    this._emit(LabelChangeType.Style);
  }

  get opacity() {
    return this._opacity;
  }

  set opacity(value: number) {
    this._opacity = value;
    this._emit(LabelChangeType.Style);
  }

  get haloColor(): Color {
    return this._haloColor;
  }

  set haloColor(value: string | number | Color | Vector3) {
    this._haloColor = toColor(value);
    this._emit(LabelChangeType.Style);
  }

  get haloWidth() {
    return this._haloWidth;
  }

  set haloWidth(value: number) {
    this._haloWidth = value;
    this._emit(LabelChangeType.Style);
  }

  get haloBlur() {
    return this._haloBlur;
  }

  set haloBlur(value: number) {
    this._haloBlur = value;
    this._emit(LabelChangeType.Style);
  }

  get haloOpacity() {
    return this._haloOpacity;
  }

  set haloOpacity(value: number) {
    this._haloOpacity = value;
    this._emit(LabelChangeType.Style);
  }

  /** @returns Whether the halo has both width and opacity to draw with. */
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
    this._rotationAlignment = value;
    this._emit(LabelChangeType.Style);
  }

  get symbolPlacement() {
    return this._symbolPlacement;
  }

  set symbolPlacement(value: SymbolPlacement) {
    this._symbolPlacement = value;
    this._emit(LabelChangeType.Style);
  }

  /** Both the flag and a non-zero {@link opacity}: a label at 0 reads false. */
  get visible() {
    return this._visible && this._opacity > 0;
  }

  set visible(value: boolean) {
    this._visible = value;
    this._emit(LabelChangeType.Visibility);
  }

  /**
   * Apply several properties with a single change notification.
   *
   * @param options - Properties to change; the rest are left alone.
   *
   * @throws {RangeError} If `fontWeight` is not a CSS weight or a known alias.
   *
   * @returns This label.
   */
  set(options: Partial<LabelOptions>): this {
    this._emit(this._apply(options));
    return this;
  }

  /**
   * Writes `options` onto the label without notifying.
   *
   * @returns What changed.
   */
  private _apply(options: Partial<LabelOptions>): LabelChangeMask {
    let changes: LabelChangeMask = LabelChangeType.None;

    if (options.position !== undefined) {
      this._position = toVector3(options.position);
      changes |= LabelChangeType.Transform;
    }
    if (options.rotation !== undefined) {
      this._rotation = toQuaternion(options.rotation);
      changes |= LabelChangeType.Transform;
    }
    if (options.offset !== undefined) {
      this._offset = toVector2(options.offset);
      changes |= LabelChangeType.Layout;
    }

    // Built in one step, so a multi-property set produces a single key.
    if (options.font !== undefined || options.fontWeight !== undefined || options.fontStyle !== undefined) {
      const parsed = options.font !== undefined ? parseFontDescriptor(options.font) : undefined;
      const next: FontKey = {
        font: parsed?.font ?? this._fontKey.font,
        weight: options.fontWeight !== undefined
          ? normalizeFontWeight(options.fontWeight)
          : parsed?.weight ?? this._fontKey.weight,
        style: options.fontStyle ?? parsed?.style ?? this._fontKey.style,
      };
      const nextStr = fontKeyStr(next);
      if (nextStr !== this._fontKeyStr) {
        this._fontKey = next;
        this._fontKeyStr = nextStr;
        changes |= LabelChangeType.Font;
      }
    }
    if (options.fontSize !== undefined) {
      this._fontSize = options.fontSize;
      changes |= LabelChangeType.Layout;
    }

    if (options.text !== undefined) {
      this._text = options.text;
      changes |= LabelChangeType.Text;
    }
    if (options.textTransform !== undefined) {
      this._textTransform = options.textTransform;
      changes |= LabelChangeType.Text;
    }

    if (options.letterSpacing !== undefined) {
      this._letterSpacing = options.letterSpacing;
      changes |= LabelChangeType.Layout;
    }
    if (options.lineHeight !== undefined) {
      this._lineHeight = options.lineHeight;
      changes |= LabelChangeType.Layout;
    }
    if (options.maxWidth !== undefined) {
      this._maxWidth = options.maxWidth;
      changes |= LabelChangeType.Layout;
    }
    if (options.textAlign !== undefined) {
      this._textAlign = options.textAlign;
      changes |= LabelChangeType.Layout;
    }
    if (options.anchorX !== undefined) {
      this._anchorX = options.anchorX;
      changes |= LabelChangeType.Layout;
    }
    if (options.anchorY !== undefined) {
      this._anchorY = options.anchorY;
      changes |= LabelChangeType.Layout;
    }
    if (options.padding !== undefined) {
      this._padding = parsePadding(options.padding);
      changes |= LabelChangeType.Layout;
    }

    if (options.color !== undefined) {
      this._color = toColor(options.color);
      changes |= LabelChangeType.Style;
    }
    if (options.opacity !== undefined) {
      this._opacity = options.opacity;
      changes |= LabelChangeType.Style;
    }
    if (options.haloColor !== undefined) {
      this._haloColor = toColor(options.haloColor);
      changes |= LabelChangeType.Style;
    }
    if (options.haloWidth !== undefined) {
      this._haloWidth = options.haloWidth;
      changes |= LabelChangeType.Style;
    }
    if (options.haloBlur !== undefined) {
      this._haloBlur = options.haloBlur;
      changes |= LabelChangeType.Style;
    }
    if (options.haloOpacity !== undefined) {
      this._haloOpacity = options.haloOpacity;
      changes |= LabelChangeType.Style;
    }
    if (options.rotationAlignment !== undefined) {
      this._rotationAlignment = options.rotationAlignment;
      changes |= LabelChangeType.Style;
    }
    if (options.symbolPlacement !== undefined) {
      this._symbolPlacement = options.symbolPlacement;
      changes |= LabelChangeType.Style;
    }

    if (options.visible !== undefined) {
      this._visible = options.visible;
      changes |= LabelChangeType.Visibility;
    }

    return changes;
  }

  /**
   * @returns A copy of every option, with a fresh id and no listeners. Layout
   * output is not copied; a manager lays the copy out when it is added.
   */
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
      visible: this._visible,
      textTransform: this._textTransform,
    });
  }

  /**
   * Announces the label is finished, which makes any manager holding it release
   * its slots, then drops every listener. The object itself stays usable.
   */
  dispose() {
    this._emit(LabelChangeType.Dispose);
    this._listeners.clear();
  }

  /**
   * Subscribe to this label's own property changes.
   *
   * @param listener - Called with a {@link LabelChangeType} bitmask.
   *
   * @returns Unsubscribe function.
   */
  onChange(listener: LabelChangeListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /** Notifies listeners of what changed. A `None` mask is dropped. */
  private _emit(changes: LabelChangeMask): void {
    if (changes === LabelChangeType.None) return;
    for (const listener of this._listeners) {
      listener(changes);
    }
  }
}

function parsePadding(value: TextPadding | number | [number, number, number, number]): TextPadding {
  if (Array.isArray(value)) return { top: value[0], right: value[1], bottom: value[2], left: value[3] };
  if (typeof value === 'number') return { top: value, right: value, bottom: value, left: value };
  return { ...value };
}

function toColor(value: string | number | Color | Vector3): Color {
  if (value instanceof Color) return value.clone();
  if (value instanceof Vector3) return new Color(value.x, value.y, value.z);
  return new Color(value);
}

function toVector2(value: [number, number] | Vector2): Vector2 {
  if (value instanceof Vector2) return value.clone();
  return new Vector2(...value);
}

function toVector3(value: [number, number, number] | Vector3): Vector3 {
  if (value instanceof Vector3) return value.clone();
  return new Vector3(...value);
}

function toQuaternion(value: [number, number, number] | Euler | Quaternion): Quaternion {
  if (value instanceof Quaternion) return value.clone();
  if (value instanceof Euler) return new Quaternion().setFromEuler(value);
  return new Quaternion().setFromEuler(new Euler(...value, 'XYZ'));
}
