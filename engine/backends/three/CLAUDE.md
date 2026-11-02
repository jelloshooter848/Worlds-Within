# engine/backends/three

The 3D backend (Engine 0.6, "Basic 3D backend"): shows any presentation frame
(`@engine/core/present`) as a 2.5D Three.js scene through a `three` skin, side-on with
perspective, in the style of New Super Mario Bros. It reads the same snapshot as the Canvas2D
backend and holds no game rules. `index.ts` exports `ThreeScene` (`scene.ts`), the WebGL
`ThreePresenter` (`presenter.ts`), the renderer check (`renderer-info.ts`), the canvas fit helper
(`fit.ts`), the page's display (`display.ts`: `threeDisplay`, `threeScenePresenter`,
`webgl2Available`) and the primitive geometry helpers (`geometry.ts`: `primitiveGeometry(shape, size)`,
`GeometryCache`).

Node vs browser: `scene.ts`, `geometry.ts`, `renderer-info.ts` and `fitCanvas` / `canvasToScreen`
in `fit.ts` run in Node and are tested there. `ThreePresenter` (it makes a `WebGLRenderer`) and
`applyCanvasBox` (it sets CSS) are browser only: Node has no WebGL, so they only typecheck in
`pnpm test` and are exercised in Playwright Chromium (the 3D play page and
`pnpm cli screenshot --backend three`, Engine 0.6 T6/T7), which skip where no browser is installed.

## ThreeScene

`new ThreeScene(skin, opts?)` builds a scene graph; it needs no WebGL and runs in Node. A renderer
(the WebGL `ThreePresenter`, Engine 0.6 T4) only draws `scene` with `camera`.
`opts`: `size?` (the picture to frame in; else `frame.size`; `resize(size)` changes it),
`onSound?(id)`, `background?` (`#000`), `clamp?` (the skin's `camera.clamp`, else true), `reduceFlashing?`.
`sync(frame)` brings `scene` and `camera` up to the frame. Read-outs for tests and the presenter:
`entity(id)` (an entity's root `Group`), `entityIds()`, `map` (the built map `Group`, or null),
`mapBuilds`, `view` (the world box, px with y down, framed on the z = 0 plane, without shake),
`ambient`, `sun`, `overlay`; `dispose()` frees geometries and materials.

Axes: world px, x right, y flipped (Three's y is up, so a world `y` becomes `-y`), z toward the
camera.

- Map: built once per map id and version, reused for `{ id, version }` refs, hidden on a frame
  with no `map`; a ref to a map never sent shows none. Each tile key the skin lists becomes one
  `InstancedMesh` per mesh part (`resolveMeshParts(skin, entry, { w: tileSize, h: tileSize })`),
  one instance per cell; unlisted tiles stay empty. `map.tiles` sit at z = 0; `layers[i]` behind
  them at z = -(i + 1) * `camera3d.layerDepth` (background scenery; in 2D they draw after the
  tiles and still under the entities).
- Entities: one root `Group` per entity id, made on first sight, updated each frame, removed when
  the id is gone, rebuilt when its kind or box size changes. The root is the box's bottom centre
  (`x + w/2`, `-(y + h)`) at z = `layer` * `camera3d.layerDepth`; its children are the skin's mesh
  parts. Facing left mirrors x (scale -1); a diagonal maps to its horizontal cardinal
  (`cardinalFacing`), so `up-left` and `down-left` mirror too (`facesLeft`) and the right-hand
  diagonals do not; `fx.squashX`/`squashY` scale the root (so about the
  bottom centre); `fx.rotate` turns clockwise on screen (negative about z); `fx.alpha` sets each
  material's opacity (transparent below 1). A kind the skin does not list, or an entry with no
  mesh, is a fallback box of the entity's box, as deep as it is wide, in `sheets.fallbackColor`,
  else `DEFAULT_FALLBACK_COLOR` (`userData.fallback` is true). Same-layer entities share a depth
  plane: list order is not kept there (depth decides).
- Camera: a `PerspectiveCamera` framed by the core `CameraFollower` (shared with Canvas2D; change
  the framing there, not here) from the frame's hint (`follow`, `x`/`y`, `bounds`, `deadzone`,
  `lerp`) and the skin's `camera` defaults. `zoom` (`cameraZoom`: the hint's, else the skin's, else 1) is
  honoured by distance: the view is `cameraView(size, zoom)` (the picture size divided by `zoom`),
  and the follower frames that view, as the Canvas2D presenter does.
  The camera looks at the view's centre from distance `view.height / (2 tan(fov / 2))`, so the
  z = 0 plane shows exactly the view at the skin's `camera3d.fov` and 2D and 3D frame the same world
  box. `camera3d.tilt` (degrees, positive looks down) raises it on a circle round that centre.
  `cameraShake` (hint `shake` plus `shake` effects) moves it on x each frame, never stored.
- Lights: one `AmbientLight` and one `DirectionalLight` (`camera3d.lights`), no shadows.
- Events: each event whose type the skin lists calls `onSound(sound)` once; a frame with the same
  `frame` number as the last one does not replay them. Effects: `flash` (skipped with
  `reduceFlashing`) and `tint` (fading from 0.4) show on `overlay`, a full-screen plane on the
  camera drawn last; `shake` moves the camera; `particles` are not drawn.

It never changes the frame or the skin (tested with frozen ones) and knows no game or kit. No
`Math.random`, `Date.now` or `performance.now` in this folder's code (a test checks); Three's own
object UUIDs use randomness internally, which is fine: they never reach a state or a hash.

## ThreePresenter (browser only)

`new ThreePresenter(canvas, skin, opts?)` implements the core `Presenter`: `present(frame)` syncs
its `ThreeScene` (`presenter.scene`) and draws it with `presenter.renderer`, a `WebGLRenderer` on
`canvas` (an `HTMLCanvasElement` or `OffscreenCanvas`); `resize(size)` changes the picture size.
Options mirror `SkinnedCanvasPresenter` where they apply: `size?` (else `frame.size`),
`onSound?(id)`, `background?` (`#000`), `clamp?` (the skin's `camera.clamp`, else true), `reduceFlashing?`; they are passed on to
the scene. So a paused frame draws the same every time on one machine, the renderer is fixed:
`antialias: false`, `preserveDrawingBuffer: true` (screenshots read the buffer after drawing),
pixel ratio 1, `SRGBColorSpace` output, no shadows, clear colour `background`. The drawing buffer
is the picture size (`setSize(w, h, false)`: the CSS size is left to the page). `rendererInfo()`
reads the context's renderer (below); `dispose()` frees the scene and the renderer.
`withSkin(skin, opts?)` (Engine 0.7 T8) is another `Presenter` on the same canvas and renderer
with a `ThreeScene` of its own (`.scene`; `opts` as above but `size`, which is this presenter's):
for a second frame source in one stream, such as a stacked mini game's frames in another kit's
skin. Each draws its own scene with the one WebGL context; `dispose()` frees them all.

## Renderer check (`renderer-info.ts`, pure)

`webglRendererInfo(gl)` returns `{ vendor, renderer, unmasked }`: the `UNMASKED_VENDOR_WEBGL` /
`UNMASKED_RENDERER_WEBGL` strings through the `WEBGL_debug_renderer_info` extension, else (no
extension, or it gives nothing) the core `VENDOR` / `RENDERER`. It reads `gl` through
`GlInfoSource` (`getParameter`, `getExtension`) and imports nothing from `three`.
`isSoftwareRenderer(name)` is true when the string names SwiftShader, llvmpipe, softpipe,
"Software" (a whole word) or Microsoft Basic Render, also inside an ANGLE string. Screenshots use
it to fail clearly on a silent fall-back to software rendering. Playwright's bundled Chromium in a
container without a GPU reports `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device ...), SwiftShader
driver)`, which is software.

## Fitting the canvas (`fit.ts`)

`fitCanvas(size, cssW, cssH, dpr?, integerScale?, fit?)` letterboxes the picture with the same
`fitGame` maths (`@engine/core/gfx/screen`) the Canvas2D `Viewport` uses and gives a `CanvasBox`
in CSS px (`scale` is device px per game px, as `Viewport.scale`). `applyCanvasBox(canvas, box)`
places the canvas absolutely in its (positioned) container with `image-rendering: pixelated`;
`canvasToScreen(box, rect, clientX, clientY, dpr?)` maps a client point to game px, as
`Viewport.toScreen`. The WebGL buffer never changes with the window; only CSS scales it.

### Known gaps (Engine 0.6)

- HUD: `skin.hud` and `frame.status` are not drawn in 3D (feedback item 66; decided in Engine 0.7
  T8: moved to 0.15, gap G33 in `docs/reports/stacking-test.md`).
- `particles` effects are not drawn (the same: moved to 0.15, G33).
- Same-layer entities are not ordered by list order (they share a depth plane).

## The page's display (`display.ts`, Engine 0.7)

`threeDisplay(canvas, { screen, skin, rounds?, background?, integerScale?, onSound? })` is the 3D
`BrowserDisplay` (`@engine/core/shell`) a game hands `bootBrowserGame`, or a sentence saying why
it cannot start: `webgl2Available()` is false (no WebGL 2), or `ThreePresenter` threw (the
message names the error). Its `presenter` is a `ThreePresenter` with the game's `three` skin on
the page's canvas; with `rounds` (a skin per mini game id, the core `skinSet`'s `rounds`: the
game's `three-<id>.json`, Engine 0.7 T8) it is the core `presenterBySkinSet` over that and one
`withSkin` presenter per round skin (black background), so a frame whose `status.miniGame` names
one is drawn through its skin; `fit(layout)` places the canvas with `fitCanvas` + `applyCanvasBox` from the
layout's `fit`; its `renderer` draws nothing (scenes show frames through the presenter) and
`present()` does nothing. A game reaches it with `await import('@engine/backends/three')` so its
2D page loads no Three.js (moved from `games/platformer-lab/main3d.ts`).
`threeScenePresenter(skin, { screen, background?, rounds? })` is a `Presenter` over the Node-side
`ThreeScene` (`present` is `sync`; `.scene` for read-outs): what tests use to check what 3D shows
(backend parity) with no WebGL. With `rounds`, a mini game's frames go to a scene of their own
(`.rounds[id]`), as on the page; `.shown` is the scene the last frame went to.

## Imports

- Allowed: `@engine/core/*`, files in this folder, the `three` package and browser APIs.
- `three` may be imported only from this folder (`PACKAGES` in `config/layers.js`; ESLint and
  `tests/architecture/dependency-rule.test.ts` enforce it). Everything else reaches 3D through a
  skin and a `Presenter`.
- Never: other backends, `engine/sim`, `engine/tools`, kits or games.
- Draw only what the frame and skin say: no game rules here.

## Testing

`scene.test.ts` runs in Node (`pnpm test`) with inline fixture frames and an inline `three` skin
(never import a kit or a game's skin). It covers tiles becoming instanced blocks, the map built
only on a new id or version, map layers' depth, entities added, moved and removed by id, mesh
parts placed from the box, layer to z, the facing mirror (left-hand diagonals too), squash about the bottom centre, rotate
and alpha, the fallback box, the camera framing the same world box as `CameraFollower` (corners
projected to the picture's corners), hint framing, zoom, tilt and shake, lights, sounds once per
event, the flash overlay, frozen frames and skin never changed, and repeatable builds.
`renderer-info.test.ts` checks `isSoftwareRenderer` on software strings (SwiftShader, ANGLE on
SwiftShader, llvmpipe, softpipe, Microsoft Basic Render) and typical hardware ones (ANGLE on
NVIDIA, AMD, Intel and Apple, Mesa, Adreno), and `webglRendererInfo` with a fake context with and
without the debug extension. `fit.test.ts` checks `fitCanvas` against `fitGame` and
`canvasToScreen`. `display.test.ts` checks `threeScenePresenter` (with and without round skins)
and the no-WebGL 2 message. WebGL drawing (`ThreePresenter`) is not tested in Node; it needs a browser.
