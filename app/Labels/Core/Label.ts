import { Color, Euler, Vector2, Vector3 } from "three";

export type TextAnchorX = "left" | "center" | "right";
export type TextAnchorY = "top" | "middle" | "bottom" | "baseline";
export type TextAlign = "left" | "center" | "right" | "justify";
export type TextTransform = "none" | "uppercase" | "lowercase" | "capitalize";

export enum RotationAlignment {
    Map = 0,
    Viewport = 1,
}

export enum SymbolPlacement {
    Point = 0,
    Line = 1,
    "Line-Center" = 2,
}

export interface LabelOptions {
  // Content
  text: string;
  
  // Position & Transform
  position?: [number, number, number] | Vector3;
  rotation?: [number, number, number] | Euler;
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
  color?: string | number | Color;
  opacity?: number;
  
  // Halo
  haloColor?: string | number | Color;
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

function toColor(value: string | number | Color): Color {
  if (value instanceof Color) return value.clone();
  return new Color(value);
}

function toVector3(value: [number, number, number] | Vector3): Vector3 {
  if (value instanceof Vector3) return value.clone();
  return new Vector3(...value);
}

function toEuler(value: [number, number, number] | Euler): Euler {
  if (value instanceof Euler) return value.clone();
  return new Euler(...value, "XYZ");
}

function toVector2(value: [number, number] | Vector2): Vector2 {
  if (value instanceof Vector2) return value.clone();
  return new Vector2(...value);
}

export class Label {
  // Content
  text: string;
  
  // Position & Transform
  position: Vector3;
  rotation: Euler;
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
  color: Color;
  opacity: number;
  
  // Halo
  haloColor: Color;
  haloWidth: number;
  haloBlur: number;
  haloOpacity: number;
  
  // Rendering
  rotationAlignment: RotationAlignment;
  symbolPlacement: SymbolPlacement;
  visible: boolean;
  
  // Transform
  textTransform: TextTransform;
  
  constructor(options: LabelOptions) {
    this.text = options.text;
    
    this.position = options.position ? toVector3(options.position) : new Vector3();
    this.rotation = options.rotation ? toEuler(options.rotation) : new Euler();
    this.offset = options.offset ? toVector2(options.offset) : new Vector2();
    
    this.font = options.font ?? "sans-serif";
    this.fontSize = options.fontSize ?? 16;
    this.fontWeight = options.fontWeight ?? "normal";
    this.letterSpacing = options.letterSpacing ?? 0;
    this.lineHeight = options.lineHeight ?? 0.5;
    
    this.maxWidth = options.maxWidth ?? Infinity;
    this.textAlign = options.textAlign ?? "center";
    this.anchorX = options.anchorX ?? "center";
    this.anchorY = options.anchorY ?? "middle";
    this.padding = options.padding ?? [0, 0, 0, 0];
    
    this.color = options.color !== undefined ? toColor(options.color) : new Color(0x000000);
    this.opacity = options.opacity ?? 1;
    
    this.haloColor = options.haloColor !== undefined ? toColor(options.haloColor) : new Color(0xffffff);
    this.haloWidth = options.haloWidth ?? 0;
    this.haloBlur = options.haloBlur ?? 0;
    this.haloOpacity = options.haloOpacity ?? 1;
    
    this.rotationAlignment = options.rotationAlignment ?? RotationAlignment.Map;
    this.symbolPlacement = options.symbolPlacement ?? SymbolPlacement.Point;
    this.visible = options.visible ?? true;
    
    this.textTransform = options.textTransform ?? "none";
  }
  
  /** Get transformed text based on textTransform property */
  getDisplayText(): string {
    switch (this.textTransform) {
      case "uppercase": return this.text.toUpperCase();
      case "lowercase": return this.text.toLowerCase();
      case "capitalize": return this.text.replace(/\b\w/g, c => c.toUpperCase());
      default: return this.text;
    }
  }
  
  /** Check if halo should be rendered */
  hasHalo(): boolean {
    return this.haloWidth > 0 && this.haloOpacity > 0;
  }
  
  /** Update multiple properties at once */
  set(options: Partial<LabelOptions>): this {
    if (options.text !== undefined) this.text = options.text;
    if (options.position !== undefined) this.position = toVector3(options.position);
    if (options.rotation !== undefined) this.rotation = toEuler(options.rotation);
    if (options.offset !== undefined) this.offset = toVector2(options.offset);
    if (options.font !== undefined) this.font = options.font;
    if (options.fontSize !== undefined) this.fontSize = options.fontSize;
    if (options.fontWeight !== undefined) this.fontWeight = options.fontWeight;
    if (options.letterSpacing !== undefined) this.letterSpacing = options.letterSpacing;
    if (options.lineHeight !== undefined) this.lineHeight = options.lineHeight;
    if (options.maxWidth !== undefined) this.maxWidth = options.maxWidth;
    if (options.textAlign !== undefined) this.textAlign = options.textAlign;
    if (options.anchorX !== undefined) this.anchorX = options.anchorX;
    if (options.anchorY !== undefined) this.anchorY = options.anchorY;
    if (options.padding !== undefined) this.padding = options.padding;
    if (options.color !== undefined) this.color = toColor(options.color);
    if (options.opacity !== undefined) this.opacity = options.opacity;
    if (options.haloColor !== undefined) this.haloColor = toColor(options.haloColor);
    if (options.haloWidth !== undefined) this.haloWidth = options.haloWidth;
    if (options.haloBlur !== undefined) this.haloBlur = options.haloBlur;
    if (options.haloOpacity !== undefined) this.haloOpacity = options.haloOpacity;
    if (options.rotationAlignment !== undefined) this.rotationAlignment = options.rotationAlignment;
    if (options.symbolPlacement !== undefined) this.symbolPlacement = options.symbolPlacement;
    if (options.visible !== undefined) this.visible = options.visible;
    if (options.textTransform !== undefined) this.textTransform = options.textTransform;
    return this;
  }
}
