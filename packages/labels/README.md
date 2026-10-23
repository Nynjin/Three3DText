# @itowns/labels

Map-style text labels for [three.js](https://threejs.org/): many labels in one draw
call, overlapping ones hidden. Options and units follow the text properties of the
[Mapbox style specification](https://docs.mapbox.com/style-spec/reference/layers/#symbol).

* Glyphs rasterized at runtime from any font the browser can draw, into one signed
  distance field atlas; ink and halo from that field
* Arabic shaping and bidirectional text
* Requires WebGL2
* Dependencies: `three` (peer), `@mapbox/tiny-sdf`, `@mapbox/mapbox-gl-rtl-text`

<p align="center">
  <img src="https://raw.githubusercontent.com/Nynjin/Three3DText/main/docs/images/overview.png" alt="Place-name labels in seven scripts and emoji at a range of sizes, each language with its own halo colour" width="900">
  <br>
  <em>20 000 labels in seven scripts plus emoji, 16 to 48 px, five font families, one shared atlas</em>
</p>

| Without placement | With placement |
| :---: | :---: |
| <img src="https://raw.githubusercontent.com/Nynjin/Three3DText/main/docs/images/occlusion-off.png" alt="Every projectable label drawn, overlapping" width="420"> | <img src="https://raw.githubusercontent.com/Nynjin/Three3DText/main/docs/images/occlusion-on.png" alt="Overlaps resolved, labels readable" width="420"> |
| every projectable label drawn | overlaps resolved on the occupancy grid |

## Install

```sh
npm install @itowns/labels three
```

TypeScript projects also need `@types/three`:

```sh
npm install -D @types/three
```

## Usage

```ts
import { InstancedLabelManager, Label, TextAnchorX, TextAnchorY } from '@itowns/labels';

const manager = new InstancedLabelManager(renderer); // a THREE.WebGLRenderer
scene.add(manager.mesh);

manager.addLabels([
  new Label({
    text: 'Villejuif',
    position: [0, 0, 0],
    font: 'Arial',
    fontWeight: 'bold',
    fontSize: 16,
    color: '#1d2b36',
    haloColor: '#ffffff',
    haloWidth: 2,
    anchorX: TextAnchorX.Center,
    anchorY: TextAnchorY.Middle,
  }),
]);

renderer.setAnimationLoop(() => {
  manager.cull(camera); // every frame, before rendering
  renderer.render(scene, camera);
});
```

* Update: set a property (`label.text = 'Paris'`) or several with `label.set({ … })`.
* Remove: `manager.removeLabel(label)`, `manager.removeLabels(labels)`.
* Changes commit on the next microtask. With `autoUpdate: false`, call
  `manager.update()` after changes, after `rtlReady` settles, and after a web font
  a label uses finishes loading.
* Canvas resizes need no call.
* `manager.dispose()`: frees GPU resources; the manager is unusable afterwards. Its
  labels can join another manager. The mesh stays in its parent.

## Units

* **px**: CSS pixels of the canvas, on a label facing the camera, at any distance.
  A map-aligned label seen at an angle is foreshortened.
* **em**: multiples of `fontSize`.
* `position`: world coordinates; the mesh's own transform is ignored.

## Label options

Set on construction, through the property, or with `label.set({ … })` (one
notification).

| Option | Values | Default | Mapbox property |
| --- | --- | --- | --- |
| `text` | | | `text-field` |
| `textTransform` | `None`, `Uppercase`, `Lowercase`, `Capitalize` | `None` | `text-transform` |
| `font` | CSS family list, or `text-font` array | `'Arial'` | `text-font` |
| `fontWeight` | CSS weight, number or name | `'400'` | |
| `fontStyle` | `normal`, `italic`, `oblique` | `normal` | |
| `fontSize` | px, em size | `20` | `text-size` |
| `letterSpacing` | em | `0` | `text-letter-spacing` |
| `lineHeight` | em | `1.2` | `text-line-height` |
| `maxWidth` | em; `Infinity`: break at `\n` only | `Infinity` | `text-max-width` |
| `textAlign` | `Auto`, `Left`, `Center`, `Right`, `Justify` | `Auto` | `text-justify` |
| `anchorX` | `Left`, `Center`, `Right` | `Left` | `text-anchor` |
| `anchorY` | `Top`, `Middle`, `Bottom`, `Baseline` | `Top` | `text-anchor` |
| `offset` | em, +x right, +y down | `[0, 0]` | `text-offset` |
| `padding` | px, one number or `[top, right, bottom, left]` | `20` | `text-padding` |
| `color` | CSS colour or three `Color` | white | `text-color` |
| `opacity` | 0 to 1 | `1` | `text-opacity` |
| `haloColor` | CSS colour or three `Color` | white | `text-halo-color` |
| `haloWidth` | px | `0` | `text-halo-width` |
| `haloBlur` | px | `0` | `text-halo-blur` |
| `haloOpacity` | 0 to 1, times `opacity` | `1` | |
| `rotationAlignment` | `Map`, `Viewport` | `Map` | `text-rotation-alignment` |
| `symbolPlacement` | `Point`; `Line`, `Line-Center` placed as `Point` | `Point` | `symbol-placement` |
| `allowOverlap` | | `false` | `text-allow-overlap` |
| `rotation` | XYZ Euler radians, `Euler` or `Quaternion`; `Map` only | identity | |
| `position` | world units | origin | |
| `visible` | | `true` | |

* `font`: a string is used as a CSS family list (`'Arial Black, sans-serif'`); an
  array is a `text-font` stack whose names carry weight and style
  (`['Open Sans Semibold', 'Arial Unicode MS Bold']`). An explicit `fontWeight` or
  `fontStyle` wins over the stack's.
* `padding`: space kept free of other labels; does not move the text.
* `\n` starts a paragraph. `Auto`: right-aligned when the paragraph starts with an
  RTL letter. `Justify`: every line but a paragraph's last.
* `Capitalize`: first letter of each word; an apostrophe does not start a word.
* Halo: at most a quarter of `fontSize` past the ink (5 px at `fontSize` 20).

> [!NOTE]
> `position`, `rotation`, `offset`, `color`, `haloColor` and `padding` return the
> label's own objects. Editing one in place is not detected: assign a new value.

## Placement

`cull` places labels nearest first on a screen-space occupancy grid, in passes at
most every `placementIntervalMs`, each spread over frames at about
`placementBudgetMs` per frame. A pass opens when the camera moves a placed label by
`moveThresholdPx`, or when labels, the canvas or the config change in a way that
can move or hide them. Style-only changes (colours, an opacity that stays above 0)
open none.

* Box crossing the canvas edge: not drawn.
* Region taken: not drawn, unless `allowOverlap`; that label still takes its region.
* Hidden (`visible: false`, `opacity: 0`), nearer than `labelNear` or beyond
  `labelFar`: fades out and frees its region on the next pass.
* Fades advance by elapsed time, at most 100 ms per `cull`.

### Depth

* `depthTest` on: labels are hidden by what was drawn before them; works with a
  logarithmic depth buffer.
* Off: labels draw over everything.
* Only the front face draws: a `Map` label seen from behind is invisible but still
  takes its region.

<p align="center">
  <img src="https://raw.githubusercontent.com/Nynjin/Three3DText/main/docs/images/fading.webp" alt="Labels fading in and out as the camera orbits" width="720">
  <br>
  <em>Labels fading in and out as the camera moves</em>
</p>

## Configuration

`new InstancedLabelManager(renderer, config)` takes a `Partial<LabelManagerConfig>`
over `DefaultLabelConfig`. `manager.config` is the live copy: edits apply from the
next `cull`, except fields read at construction.

| Field | Meaning | Default | Note |
| --- | --- | --- | --- |
| `atlasFontSize` | px glyphs are rasterized at; labels at twice it or more get lumpy edges | `32` | construction only |
| `autoUpdate` | commit changes on the next microtask | `true` | |
| `placementIntervalMs` | ms between pass starts | `200` | |
| `placementBudgetMs` | ms of placement per frame | `3` | |
| `fadeDurationMs` | ms per fade; `0`: instant | `650` | |
| `fadeGamma` | fade curve; 1 is linear | `3` | |
| `downscale` | collision grid at 1/`downscale` of the canvas; power of two | `4` | construction only |
| `moveThresholdPx` | CSS px a placed label moves before a new pass | `1` | |
| `ndcCullMargin` | NDC units past the screen edge an anchor may sit and still be considered | `0.2` | |
| `labelNear`, `labelFar` | world units; outside them, not placed | `0`, `Infinity` | |
| `renderPenaltyMultiplier` | factor on the squared distance of a label the last pass did not place | `1.5` | |
| `depthTest` | hidden by what was drawn before | `false` | |

## Limits

* Atlas never frees a glyph; once at the device's texture size, new characters
  draw as `?` and a warning is logged.
* Label data: at most 4096 texels a side, or the device's texture size if smaller.
* No kerning, no ligatures.
* Emoji draw in the label's colour only.
* Only point placement: text does not follow lines. No `text-ignore-placement`.
* Web font loaded later: every glyph rasterized and every label laid out again.
* One manager per label at a time.
* Lines break at spaces and `\n`, and mid-word when a word exceeds `maxWidth`.
* Characters the font lacks: browser fallback font, or a missing-glyph box.
* RTL text: combining marks (Hebrew vowel points) draw as separate glyphs.

## Development

The package lives in the [Three3DText repository](https://github.com/Nynjin/Three3DText),
with the benchmark app it is developed against.

## License

Dual **CeCILL-B / MIT**, inherited from iTowns. See [LICENSE](./LICENSE).
Notices for `three` and the two Mapbox packages are in
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
