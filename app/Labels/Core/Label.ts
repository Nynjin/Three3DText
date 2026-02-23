import { Color, Euler, Quaternion, Vector2, Vector3 } from "three";
import { toBinary, toColor, toQuaternion, toVector2, toVector3 } from "../Utils/LabelUtils";

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
    Left = 0,
    Center = 1,
    Right = 2,
    Justify = 3,
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
  visible?: boolean | 0 | 1;
  
  // Transform
  textTransform?: TextTransform;
}



export class Label {
  private _listeners = new Set<LabelChangeListener>();

  // Unique id
  id = crypto.randomUUID();

  // Content
  text: string;
  
  // Position & Transform
  position: Vector3;
  rotation: Quaternion;
  offset: Vector2;
  
  // Font
  font: string;
  fontSize: number;
  fontWeight: string;
  letterSpacing: number;
  lineHeight: number;
  
  // Layout
  maxWidth: number;
  textAlign: TextAlign;
  anchorX: TextAnchorX;
  anchorY: TextAnchorY;
  padding: [number, number, number, number];
  
  // Fill
  color: Vector3;
  opacity: number;
  
  // Halo
  haloColor: Vector3;
  haloWidth: number;
  haloBlur: number;
  haloOpacity: number;
  
  // Rendering
  rotationAlignment: RotationAlignment;
  symbolPlacement: SymbolPlacement;
  visible: 0 | 1;
  
  // Transform
  textTransform: TextTransform;
  
  constructor(options: LabelOptions) {
    this.text = options.text;
    
    this.position = options.position ? toVector3(options.position) : new Vector3();
    this.rotation = options.rotation ? toQuaternion(options.rotation) : new Quaternion();
    this.offset = options.offset ? toVector2(options.offset) : new Vector2();
    
    this.font = options.font ?? "sans-serif";
    this.fontSize = options.fontSize ?? 16;
    this.fontWeight = options.fontWeight ?? "normal";
    this.letterSpacing = options.letterSpacing ?? 0;
    this.lineHeight = options.lineHeight ?? 0.5;
    
    this.maxWidth = options.maxWidth ?? Infinity;
    this.textAlign = options.textAlign ?? TextAlign.Center;
    this.anchorX = options.anchorX ?? TextAnchorX.Center;
    this.anchorY = options.anchorY ?? TextAnchorY.Middle;
    this.padding = options.padding ?? [0, 0, 0, 0];
    
    this.color = options.color !== undefined ? toColor(options.color) : new Vector3(0, 0, 0);
    this.opacity = options.opacity ?? 1;
    
    this.haloColor = options.haloColor !== undefined ? toColor(options.haloColor) : new Vector3(1, 1, 1);
    this.haloWidth = options.haloWidth ?? 0;
    this.haloBlur = options.haloBlur ?? 0;
    this.haloOpacity = options.haloOpacity ?? 1;
    
    this.rotationAlignment = options.rotationAlignment ?? RotationAlignment.Map;
    this.symbolPlacement = options.symbolPlacement ?? SymbolPlacement.Point;
    this.visible = options.visible !== undefined ? toBinary(options.visible) : 1;
    
    this.textTransform = options.textTransform ?? TextTransform.None;
  }
  
  /** Get transformed text based on textTransform property */
  getDisplayText(): string {
    switch (this.textTransform) {
      case TextTransform.Uppercase: return this.text.toUpperCase();
      case TextTransform.Lowercase: return this.text.toLowerCase();
      case TextTransform.Capitalize: return this.text.replace(/\b\w/g, c => c.toUpperCase());
      default: return this.text;
    }
  }
  
  /** Check if halo should be rendered */
  hasHalo(): boolean {
    return this.haloWidth > 0 && this.haloOpacity > 0;
  }
  
  /** Update multiple properties at once */
  set(options: Partial<LabelOptions>): this {
    let changes = LabelChangeType.None;

    // Special transformations for complex types
    if (options.position !== undefined) {
      this.position = toVector3(options.position);
      changes |= LabelChangeType.Transform;
    }
    if (options.rotation !== undefined) {
      this.rotation = toQuaternion(options.rotation);
      changes |= LabelChangeType.Transform;
    }
    if (options.offset !== undefined) {
      this.offset = toVector2(options.offset);
      changes |= LabelChangeType.Layout;
    }
    if (options.color !== undefined) {
      this.color = toColor(options.color);
      changes |= LabelChangeType.Style;
    }
    if (options.haloColor !== undefined) {
      this.haloColor = toColor(options.haloColor);
      changes |= LabelChangeType.Style;
    }

    // Font properties
    if (options.font !== undefined) {
      this.font = options.font;
      changes |= LabelChangeType.Font;
    }
    if (options.fontSize !== undefined) {
      this.fontSize = options.fontSize;
      changes |= LabelChangeType.Font;
    }
    if (options.fontWeight !== undefined) {
      this.fontWeight = options.fontWeight;
      changes |= LabelChangeType.Font;
    }
    
    // Text content properties
    if (options.text !== undefined) {
      this.text = options.text;
      changes |= LabelChangeType.Text;
    }
    if (options.textTransform !== undefined) {
      this.textTransform = options.textTransform;
      changes |= LabelChangeType.Text;
    }

    // Text layout properties
    if (options.letterSpacing !== undefined) {
      this.letterSpacing = options.letterSpacing;
      changes |= LabelChangeType.Layout;
    }
    if (options.lineHeight !== undefined) {
      this.lineHeight = options.lineHeight;
      changes |= LabelChangeType.Layout;
    }
    if (options.maxWidth !== undefined) {
      this.maxWidth = options.maxWidth;
      changes |= LabelChangeType.Layout;
    }
    if (options.textAlign !== undefined) {
      this.textAlign = options.textAlign;
      changes |= LabelChangeType.Layout;
    }
    if (options.anchorX !== undefined) {
      this.anchorX = options.anchorX;
      changes |= LabelChangeType.Layout;
    }
    if (options.anchorY !== undefined) {
      this.anchorY = options.anchorY;
      changes |= LabelChangeType.Layout;
    }
    if (options.padding !== undefined) {
      this.padding = options.padding;
      changes |= LabelChangeType.Layout;
    }

    // Style properties
    if (options.opacity !== undefined) {
      this.opacity = options.opacity;
      changes |= LabelChangeType.Style;
    }
    if (options.haloWidth !== undefined) {
      if (options.haloWidth > this.fontSize / 4) {
        console.warn(`haloWidth of ${options.haloWidth} is too large for fontSize ${this.fontSize}. Clamping to ${this.fontSize / 4}.`);
        this.haloWidth = this.fontSize / 4;
      } else {
        this.haloWidth = options.haloWidth;
      }
      changes |= LabelChangeType.Style;
    }
    if (options.haloBlur !== undefined) {
      if (options.haloBlur > this.fontSize / 4) {
        console.warn(`haloBlur of ${options.haloBlur} is too large for fontSize ${this.fontSize}. Clamping to ${this.fontSize / 4}.`);
        this.haloBlur = this.fontSize / 4;
      } else {
        this.haloBlur = options.haloBlur;
      }
      changes |= LabelChangeType.Style;
    }
    if (options.haloOpacity !== undefined) {
      this.haloOpacity = options.haloOpacity;
      changes |= LabelChangeType.Style;
    }
    if (options.rotationAlignment !== undefined) {
      this.rotationAlignment = options.rotationAlignment;
      changes |= LabelChangeType.Style;
    }
    if (options.symbolPlacement !== undefined) {
      this.symbolPlacement = options.symbolPlacement;
      changes |= LabelChangeType.Style;
    }

    // Visibility
    if (options.visible !== undefined) {
      this.visible = toBinary(options.visible);
      changes |= LabelChangeType.Visibility;
    }

    this._emit(changes);
    return this;
  }

  clone(): Label {
    return new Label({
      text: this.text,
      position: this.position.clone(),
      rotation: this.rotation.clone(),
      offset: this.offset.clone(),
      font: this.font,
      fontSize: this.fontSize,
      fontWeight: this.fontWeight,
      letterSpacing: this.letterSpacing,
      lineHeight: this.lineHeight,
      maxWidth: this.maxWidth,
      textAlign: this.textAlign,
      anchorX: this.anchorX,
      anchorY: this.anchorY,
      padding: [...this.padding],
      color: this.color.clone(),
      opacity: this.opacity,
      haloColor: this.haloColor.clone(),
      haloWidth: this.haloWidth,
      haloBlur: this.haloBlur,
      haloOpacity: this.haloOpacity,
      rotationAlignment: this.rotationAlignment,
      symbolPlacement: this.symbolPlacement,
      visible: this.visible,
      textTransform: this.textTransform,
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
