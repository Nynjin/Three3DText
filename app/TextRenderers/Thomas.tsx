import { Color } from "three";
import { SDFTextProvider, SDFText } from "thomas";
import { FontPathRegular } from "../Commons/Constants";
import type { Item } from "../Types/Item";

export function ThomasCloud({ items, halo }: { items: Item[]; halo: boolean }) {
  return (
    <SDFTextProvider fontPathRegular={FontPathRegular}>
      <>
        {halo &&
          items.map(({ key, text, position, rotation }) => (
            <group key={key} position={position} rotation={rotation}>
              <SDFText
                text={text}
                instanceKey={`${key}-h`}
                color={new Color("#000000")}
                alignX="center"
                alignY="middle"
                outlineWidth={1}
                outlineOpacity={1}
                outlineColor={new Color("#cccccc")}
              />
            </group>
          ))}
        {!halo &&
          items.map(({ key, text, position, rotation }) => (
            <group key={key} position={position} rotation={rotation}>
              <SDFText
                text={text}
                instanceKey={`${key}`}
                color={new Color("#000000")}
                alignX="center"
                alignY="middle"
              />
            </group>
          ))}
      </>
    </SDFTextProvider>
  );
}
