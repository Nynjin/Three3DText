import { Color, Euler, Quaternion, Vector2, Vector3 } from 'three';
import type { GlyphInstance } from './Shaping/GlyphRun';
import { DEFAULT_FONT_KEY, fontKeyStr, normalizeFontWeight, type FontKey, type FontStyle, type FontWeight, type FontWeightName } from './Shaping/FontKey';

export enum TextAnchorX {
  Left = 0,
  Center = 1,
  Right = 2,
}

export enum TextAnchorY {
  Top = 0,
  Middle = 1,
  Bottom = 2,
  Baseline = 3,
}

export enum TextAlign {
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
  Map = 0,
  Viewport = 1,
}

export enum SymbolPlacement {
  Point = 0,
  Line = 1,
  'Line-Center' = 2,
}

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

export interface TextPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LabelBounds {
  width: number;
  height: number;
}

export type LabelChangeListener = (changes: LabelChangeMask) => void;

export interface LabelOptions {
  // Content
  text: string;

  // Position & Transform
  position?: [number, number, number] | Vector3;
  rotation?: [number, number, number] | Euler | Quaternion;
  offset?: [number, number] | Vector2;

  // Font
  font?: string;
  fontSize?: number;
  fontWeight?: FontWeight | FontWeightName;
  fontStyle?: FontStyle;
  letterSpacing?: number;
  lineHeight?: number;

  // Layout
  maxWidth?: number;
  textAlign?: TextAlign;
  anchorX?: TextAnchorX;
  anchorY?: TextAnchorY;
  padding?: TextPadding | number | [number, number, number, number]; // top, right, bottom, left

  // Fill
  color?: string | number | Color | Vector3;
  opacity?: number;

  // Halo
  haloColor?: string | number | Color | Vector3;
  haloWidth?: number;
  haloBlur?: number;
  haloOpacity?: number;

  // Rendering
  rotationAlignment?: RotationAlignment;
  symbolPlacement?: SymbolPlacement;
  visible?: boolean;

  // Transform
  textTransform?: TextTransform;

  // Bounds in label-local space
  bounds?: LabelBounds;

  // GLyphs
  glyphs?: GlyphInstance[];
}

export class Label {
  private _listeners = new Set<LabelChangeListener>();

  // Unique id
  private readonly _id: string;

  // Content
  private _text: string = '';
  private _textTransform: TextTransform = TextTransform.None;

  // Position & Transform
  private _position: Vector3 = new Vector3();
  private _rotation: Quaternion = new Quaternion();
  private _offset: Vector2 = new Vector2();

  // Font
  private _fontKey: FontKey = DEFAULT_FONT_KEY;
  private _fontKeyStr: string = fontKeyStr(DEFAULT_FONT_KEY);
  private _fontSize = 20;
  private _letterSpacing = 0;
  private _lineHeight = 1.2;

  // Layout
  private _maxWidth = Infinity;
  private _textAlign = TextAlign.Auto;
  private _anchorX = TextAnchorX.Left;
  private _anchorY = TextAnchorY.Top;
  private _padding: TextPadding = { top: 20, right: 20, bottom: 20, left: 20 };

  // Fill
  private _color: Color = new Color();
  private _opacity: number = 1;

  // Halo
  private _haloColor: Color = new Color();
  private _haloWidth: number = 0;
  private _haloBlur: number = 0;
  private _haloOpacity: number = 1;

  // Rendering
  private _rotationAlignment: RotationAlignment = RotationAlignment.Map;
  private _symbolPlacement: SymbolPlacement = SymbolPlacement.Point;

  // Visibility
  private _visible: boolean = true;

  // Occlusion & Render
  occlusionFade: number = 1;
  shouldRender: boolean = false;
  bounds: LabelBounds = { width: 0, height: 0 };

  // Glyphs
  glyphs: GlyphInstance[] = [];

  constructor(options: LabelOptions) {
    this._id = crypto.randomUUID();
    this.set(options, true);
  }

  get id() {
    return this._id;
  }

  // Text properties
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

  /** Get transformed text based on textTransform property */
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

  // Transform properties
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

  // Font properties

  /** The label's font identity, shared by reference — never mutate it. */
  get fontKey(): FontKey {
    return this._fontKey;
  }

  /** Cached identity of {@link fontKey}, for grouping labels by font. */
  get fontKeyStr(): string {
    return this._fontKeyStr;
  }

  get font() {
    return this._fontKey.font;
  }

  set font(value: string) {
    this._setFontKey({ ...this._fontKey, font: value });
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

  /** Accepts an alias name; always reads back as the canonical weight. */
  set fontWeight(value: FontWeight | FontWeightName) {
    this._setFontKey({ ...this._fontKey, weight: normalizeFontWeight(value) });
  }

  get fontStyle() {
    return this._fontKey.style;
  }

  set fontStyle(value: FontStyle) {
    this._setFontKey({ ...this._fontKey, style: value });
  }

  /**
   * Replaces the font key, keeping its cached identity in sync. A no-op set is
   * dropped here so it can't evict the label from its font group.
   */
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
    this._padding = this._parsePadding(value);
    this._emit(LabelChangeType.Layout);
  }

  /**
   * Normalizes the shorthand padding forms to a {@link TextPadding}.
   *
   * @param value - One number for all sides, a `[top, right, bottom, left]`
   * tuple, or an already-complete object.
   *
   * @returns The padding as an object. An object argument is returned as given,
   * not copied.
   */
  private _parsePadding(value: TextPadding | number | [number, number, number, number]): TextPadding {
    if (Array.isArray(value)) return { top: value[0], right: value[1], bottom: value[2], left: value[3] };
    if (typeof value === 'number') return { top: value, right: value, bottom: value, left: value };
    return value;
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
    this._haloWidth = this._clampHalo('haloWidth', value);
    this._emit(LabelChangeType.Style);
  }

  get haloBlur() {
    return this._haloBlur;
  }

  set haloBlur(value: number) {
    this._haloBlur = this._clampHalo('haloBlur', value);
    this._emit(LabelChangeType.Style);
  }

  get haloOpacity() {
    return this._haloOpacity;
  }

  set haloOpacity(value: number) {
    this._haloOpacity = value;
    this._emit(LabelChangeType.Style);
  }

  /** Check if halo should be rendered */
  hasHalo(): boolean {
    return this._haloWidth > 0 && this._haloOpacity > 0;
  }

  /** Get displayed halo opacity, affected by entire label opacity */
  getDisplayedHaloOpacity(): number {
    if (!this.hasHalo()) return 0;
    return this._haloOpacity * this._opacity;
  }

  /**
   * Caps a halo dimension at four times the font size, warning when it does.
   * Wider than that and the SDF has no range left to encode the falloff.
   *
   * @param property - Property name, for the warning only.
   * @param value - Requested value, in the same units as `fontSize`.
   *
   * @returns `value`, or the cap when it exceeds it.
   */
  private _clampHalo(property: 'haloWidth' | 'haloBlur', value: number): number {
    const max = this._fontSize * 4;
    if (value <= max) return value;

    console.warn(
      `Label.${property} ${value} is too large for fontSize ${this._fontSize}. Clamping to ${max}.`,
    );
    return max;
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

  get visible() {
    return this._visible && this._opacity > 0;
  }

  set visible(value: boolean) {
    this._visible = value;
    this._emit(LabelChangeType.Visibility);
  }

  /** Update multiple properties at once */
  set(options: Partial<LabelOptions>, silent = false): this {
    let changes = LabelChangeType.None;

    // Transform properties
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

    // Font properties — built in one pass so a multi-property set produces a
    // single key, not one per property.
    if (options.font !== undefined || options.fontWeight !== undefined || options.fontStyle !== undefined) {
      const next: FontKey = {
        font: options.font ?? this._fontKey.font,
        weight: options.fontWeight !== undefined ? normalizeFontWeight(options.fontWeight) : this._fontKey.weight,
        style: options.fontStyle ?? this._fontKey.style,
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

    // Text content properties
    if (options.text !== undefined) {
      this._text = options.text;
      changes |= LabelChangeType.Text;
    }
    if (options.textTransform !== undefined) {
      this._textTransform = options.textTransform;
      changes |= LabelChangeType.Text;
    }

    // Text layout properties
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
      this._padding = this._parsePadding(options.padding);
      changes |= LabelChangeType.Layout;
    }

    // Style properties
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
      this._haloWidth = this._clampHalo('haloWidth', options.haloWidth);
      changes |= LabelChangeType.Style;
    }
    if (options.haloBlur !== undefined) {
      this._haloBlur = this._clampHalo('haloBlur', options.haloBlur);
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

    // Visibility
    if (options.visible !== undefined) {
      this._visible = options.visible;
      changes |= LabelChangeType.Visibility;
    }

    if (options.bounds !== undefined) {
      this.bounds = options.bounds;
      changes |= LabelChangeType.Style;
    }

    if (options.glyphs !== undefined) {
      this.glyphs = options.glyphs;
      changes |= LabelChangeType.Style;
    }

    if (!silent) {
      this._emit(changes);
    }

    return this;
  }

  /**
   * @returns An independent copy, including its current bounds and glyphs, with
   * a fresh id and no listeners.
   */
  clone(): Label {
    return new Label({
      text: this._text,
      position: this._position.clone(),
      rotation: this._rotation.clone(),
      offset: this._offset.clone(),
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
      padding: { ...this._padding },
      color: this._color.clone(),
      opacity: this._opacity,
      haloColor: this._haloColor.clone(),
      haloWidth: this._haloWidth,
      haloBlur: this._haloBlur,
      haloOpacity: this._haloOpacity,
      rotationAlignment: this._rotationAlignment,
      symbolPlacement: this._symbolPlacement,
      visible: this._visible,
      textTransform: this._textTransform,
      bounds: { ...this.bounds },
      glyphs: this.glyphs.map(g => ({
        glyph: { ...g.glyph },
        offset: g.offset.clone(),
        rotation: g.rotation ? g.rotation.clone() : undefined,
      })),
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

  /**
   * Notifies listeners of what changed. A `None` mask is dropped, so setters
   * can emit unconditionally.
   *
   * @param changes - Bitmask of {@link LabelChangeType}.
   */
  private _emit(changes: LabelChangeMask): void {
    if (changes === LabelChangeType.None) return;
    for (const listener of this._listeners) {
      listener(changes);
    }
  }
}

// Utils

function toColor(value: string | number | Color | Vector3): Color {
  if (value instanceof Color) return value.clone();
  if (value instanceof Vector3) return new Color(value.x, value.y, value.z);
  return new Color(value);
}

function toVector2(value: [number, number] | Vector2): Vector2 {
  if (value instanceof Vector2) return value.clone();
  return new Vector2(...value);
}

function toVector3(
  value: [number, number, number] | Vector3 | Color,
): Vector3 {
  if (value instanceof Vector3) return value.clone();
  if (value instanceof Color) return new Vector3(value.r, value.g, value.b);
  return new Vector3(...value);
}

function toQuaternion(
  value: [number, number, number] | Euler | Quaternion,
): Quaternion {
  if (value instanceof Quaternion) return value.clone();
  if (value instanceof Euler) return new Quaternion().setFromEuler(value);
  return new Quaternion().setFromEuler(new Euler(...value, 'XYZ'));
}
