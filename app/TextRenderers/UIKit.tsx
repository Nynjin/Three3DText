import { Text as UIKitText } from "@react-three/uikit";
import type { Item } from "../Types/Item";

export function UIKitCloud({ items, halo }: { items: Item[]; halo: boolean }) {
  return (
    <>
      {halo &&
        items.map(({ key, text, position, rotation }) => (
          <group key={key} position={position} rotation={rotation}>
            <UIKitText
              color={"#000000"}
              fontSize={100}
              anchorX={"center"}
              anchorY={"center"}
              backgroundColor={"#cccccc"}
            >
              {text}
            </UIKitText>
          </group>
        ))}
      {!halo &&
        items.map(({ key, text, position, rotation }) => (
          <group key={key} position={position} rotation={rotation}>
            <UIKitText
              color={"#000000"}
              fontSize={100}
              anchorX={"center"}
              anchorY={"center"}
            >
              {text}
            </UIKitText>
          </group>
        ))}
    </>
  );
}
