import { Label } from "../Core/Label";
import { GlyphInfo } from "../Font/SDFAtlas";

export default function lineBreak(
  label: Label,
  glyphs: Map<string, GlyphInfo>,
  pxPerUnit: number
) {
  const lines: string[] = [];
  const text = label.getDisplayText();
  const fallback = glyphs.get("?")!;

  if (label.maxWidth < Infinity) {
    const words = text.split(/\s+/);
    let currentLine = "";
    let currentWidth = 0;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!word) continue;

      // Calculate word width including trailing space
      let wordWidth = 0;
      for (let j = 0; j < word.length; j++) {
        const c = word[j];
        wordWidth += (glyphs.get(c) || fallback).advance;
        if (j < word.length - 1) {
          wordWidth += label.letterSpacing * pxPerUnit;
        }
      }

      // Add space width if not last word
      const spaceWidth =
        i < words.length - 1 ? (glyphs.get(" ") || fallback).advance : 0;
      const totalWordWidth = wordWidth + spaceWidth;

      // Check if the word fits on the current line
      if (
        currentWidth + totalWordWidth > label.maxWidth * pxPerUnit &&
        currentLine
      ) {
        // Push the current line and start a new one
        lines.push(currentLine.trim());
        currentLine = word;
        currentWidth = wordWidth;
      } else if (wordWidth > label.maxWidth * pxPerUnit) {
        // If the word itself is longer than maxWidth, place it on its own line
        if (currentLine) {
          lines.push(currentLine.trim());
        }
        lines.push(word);
        currentLine = "";
        currentWidth = 0;
      } else {
        // Add the word to the current line
        if (currentLine) currentLine += " ";
        currentLine += word;
        currentWidth += totalWordWidth;
      }
    }

    if (currentLine) lines.push(currentLine);
  } else {
    lines.push(text);
  }

  if (lines.length === 0) lines.push("");

  return lines;
}
