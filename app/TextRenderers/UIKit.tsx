import { Text as UIKitText } from "@react-three/uikit";
import type { Item } from "../Types/Item";

export function UIKitCloud({ items, halo }: { items: Item[]; halo: boolean }) {
  return (
    <>
      {items.map(({ key, text, position, rotation }) => (
        <group key={key} position={position} rotation={rotation}>
          <UIKitText
            color={"#000000"}
            fontSize={100}
            anchorX={"center"}
            anchorY={"center"}
            backgroundColor={halo ? "#cccccc" : undefined}
          >
            {text}
          </UIKitText>
        </group>
      ))}
    </>
  );
}
