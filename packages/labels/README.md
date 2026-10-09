# @itowns/labels

Text labels for [three.js](https://threejs.org/), drawn through one instanced mesh
from a glyph atlas built at runtime, and placed on screen so they do not overlap.
Ink and halo come from one signed distance field in a single pass. Units and
option names follow the text properties of the
[Mapbox style specification](https://docs.mapbox.com/style-spec/reference/layers/#symbol).

Dependencies:

* `three`, as a peer
* `@mapbox/tiny-sdf`, to rasterize glyphs from any font the browser can draw
* `@mapbox/mapbox-gl-rtl-text`, for Arabic shaping and bidirectional reordering

**Requires WebGL2**: the label material is GLSL3.

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

const manager = new InstancedLabelManager(renderer);
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

// Every frame, before rendering:
manager.cull(camera);
```

* Changes to labels, and adding or removing them, are committed on the next
  microtask.
* With `autoUpdate: false`, call `manager.update()` after changes, and once more
  after `rtlReady` settles: loading the RTL shaper queues a relayout of RTL labels.
* `manager.dispose()` releases GPU resources and its labels, which can be added to
  another manager. The mesh stays in its parent.

## Units

* **px**: a CSS pixel of the renderer's canvas, on a label facing the camera, at
  any distance. A 16 px label is as tall as 16 px CSS text; a map-aligned label
  seen at an angle is foreshortened.
* **em**: multiples of `fontSize`, for spacing and offsets.
* Label positions are world coordinates; the mesh's own transform is ignored.

## Label options

Set an option on construction, through the matching property, or several at once
with `label.set({ … })`, which notifies once. A change to text, font or layout
lays the label out again; colour, opacity or transform only rewrite its data.
Which changes also open a placement pass is listed under [Placement](#placement).

| Option | Values | Default | Mapbox property |
| --- | --- | --- | --- |
| `text` | | | `text-field` |
| `textTransform` | `None`, `Uppercase`, `Lowercase`, `Capitalize` | `None` | `text-transform` |
| `font` | a string is a CSS family list used as written (`'Arial Black, sans-serif'`); an array is a `text-font` stack whose names carry weight and style (`['Open Sans Semibold', 'Arial Unicode MS Bold']`) | `'Arial'` | `text-font` |
| `fontWeight` | CSS weight, number or name; from the first name of a `text-font` stack unless given | `'400'` | |
| `fontStyle` | `normal`, `italic`, `oblique` | `normal` | |
| `fontSize` | px | `20` | `text-size` |
| `letterSpacing` | em | `0` | `text-letter-spacing` |
| `lineHeight` | em | `1.2` | `text-line-height` |
| `maxWidth` | em; `Infinity` breaks only at `\n` | `Infinity` | `text-max-width` |
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
| `symbolPlacement` | `Point`; `Line` and `Line-Center` are accepted and placed as `Point` | `Point` | `symbol-placement` |
| `allowOverlap` | | `false` | `text-allow-overlap` |
| `rotation` | XYZ Euler radians, `Euler` or `Quaternion`; `Map` only | identity | |
| `position` | world units | origin | |
| `visible` | | `true` | |

* `padding` reserves space around the text from other labels; it does not move the
  text.
* A line break (`\n`) starts a new paragraph. `Auto` alignment is right-aligned for
  a paragraph whose first letter is from an RTL script. `Justify` stretches every
  line of a paragraph except its last.
* `Capitalize` upper-cases the first letter of each word; an apostrophe does not
  start a word.
* A halo draws at most a quarter of `fontSize` past the ink: at `fontSize` 20,
  `haloWidth + haloBlur` beyond 5 px draws no wider. Placement reserves the halo's
  reach, less whatever `padding` already covers.

> [!NOTE]
> The objects `position`, `rotation`, `offset`, `color`, `haloColor` and `padding`
> return are the label's own. Editing one in place is not detected: assign a new
> value instead.

## Placement

`cull` opens a placement pass at most every `placementIntervalMs`, when:

* a placed label moved more than `moveThresholdPx` on screen, or, when the last
  pass placed none, the camera moved at all,
* labels were added or removed, or changed in a way that can move or hide them:
  position, rotation, text, font, layout, visibility, halo size,
  `rotationAlignment`, `allowOverlap`, or an opacity that crosses 0,
* the canvas was resized enough to change the collision grid, or
* one of `labelNear`, `labelFar`, `ndcCullMargin` and `renderPenaltyMultiplier`
  changed.

Setting a property to its current value opens no pass, nor does a change that only
affects style: `color`, `haloColor`, `symbolPlacement`, and an `opacity` or
`haloOpacity` that stays above 0.

A pass places labels nearest first on a screen-space occupancy grid:

* A label whose box crosses the canvas edge is not drawn.
* A label that finds its region taken is not drawn, unless it has `allowOverlap`:
  that label is placed anyway and still takes its region.
* A pass spreads over frames, spending about `placementBudgetMs` in each. A frame
  always runs at least one step, and sorting the candidates is a single step.

Fades step by elapsed time in every `cull`, by at most 100 ms per call:

* A hidden label (`visible: false` or `opacity: 0`) fades out like a label that
  lost its place, and frees its region on the next pass.
* A label closer than `labelNear` or beyond `labelFar` is not placed and fades out
  the same way.

### Depth

With `depthTest` on, labels are depth tested against what was drawn before them
and work with a renderer's logarithmic depth buffer. With it off, labels draw over
everything.

> [!NOTE]
> Only a label's front face is drawn. A `Map` label seen from behind is still
> placed and keeps other labels away.

<p align="center">
  <img src="https://raw.githubusercontent.com/Nynjin/Three3DText/main/docs/images/fading.webp" alt="Labels fading in and out as the camera orbits" width="720">
  <br>
  <em>Labels fading in and out as the camera moves</em>
</p>

## Configuration

The manager takes a `Partial<LabelManagerConfig>` merged over
`DefaultLabelConfig`, and keeps its own copy as `manager.config`. Edits to it
apply from the next `cull`, except for the fields read at construction.

| Field | Meaning | Default | |
| --- | --- | --- | --- |
| `atlasFontSize` | raster px glyphs are rasterized at; labels drawn at twice it or more show lumpy edges | `32` | read at construction |
| `autoUpdate` | commit changes on the next microtask | `true` | |
| `placementIntervalMs` | ms between pass starts | `200` | |
| `placementBudgetMs` | ms of placement per frame | `3` | |
| `fadeDurationMs` | ms per fade; `0` shows and hides at once | `650` | |
| `fadeGamma` | fade curve; 1 is linear | `3` | |
| `downscale` | divisor of the screen resolution for the collision grid, a power of two: 8 makes each cell 8 × 8 CSS px; a label claims every cell its box touches | `4` | read at construction |
| `moveThresholdPx` | CSS px a placed label moves on screen before a new pass | `1` | |
| `ndcCullMargin` | NDC units past the screen edge a label's anchor may sit and still be considered; a label is placed only when its whole box is on screen | `0.2` | |
| `labelNear`, `labelFar` | world units; a label beyond them is not placed and fades out | `0`, `Infinity` | |
| `renderPenaltyMultiplier` | factor on the squared distance of a label the last pass did not place | `1.5` | |
| `depthTest` | whether what was drawn before the labels hides them | `false` | |

## Limits

* Glyphs are rasterized with the font the browser resolves at that moment. When a
  web font used by a label finishes loading, every glyph is rasterized again and
  every label laid out again; with `autoUpdate: false`, the next `update()` does it.
* A label belongs to one manager at a time: the manager writes its placement, fade
  and pending work onto the label.
* The atlas never frees a glyph. It grows up to the device's texture size; once
  full, new characters draw as `?` and a warning is logged once.
* Layout uses each character's own advance: no kerning and no ligatures. Shaping
  covers Arabic joining forms and bidirectional reordering.
* Emoji draw as single-colour silhouettes in the label's colour.
* In text with an RTL script, combining marks, such as Hebrew vowel points, draw as
  separate glyphs.
* Lines break at spaces and `\n`, and mid-word when a word is wider than
  `maxWidth`.
* A character the font lacks is drawn with the browser's fallback font, or as a
  missing-glyph box.
* Only point placement: text does not follow lines.
* `allowOverlap` places a label over others; the region it takes still keeps later
  labels away. There is no `text-ignore-placement`.

## Development

The package lives in the [Three3DText repository](https://github.com/Nynjin/Three3DText),
alongside the benchmark app it is developed against.

## License

Dual **CeCILL-B / MIT**, inherited from iTowns. See [LICENSE](./LICENSE).
Notices for `three` and the two Mapbox packages are in
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
