import { type Label, TextAlign } from '../Label';

/** One visual line, after bidi reordering and trimming. */
interface Line {
  text: string;
  /** Advance width, in CSS px. */
  width: number;
  /** Paragraph reads right to left. */
  isRTL: boolean;
  /** Last line of its paragraph: ended by a line break or the end of the text. */
  endsParagraph: boolean;
}

/**
 * Horizontal placement of one line within the widest line. CSS px.
 *
 * @param label - Reads `textAlign`.
 * @param line - Its direction resolves {@link TextAlign.Auto} and the side a
 * justified paragraph's last line sits on.
 * @param contentMaxWidth - Width of the label's widest line.
 *
 * @returns `alignOffsetX`: pen start. `extraSpacePerWordGap`: added at each
 * space when justifying.
 */
export default function textAlign(
  label: Label,
  line: Line,
  contentMaxWidth: number,
) {
  let alignOffsetX = 0;
  let extraSpacePerWordGap = 0;

  let align = label.textAlign;

  if (align === TextAlign.Auto) {
    align = line.isRTL ? TextAlign.Right : TextAlign.Left;
  }

  switch (align) {
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
      // Not stretched, start side: a paragraph's last line (ended by a line
      // break or the end of the text) and a line with no space to widen.
      const spaceCount = line.text.split(' ').length - 1;
      if (line.endsParagraph || spaceCount === 0) {
        alignOffsetX = line.isRTL ? contentMaxWidth - line.width : 0;
      } else {
        extraSpacePerWordGap = (contentMaxWidth - line.width) / spaceCount;
      }
      break;
    }
  }

  return { alignOffsetX, extraSpacePerWordGap };
}
