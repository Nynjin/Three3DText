import { Color, Euler, Quaternion, Vector2, Vector3 } from "three";
import {
  toColor,
  toQuaternion,
  toVector2,
  toVector3,
} from "../Utils/LabelUtils";

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
  "Line-Center" = 2,
}

// TODO : there aren't cases that require masking yet
export enum LabelChangeType {
  None = 0,
  Font = 1 << 0,
  Text = 1 << 1,
  Layout = 1 << 2,
  Style = 1 << 3,
  Transform = 1 << 4,
  Visibility = 1 << 5,
  Dispose = 1 << 6,
}

export type LabelChangeListener = (changes: LabelChangeType) => void;

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
  fontWeight?: string;
  letterSpacing?: number;
  lineHeight?: number;

  // Layout
  maxWidth?: number;
  textAlign?: TextAlign;
  anchorX?: TextAnchorX;
  anchorY?: TextAnchorY;
  padding?: [number, number, number, number]; // top, right, bottom, left

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
}

export class Label {
  private _listeners = new Set<LabelChangeListener>();

  // Unique id
  private _id: string;

  // Content
  private _text: string;
  private _textTransform: TextTransform;

  // Position & Transform
  private _position: Vector3;
  private _rotation: Quaternion;
  private _offset: Vector2;

  // Font
  private _font: string;
  private _fontSize: number;
  private _fontWeight: string;
  private _letterSpacing: number;
  private _lineHeight: number;

  // Layout
  private _maxWidth: number;
  private _textAlign: TextAlign;
  private _anchorX: TextAnchorX;
  private _anchorY: TextAnchorY;
  private _padding: [number, number, number, number];

  // Fill
  private _color: Color;
  private _opacity: number;

  // Halo
  private _haloColor: Color;
  private _haloWidth: number;
  private _haloBlur: number;
  private _haloOpacity: number;

  // Rendering
  private _rotationAlignment: RotationAlignment;
  private _symbolPlacement: SymbolPlacement;

  // Visibility
  private _visible: boolean;

  get id() {
    return this._id;
  }
  set id(_) {
    console.warn("Label.id is read-only.");
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

  get font() {
    return this._font;
  }
  set font(value: string) {
    this._font = value;
    this._emit(LabelChangeType.Font);
  }

  get fontSize() {
    return this._fontSize;
  }
  set fontSize(value: number) {
    this._fontSize = value;
    this._emit(LabelChangeType.Font);
  }

  get fontWeight() {
    return this._fontWeight;
  }
  set fontWeight(value: string) {
    this._fontWeight = value;
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

  get padding() {
    return this._padding;
  }
  set padding(value: [number, number, number, number]) {
    this._padding = value;
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
    this._haloWidth = this._clampHaloWidth(value);
    this._emit(LabelChangeType.Style);
  }

  get haloBlur() {
    return this._haloBlur;
  }
  set haloBlur(value: number) {
    this._haloBlur = this._clampHaloBlur(value);
    this._emit(LabelChangeType.Style);
  }

  get haloOpacity() {
    return this._haloOpacity;
  }
  set haloOpacity(value: number) {
    this._haloOpacity = value;
    this._emit(LabelChangeType.Style);
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

  constructor(options: LabelOptions) {
    this._id = crypto.randomUUID();

    this._text = options.text;

    this._position = options.position
      ? toVector3(options.position)
      : new Vector3();
    this._rotation = options.rotation
      ? toQuaternion(options.rotation)
      : new Quaternion();
    this._offset = options.offset ? toVector2(options.offset) : new Vector2();

    this._font = options.font ?? "sans-serif";
    this._fontSize = options.fontSize ?? 16;
    this._fontWeight = options.fontWeight ?? "normal";
    this._letterSpacing = options.letterSpacing ?? 0;
    this._lineHeight = options.lineHeight ?? 0.5;

    this._maxWidth = options.maxWidth ?? 10;
    this._textAlign = options.textAlign ?? TextAlign.Center;
    this._anchorX = options.anchorX ?? TextAnchorX.Center;
    this._anchorY = options.anchorY ?? TextAnchorY.Middle;
    this._padding = options.padding ?? [0, 0, 0, 0];

    this._color =
      options.color !== undefined ? toColor(options.color) : new Color(0, 0, 0);
    this._opacity = options.opacity ?? 1;

    this._haloColor =
      options.haloColor !== undefined
        ? toColor(options.haloColor)
        : new Color(1, 1, 1);
    this._haloWidth = this._clampHaloWidth(options.haloWidth ?? 0);
    this._haloBlur = this._clampHaloBlur(options.haloBlur ?? 0);
    this._haloOpacity = options.haloOpacity ?? 1;

    this._rotationAlignment =
      options.rotationAlignment ?? RotationAlignment.Map;
    this._symbolPlacement = options.symbolPlacement ?? SymbolPlacement.Point;
    this._visible = options.visible !== undefined ? options.visible : true;

    this._textTransform = options.textTransform ?? TextTransform.None;
  }

  _clampHaloWidth(value: number): number {
    if (value > this._fontSize * 4) {
      console.warn(
        `Label.haloWidth ${value} is too large for fontSize ${this._fontSize}. Clamping to ${this._fontSize * 4}.`,
      );
      return this._fontSize * 4;
    }
    return value;
  }

  _clampHaloBlur(value: number): number {
    if (value > this._fontSize * 4) {
      console.warn(
        `Label.haloBlur ${value} is too large for fontSize ${this._fontSize}. Clamping to ${this._fontSize * 4}.`,
      );
      return this._fontSize * 4;
    }
    return value;
  }

  /** Get transformed text based on textTransform property */
  getDisplayText(): string {
    switch (this._textTransform) {
      case TextTransform.Uppercase:
        return this._text.toUpperCase();
      case TextTransform.Lowercase:
        return this._text.toLowerCase();
      case TextTransform.Capitalize:
        return this._text.replace(/\b\w/g, (c) => c.toUpperCase());
      default:
        return this._text;
    }
  }

  /** Check if halo should be rendered */
  hasHalo(): boolean {
    return this._haloWidth > 0 && this._haloOpacity > 0;
  }

  /** Update multiple properties at once */
  set(options: Partial<LabelOptions>): this {
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

    // Font properties
    if (options.font !== undefined) {
      this._font = options.font;
      changes |= LabelChangeType.Font;
    }
    if (options.fontSize !== undefined) {
      this._fontSize = options.fontSize;
      changes |= LabelChangeType.Font;
    }
    if (options.fontWeight !== undefined) {
      this._fontWeight = options.fontWeight;
      changes |= LabelChangeType.Font;
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
      this._padding = options.padding;
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
      this._haloWidth = this._clampHaloWidth(options.haloWidth);
      changes |= LabelChangeType.Style;
    }
    if (options.haloBlur !== undefined) {
      this._haloBlur = this._clampHaloBlur(options.haloBlur);
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

    this._emit(changes);
    return this;
  }

  clone(): Label {
    return new Label({
      text: this._text,
      position: this._position.clone(),
      rotation: this._rotation.clone(),
      offset: this._offset.clone(),
      font: this._font,
      fontSize: this._fontSize,
      fontWeight: this._fontWeight,
      letterSpacing: this._letterSpacing,
      lineHeight: this._lineHeight,
      maxWidth: this._maxWidth,
      textAlign: this._textAlign,
      anchorX: this._anchorX,
      anchorY: this._anchorY,
      padding: [...this._padding],
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
    });
  }

  dispose() {
    this._emit(LabelChangeType.Dispose);
    this._listeners.clear();
  }

  onChange(listener: LabelChangeListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _emit(changes: LabelChangeType): void {
    if (changes === LabelChangeType.None) return;
    for (const listener of this._listeners) {
      listener(changes);
    }
  }
}
