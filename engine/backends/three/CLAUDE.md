# engine/backends/three

The 3D backend (Engine 0.6, "Basic 3D backend"): shows any presentation frame
(`@engine/core/present`) as a 2.5D Three.js scene through a `three` skin, side-on with
perspective, in the style of New Super Mario Bros. It reads the same snapshot as the Canvas2D
backend and holds no game rules. `index.ts` exports `ThreeScene` (`scene.ts`), the WebGL
`ThreePresenter` (`presenter.ts`), the renderer check (`renderer-info.ts`), the canvas fit helper
(`fit.ts`), the page's display (`display.ts`: `threeDisplay`, `threeScenePresenter`,
`webgl2Available`), the primitive geometry helpers (`geometry.ts`: `primitiveGeometry(shape, size)`,
`GeometryCache`), the HUD pass (`hud.ts`: `HudLayer`, `HudQuad`, `frameTexture`), the parallax planes (`parallax.ts`:
`ParallaxPlanes`, `PARALLAX_DEPTH_STEP`, Engine 0.16 T4) and `PARTICLE_POOL`.

Node vs browser: `scene.ts`, `hud.ts` (no canvas: its textures are `DataTexture`s), `geometry.ts`, `renderer-info.ts` and `fitCanvas` / `canvasToScreen`
in `fit.ts` run in Node and are tested there. `ThreePresenter` (it makes a `WebGLRenderer`) and
`applyCanvasBox` (it sets CSS) are browser only: Node has no WebGL, so they only typecheck in
`pnpm test` and are exercised in Playwright Chromium (the 3D play page and
`pnpm cli screenshot --backend three`, Engine 0.6 T6/T7), which skip where no browser is installed.

## ThreeScene

`new ThreeScene(skin, opts?)` builds a scene graph; it needs no WebGL and runs in Node. A renderer
(the WebGL `ThreePresenter`, Engine 0.6 T4) only draws `scene` with `camera`.
`opts`: `size?` (the picture to frame in; else `frame.size`; `resize(size)` changes it),
`onSound?(id)`, `background?` (the scene's background; default the skin's `background`, else
`#000`: `skinBackground`, gap G36), `clamp?` (the skin's `camera.clamp`, else true), `reduceFlashing?`, `seed?` (particles and shake noise),
`shakeScale?`, `subPixelShake?`, `onHitPause?(ticks)` (Engine 0.16 T4, as the Canvas2D presenter's),
`sheets?` (a `PixelSheetLookup` from `@engine/core/assets/content-sheets`, the game's sprite files
as decoded RGBA pixels, `contentPixelSheets(content)`: what the HUD draws; Engine 0.15, gap G33).
`sync(frame)` brings `scene`, `camera`, `particles` and the HUD pass (`hud`) up to the frame. Read-outs for tests and the presenter:
`entity(id)` (an entity's root `Group`), `entityIds()`, `map` (the built map `Group`, or null),
`mapBuilds`, `view` (the world box, px with y down, framed on the z = 0 plane, without shake),
`ambient`, `sun`, `overlay`, `particles` (the particle `Points`' `Group`), `particleViews()`, `hud` (the `HudLayer`:
`scene`, `camera`, `quads()`); `dispose()` frees geometries, materials and textures.

Axes: world px, x right, y flipped (Three's y is up, so a world `y` becomes `-y`), z toward the
camera.

- Map: built once per map id and version, reused for `{ id, version }` refs, hidden on a frame
  with no `map`; a ref to a map never sent shows none. Each tile key the skin lists becomes one
  `InstancedMesh` per mesh part (`resolveMeshParts(skin, entry, { w: tileSize, h: tileSize })`),
  one instance per cell; unlisted tiles stay empty. `map.tiles` sit at z = 0; `layers[i]` behind
  them at z = -(i + 1) * `camera3d.layerDepth` (background scenery; in 2D they draw after the
  tiles and still under the entities).
- Entities: one root `Group` per entity id, made on first sight, updated each frame, removed when
  the id is gone, rebuilt when its kind, box size, tag look or mesh changes. The mesh is
  `resolveSkinMesh` (Engine 0.16 T2): the kind's `poses` frame (a mesh per animation state and
  frame, with per-frame timing, one-shots and `then`), else its `mesh`. The entry is
  `resolveSkinKind(skin, entity)`: the kind's, with the first `byTag` look that matches one of the
  entity's tags laid over it (Engine 0.11, gap G30; a `prefix` look with a `min`/`max` range from
  Engine 0.15, gap M2, so a `progress:<n>` tag rebuilds the entity only when it crosses into
  another look). The root is the box's bottom centre
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
- Events: each event with a skin entry (`resolveSkinEvent`: a field key such as
  `mini-game-end:pass` first, then the bare type; gap G28), then each frame event of the skin's
  `poses` cycles (a `FrameEventClock`, Engine 0.16 T2), calls `onSound(sound)` once; a frame with the same
  `frame` number as the last one does not replay them. Effects: `flash` (skipped with
  `reduceFlashing`) and `tint` (fading from 0.4) show on `overlay`, a full-screen plane on the
  camera drawn last; `shake` moves the camera. Particles (Engine 0.16 T3; Engine 0.15 drew `particles` effects as
  pooled boxes): a `SkinParticles` (`@engine/core/fx`, seeded by the `seed` option) started by each
  event's `emit` and old `particles` effect (an implicit emitter flying out as before) and run by
  each kind's `emit` on its entities, drawn as two `Points` in the `particles` group,
  `particles:normal` and `particles:add` (`AdditiveBlending`), each a fixed buffer of
  `PARTICLE_POOL` (1024) points (`position`, `pColor`, `pSize`, `pAlpha`; `geometry.drawRange`
  is how many show) with a small `ShaderMaterial`: screen-facing squares `pSize` world px wide at
  any depth, at `PARTICLE_Z` (12) px in front of the z = 0 plane, no depth writes. A sprite
  `frame` draws as a square in its colour. `reduceFlashing` sends additive particles through the
  normal buffer at half strength. `particleViews()` is what the scene shows, for tests.
- Camera effects (Engine 0.16 T4): as the Canvas2D presenter, a `CameraFx` on the scene's own
  clock (one tick per `sync`): a zoom punch shrinks the framed view about the camera's target
  (the camera moves closer; `view` reads the punched box), the trauma shake moves the camera on x
  and y (picture px over the zoom, never stored), event flashes show on `overlay` after flash and
  tint effects (the last wins; skipped with `reduceFlashing`), and `hitPause` calls
  `onHitPause`. `effectSettings({ reduceFlashing?, shakeScale? })` changes the settings.
- Parallax (Engine 0.16 T4): `parallax`, a `ParallaxPlanes` (`parallax.ts`) whose `group` hangs on
  the camera: one quad per core `layoutParallax` draw (the 2D layout, so the layers sit and scroll
  as in 2D), on a plane the layer's `depth` behind the blocks (default `PARALLAX_DEPTH_STEP`, 200,
  per place from the front), sized so a picture px of a draw covers a picture px on screen,
  drawn first (`renderOrder` negative, no depth test or write), behind everything. A frame layer
  is a texture cut from `sheets` (`frameTexture`, shared with the HUD; alpha-tested, so opaque
  and drawn before the blocks); without `sheets` only gradients show. `parallax.draws()` and
  `parallax.meshes()` read it.
- HUD (Engine 0.15, gap G33, decision 4, item 281): `hud` is a `HudLayer`, a second scene with an
  `OrthographicCamera` spanning the picture in picture pixels (0 to `width`, y down as negative
  y). Each `sync` lays the HUD out with the core `layoutHud(skin, frame.status, ...)` (the one
  layout the Canvas2D presenter draws too; change it there, not here), splits text into font
  glyphs (`hudGlyphs`) and places one quad per item, in order (`renderOrder`), from a pool:
  a sprite frame is a `DataTexture` of the frame's pixels (cut from the sheet's decoded pixels,
  rows flipped for GL, nearest-neighbour, sRGB, `alphaTest` 0.5), cached per sheet, palette and
  frame; a heart or icon whose frame is missing is a flat box in `sheets.fallbackColor`. A glyph
  the font lacks draws nothing (as `Renderer.text`). Without `sheets` every heart and icon is a box
  and text draws nothing. `hud.quads()` lists the quads shown (`HudQuad`: kind, box, sheet,
  palette, frame or colour) for tests. A skin with no `hud` (or a frame with none of its status
  keys) shows no quads.

It never changes the frame or the skin (tested with frozen ones) and knows no game or kit. No
`Math.random`, `Date.now` or `performance.now` in this folder's code (a test checks); Three's own
object UUIDs use randomness internally, which is fine: they never reach a state or a hash.

## ThreePresenter (browser only)

`new ThreePresenter(canvas, skin, opts?)` implements the core `Presenter`: `present(frame)` syncs
its `ThreeScene` (`presenter.scene`) and draws it with `presenter.renderer`, a `WebGLRenderer` on
`canvas` (an `HTMLCanvasElement` or `OffscreenCanvas`); `resize(size)` changes the picture size.
Options mirror `SkinnedCanvasPresenter` where they apply: `size?` (else `frame.size`),
`onSound?(id)`, `background?` (default the skin's `background`, else `#000`), `clamp?` (the skin's `camera.clamp`, else true), `reduceFlashing?`, `shakeScale?`, `subPixelShake?`,
`onHitPause?`, `sheets?`; they are passed on to the scene (and `withSkin`'s scenes);
`effectSettings(settings)` changes the flashing and shake settings on all of them. Each frame draws the scene, then (when it shows any quad) the scene's HUD pass over it
with `autoClear` off and the depth cleared. So a paused frame draws the same every time on one machine, the renderer is fixed:
`antialias: false`, `preserveDrawingBuffer: true` (screenshots read the buffer after drawing),
pixel ratio 1, `SRGBColorSpace` output, no shadows, clear colour `background` (the option, else the skin's, else black). The drawing buffer
is the picture size (`setSize(w, h, false)`: the CSS size is left to the page). `rendererInfo()`
reads the context's renderer (below); `dispose()` frees the scene and the renderer.
`withSkin(skin, opts?)` (Engine 0.7 T8) is another `Presenter` on the same canvas and renderer
with a `ThreeScene` of its own (`.scene`; `opts` as above but `size`, which is this presenter's):
for a second frame source in one stream, such as a stacked mini game's frames in another kit's
skin. Each scene clears to its own skin's `background` (black by default). Each draws its own scene with the one WebGL context; `dispose()` frees them all.

## Screen transitions (`transition.ts`, Engine 0.16 T5)

`TransitionLayer` is the screen transition pass: an `OrthographicCamera` over the picture in
picture px (as the HUD's) and one full-picture quad with a small `ShaderMaterial` whose fragment
shader works out each pixel's cover from the core `TransitionShape` (`@engine/core/fx`) exactly
as `transitionAlphaAt` does (a fade's alpha, a wipe's soft-edged band along its travel, an
iris's hole), the colour through Three's colour space (`colorspace_fragment`). `sync(shape, size)`
sets the uniforms (`uKind`, `uColor`, `uAlpha`, `uDir`, `uSize`, `uLead`, `uTrail`, `uEdge`,
`uCentre`, `uRadius`) and hides the quad for null; `shown` reads it back; it runs in Node.
`ThreePresenter.transition(view)` (what `threeDisplay`'s `transition` calls) keeps the view; each
draw then syncs `transitionShape(view, size, scene.focus())` and renders the pass last, after the
HUD (`presenter.transitionLayer`). `ThreeScene.focus()` is the camera's target on the z = 0 plane
projected onto the picture (picture px), or null: where an iris closes.

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

### Known gaps

- Same-layer entities are not ordered by list order (they share a depth plane).
- The HUD and particles (gap G33) are drawn from Engine 0.15 (above); a kind's `blend` and `glow`
  are 2D only, and particle sprite frames draw as squares.

## The page's display (`display.ts`, Engine 0.7)

`threeDisplay(canvas, { screen, skin, rounds?, background?, integerScale?, onSound?, onHitPause?, sheets? })` is the 3D
`BrowserDisplay` (`@engine/core/shell`) a game hands `bootBrowserGame`, or a sentence saying why
it cannot start: `webgl2Available()` is false (no WebGL 2), or `ThreePresenter` threw (the
message names the error). Its `presenter` is a `ThreePresenter` with the game's `three` skin on
the page's canvas; with `rounds` (a skin per mini game id, the core `skinSet`'s `rounds`: the
game's `three-<id>.json`, Engine 0.7 T8) it is the core `presenterBySkinSet` over that and one
`withSkin` presenter per round skin (each on its own skin's `background`, black by default;
`background` overrides the game's own skin only), so a frame whose `status.miniGame` names
one is drawn through its skin; `fit(layout)` places the canvas with `fitCanvas` + `applyCanvasBox` from the
layout's `fit`; its `renderer` draws nothing (scenes show frames through the presenter) and
`present()` does nothing. A game reaches it with `await import('@engine/backends/three')` so its
2D page loads no Three.js (moved from `games/platformer-lab/main3d.ts`).
`sheets` (gap G33) goes to the game's scene and every round's, for their HUD.
`threeScenePresenter(skin, { screen, background?, rounds?, sheets? })` is a `Presenter` over the Node-side
`ThreeScene` (`present` is `sync`; `.scene` for read-outs): what tests use to check what 3D shows
(backend parity) with no WebGL. With `rounds`, a mini game's frames go to a scene of their own
(`.rounds[id]`, each clearing to its skin's `background`), as on the page; `.shown` is the scene the last frame went to.

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
and alpha, the fallback box, a skin's tag look (built for the tag, rebuilt when the look changes; a `prefix` look with a range
rebuilt only when a `progress:` value crosses into it, M2), the scene's background (the skin's,
black without one, the option first; G36), the camera framing the same world box as `CameraFollower` (corners
projected to the picture's corners), hint framing, zoom, tilt and shake, lights, sounds once per
event (by the event's `result` field, falling back to the bare type), `poses` swapping the mesh by
frame and their frame events played once (Engine 0.16 T2), the flash overlay, frozen frames and skin never changed, and repeatable builds.
`renderer-info.test.ts` checks `isSoftwareRenderer` on software strings (SwiftShader, ANGLE on
SwiftShader, llvmpipe, softpipe, Microsoft Basic Render) and typical hardware ones (ANGLE on
NVIDIA, AMD, Intel and Apple, Mesa, Adreno), and `webglRendererInfo` with a fake context with and
without the debug extension. `fit.test.ts` checks `fitCanvas` against `fitGame` and
`canvasToScreen`. `display.test.ts` checks `threeScenePresenter` (with and without round skins)
and the no-WebGL 2 message. `hud.test.ts` (gap G33) checks the HUD pass against an inline sheet
lookup: one quad per item of `frame.status` where the 2D layout puts it (hearts, an icon, font
glyphs, a missing frame's box), the orthographic camera, a texture cut from the sheet with its
rows flipped, quads following the status each frame, boxes without sheets, `threeScenePresenter`
handing `sheets` to the round scenes, and particles (an old effect flying out for its ticks from a
point or an entity's centre, each buffer capped at `PARTICLE_POOL`, an additive kind emitter in the
additive buffer and in the normal one under reduced flashing, stopping when its entity goes).
`camera-fx.test.ts` (Engine 0.16 T4) checks the scene's trauma shake on both axes decaying (the
same each run), the hit-pause request once per event and the shake scale, a zoom punch's view
widths there and back with its corners on the picture's, an event flash on the overlay fading,
reduced flashing and `effectSettings`, and the parallax planes: each quad's corner projected to
where the 2D layout draws it, on the camera behind the blocks with no depth test, layers moving
at their own rates, and gradients only without sheets. `transition.test.ts` (Engine 0.16 T5) checks the transition pass's
uniforms for a fade, a wipe and an iris, and `ThreeScene.focus()` centred and at the map's edge.
WebGL drawing (`ThreePresenter`) is not tested in Node; it needs a browser
(`tests/browser/fx-lab.test.ts` shoots the lab's transitions in 3D too).
