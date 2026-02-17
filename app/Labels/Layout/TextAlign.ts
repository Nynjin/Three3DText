import { Label, TextAlign } from "../Core/Label";

interface Line {
    idx: number;
    text: string;
    width: number;
    count: number;
}

export default function textAlign(label: Label, line: Line, contentMaxWidth: number) {
    let alignOffsetX = 0;
    let extraSpacePerWordGap = 0;

    switch (label.textAlign) {
      case TextAlign.Left:
        alignOffsetX = 0;
        break;
      case TextAlign.Center:
        alignOffsetX = (contentMaxWidth - line.width) / 2;
        break;
      case TextAlign.Right:
        alignOffsetX = contentMaxWidth - line.width;
        break;
      case TextAlign.Justify: {
        // Justify all lines except the last one
        if (line.idx === line.count - 1 || contentMaxWidth === 0) {
          alignOffsetX = 0; // Last line stays left-aligned
        } else {
          // Count spaces in the line
          const spaceCount = line.text.split(" ").length - 1;
          if (spaceCount > 0) {
            // Distribute extra space evenly across word gaps
            const extraSpace = contentMaxWidth - line.width;
            extraSpacePerWordGap = extraSpace / spaceCount;
          }
        }
        break;
      }
    }

    return { alignOffsetX, extraSpacePerWordGap };
}