/**
 * Per-label style, drawn once so every renderer draws the same label.
 *
 * Sizes are in CSS px, as the instanced renderer draws them. Troika, UIKit and
 * CSS3D scale their own base size by `fontSizePx / BASE_FONT_SIZE_PX`, so the
 * relative spread of sizes carries over.
 *
 * Not every renderer can honour every field: Troika and UIKit load their own
 * font assets and cannot resolve a system family by name.
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
