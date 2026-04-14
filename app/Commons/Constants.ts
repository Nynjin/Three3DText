export const FontPathRegular = {
  sdfPath: "./roboto-regular.png",
  fontPath: "./roboto-regular.fnt",
};

export const TextOptions = [
  "Hello World",
  "Lorem Ipsum",
  "Label",
  "Text",
  "Benchmark",
  "This is a longer text to test wrapping",
  "你好世界",
  "مرحبا بالعالم", // requires Arabic shaping to pick correct glyph forms, otherwise renders isolated letters like ع
  "Здравствуй мир",
  "שלום עולם", // requires bidi reordering to detect direction, otherwise renders in logical order as םלוע םולש
  "こんにちは世界", // some characters are very thin and may require cutoff adjustments
  "안녕하세요 세계",
  // "😀😃😄😁😆😅😂🤣☺️😊", // most emojis do not work
  "Hello بالعالم 你好 мир", // mixed RTL and LTR 
  "Azلعاo世m界", // mixed RTL and CJK with no spaces
  "AVAVAVA" // Kerning
];

export const FrustrumCullRate = 0.01;
