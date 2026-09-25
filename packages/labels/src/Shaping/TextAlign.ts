import { type Label, TextAlign } from '../Label';

/** One laid-out visual line, after bidi reordering and trimming. */
interface Line {
  /** Position in the paragraph, from 0. */
  idx: number;
  text: string;
  /** Advance width, in CSS px. */
  width: number;
  /** Lines in the paragraph. */
  count: number;
}

/**
 * Horizontal placement for one line within the paragraph's width.
 *
 * @param label - Label whose `textAlign` is read.
 * @param line - The line being placed.
 * @param contentMaxWidth - Width of the widest line in the paragraph.
 * @param paragraphIsRTL - Resolves {@link TextAlign.Auto}, and the side a
 * justified paragraph's last line sits on.
 *
 * @returns `alignOffsetX`, the pen start for the line, and
 * `extraSpacePerWordGap`, added at every space when justifying.
 */
export default function textAlign(
  label: Label,
  line: Line,
  contentMaxWidth: number,
  paragraphIsRTL: boolean,
) {
  let alignOffsetX = 0;
  let extraSpacePerWordGap = 0;

  let align = label.textAlign;

  if (align === TextAlign.Auto) {
    align = paragraphIsRTL ? TextAlign.Right : TextAlign.Left;
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
      // The last line, and a line with no space to widen, are not stretched;
      // they sit on the paragraph's start side.
      const spaceCount = line.text.split(' ').length - 1;
      if (line.idx === line.count - 1 || spaceCount === 0) {
        alignOffsetX = paragraphIsRTL ? contentMaxWidth - line.width : 0;
      } else {
        extraSpacePerWordGap = (contentMaxWidth - line.width) / spaceCount;
      }
      break;
    }
  }

  return { alignOffsetX, extraSpacePerWordGap };
}
