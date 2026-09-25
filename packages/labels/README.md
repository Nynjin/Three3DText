# @itowns/labels

Text labels for [three.js](https://threejs.org/), drawn through one instanced mesh
from a glyph atlas built at runtime, and placed on screen so they do not overlap.
Ink and halo come from one signed distance field in a single pass. Units and
option names follow the text properties of the
[Mapbox style specification](https://docs.mapbox.com/style-spec/reference/layers/#symbol).

Dependencies are `three` as a peer, `@mapbox/tiny-sdf` to rasterize glyphs from
any font the browser can draw, and `@mapbox/mapbox-gl-rtl-text` for Arabic
shaping and bidirectional reordering.

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
    font: 'Arial Bold',
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

Changes to labels, and adding or removing them, are committed on the next
microtask. With `autoUpdate: false`, call `manager.update()` after changes
instead, and once more after `rtlReady` settles: loading the RTL shaper queues a
relayout of RTL labels. `manager.dispose()` releases GPU resources and leaves the
mesh in its parent.

## Units

A size in **px** is a CSS pixel of the renderer's canvas on a label facing the
camera, at any distance: a 16 px label is as tall as 16 px CSS text. A
map-aligned label seen at an angle is foreshortened. Spacing and offsets are in
**em**, multiples of `fontSize`. Label positions are world coordinates; the
mesh's own transform is ignored.

## Label options

Set on construction, through the matching property, or several at once with
`label.set({ … })`, which notifies once. A change to text, font or layout lays the
label out again; colour, opacity or transform only rewrite its data.

| Option | Unit | Default | Mapbox property |
| --- | --- | --- | --- |
| `text` | | | `text-field` |
| `textTransform` | `None`, `Uppercase`, `Lowercase`, `Capitalize` | `None` | `text-transform` |
| `font` | CSS family, optionally followed by weight and style words (`'Open Sans Semi Bold Italic'`) | `'Arial'` | `text-font` |
| `fontWeight` | CSS weight, number or name | `400` | |
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
| `rotation` | XYZ Euler radians, `Euler` or `Quaternion`; `Map` only | identity | |
| `position` | world units | origin | |
| `visible` | | `true` | |

`padding` reserves space around the text from other labels; it does not move the
text. `Auto` alignment is right-aligned when the text's first letter is from an
RTL script. `Capitalize` upper-cases the first letter of each word, and an
apostrophe does not start a word.

The objects `position`, `rotation`, `offset`, `color`, `haloColor` and `padding`
return are the label's own. Editing one in place is not detected: assign a new
value instead.

### Halo reach

The distance field carries a quarter of `fontSize` past the ink, so that is the
furthest a halo draws: at `fontSize` 20, `haloWidth + haloBlur` beyond 5 px draws
no wider. Placement reserves the halo's reach, less whatever `padding` already
covers.

## Placement

`cull` opens a placement pass at most every `placementIntervalMs`, when the
camera moved more than `viewProjThreshold` or labels changed. Labels are placed
nearest first on a screen-space occupancy grid; a label that finds its region
taken is not drawn. A pass spreads over frames, spending about
`placementBudgetMs` in each: a frame always runs at least one step, and sorting
the candidates is a single step. Fades step by elapsed time in every `cull`.

A hidden label (`visible: false` or `opacity: 0`) disappears at once and frees
its region on the next pass.

<p align="center">
  <img src="https://raw.githubusercontent.com/Nynjin/Three3DText/main/docs/images/fading.webp" alt="Labels fading in and out as the camera orbits" width="720">
  <br>
  <em>Labels fading in and out as the camera moves</em>
</p>

## Configuration

The manager takes a `Partial<LabelManagerConfig>` merged over
`DefaultLabelConfig`, and keeps its own copy as `manager.config`. Edits to it
apply from the next `cull`, except for the fields read at construction.

| Field | Unit | Default | |
| --- | --- | --- | --- |
| `atlasFontSize` | px glyphs are rasterized at; labels at twice it or more show lumpy edges | `32` | read at construction |
| `atlasCapacityMultiplier` | atlas headroom on growth, at least 1 | `1.5` | read at construction |
| `autoUpdate` | commit changes on the next microtask | `true` | |
| `placementIntervalMs` | ms between pass starts | `200` | |
| `placementBudgetMs` | ms of placement per frame | `3` | |
| `fadeDurationMs` | ms per fade; `0` shows and hides at once | `650` | |
| `fadeGamma` | fade curve; 1 is linear | `3` | |
| `downscale` | CSS px per grid cell, a power of two; a label claims every cell its box touches | `4` | read at construction |
| `occlusionTolerance` | fraction, 0 to 1, of its cells a placed label may lose and stay | `0.2` | |
| `viewProjThreshold` | largest change of any view-projection matrix element | `0.05` | |
| `ndcCullMargin` | NDC units past the frustum a label's position may sit | `0.2` | |
| `labelNear`, `labelFar` | world units | `0`, `Infinity` | |
| `renderPenaltyMultiplier` | factor on the squared distance of a label not yet placed | `1.5` | |

`viewProjThreshold` compares translation elements too, which grow with world
coordinates: a scene far from the origin, such as an Earth-centred one, needs a
larger value.

## Limits

* Glyphs are rasterized once, with whatever font the browser resolves at that
  moment: load a web font before adding labels that use it.
* The atlas never frees a glyph. It grows up to the device's texture size; once
  full, new characters draw as `?` and a warning is logged once.
* Layout uses each character's own advance: no kerning and no ligatures.
  Shaping covers Arabic joining forms and bidirectional reordering.
* Emoji draw as single-colour silhouettes in the label's colour.
* In text with an RTL script, combining marks, such as Hebrew vowel points,
  draw as separate glyphs.
* Lines break at spaces and `\n`, and mid-word when a word is wider than
  `maxWidth`.
* A character the font lacks is drawn with the browser's fallback font, or as a
  missing-glyph box.
* Only point placement: text does not follow lines.
* A label already placed keeps its place while less than `occlusionTolerance` of its
  box is covered, so a small label can sit on top of a large one.

## Development

The package lives in the [Three3DText repository](https://github.com/Nynjin/Three3DText),
alongside the benchmark app it is developed against.

## License

Dual **CeCILL-B / MIT**, inherited from iTowns. See [LICENSE](./LICENSE).
Notices for `three` and the two Mapbox packages are in
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
