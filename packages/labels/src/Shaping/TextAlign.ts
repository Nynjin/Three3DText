import { type Label, TextAlign } from '../Label';

/** One laid-out visual line, after bidi reordering and trimming. */
interface Line {
  text: string;
  /** Advance width, in CSS px. */
  width: number;
  /** The line's paragraph reads right to left. */
  isRTL: boolean;
  /** The line is the last of its paragraph: it ends in a line break or ends the text. */
  endsParagraph: boolean;
}

/**
 * Horizontal placement for one line within the width of the label's widest line.
 *
 * @param label - Label whose `textAlign` is read.
 * @param line - The line being placed. Its direction resolves {@link TextAlign.Auto},
 * and the side a justified paragraph's last line sits on.
 * @param contentMaxWidth - Width of the widest line in the label.
 *
 * @returns `alignOffsetX`, the pen start for the line, and
 * `extraSpacePerWordGap`, added at every space when justifying.
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
      // A paragraph's last line, which a line break ends, and a line with no
      // space to widen are not stretched; they sit on the paragraph's start side.
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
