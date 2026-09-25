/**
 * Per-label style, drawn once so every renderer draws the same label. Sizes
 * are in CSS px.
 */
export type ItemStyle = {
  fontFamily: string;
  fontWeight: 400 | 600 | 700;
  fontStyle: 'normal' | 'italic';
  fontSizePx: number;
  fillColor: string;
  haloColor: string;
};

export type Item = {
  key: number;
  text: string;
  position: [number, number, number];
  rotation: [number, number, number];
  style: ItemStyle;
};
