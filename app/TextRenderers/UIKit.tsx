import { Text as UIKitText } from '@react-three/uikit';
import type { Item } from '../Types/Item';
import { BASE_FONT_SIZE_PX } from '../Utils/MakeItems';

/**
 * UIKit font size drawn for a label of BASE_FONT_SIZE_PX. UIKit loads its own
 * font, so `fontFamily` and `fontStyle` are not applied.
 */
const UIKIT_BASE_SIZE = 100;

export function UIKitCloud({ items, halo }: { items: Item[]; halo: boolean }) {
  return (
    <>
      {items.map(({ key, text, position, rotation, style }) => (
        <group key={key} position={position} rotation={rotation}>
          <UIKitText
            color={style.fillColor}
            fontSize={(UIKIT_BASE_SIZE * style.fontSizePx) / BASE_FONT_SIZE_PX}
            fontWeight={style.fontWeight}
            anchorX="center"
            anchorY="center"
            // UIKit has no text outline, so the halo colour can only show as a
            // backing plate. It is not an equivalent effect.
            backgroundColor={halo ? style.haloColor : undefined}
          >
            {text}
          </UIKitText>
        </group>
      ))}
    </>
  );
}
