# engine/backends/three

The 3D backend (Engine 0.6, "Basic 3D backend"): shows any presentation frame
(`@engine/core/present`) as a 2.5D Three.js scene through a `three` skin, side-on with
perspective, in the style of New Super Mario Bros. It reads the same snapshot as the Canvas2D
backend and holds no game rules. `index.ts` exports `ThreeScene` (`scene.ts`), the WebGL
`ThreePresenter` (`presenter.ts`), the renderer check (`renderer-info.ts`), the canvas fit helper
(`fit.ts`), the page's display (`display.ts`: `threeDisplay`, `threeScenePresenter`,
`webgl2Available`), the primitive geometry helpers (`geometry.ts`: `primitiveGeometry(shape, size)`,
`GeometryCache`), the HUD pass (`hud.ts`: `HudLayer`, `HudQuad`, `frameTexture`), the parallax planes (`parallax.ts`:
`ParallaxPlanes`, `PARALLAX_DEPTH_STEP`, Engine 0.16 T4), the glTF models (`models.ts`:
`ModelLibrary`, `ModelInstance`, Engine 0.16 T11) and `PARTICLE_POOL`.

Node vs browser: `scene.ts`, `hud.ts` (no canvas: its textures are `DataTexture`s), `models.ts`
(three's `GLTFLoader` parses a GLB from bytes with no WebGL or DOM), `geometry.ts`, `renderer-info.ts` and `fitCanvas` / `canvasToScreen`
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
`fonts?` (Engine 0.16 T6, a `FontLookup`, `contentFonts(content)`: the HUD's font files),
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
- Lights: one `AmbientLight` and one `DirectionalLight` (`camera3d.lights`), no shadows, unless
  the skin's `scene3d` says more (Engine 0.16 T12, below).
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
  From Engine 0.16 T6 a skin whose `hud` has a UI kit item is laid out whole by `@engine/core/ui`'s
  `SkinHud` (with the map the scene shows, for a minimap, and the layer's own clock, one tick per
  `sync`, for a counter's roll) and painted into quads: a fill is a `fill` quad (a flat colour,
  `opacity` below alpha 1; a classic item's missing-frame stand-in stays a `box`), an image a
  `sprite` quad whose texture is the frame's part (`part`, cut with `frameTexture`, cached per
  part) scaled to its box (nine-slice pieces), a glyph a `glyph` quad with a texture of its ink in
  its colour (cached per font, character and colour). The `fonts` option (`contentFonts(content)`)
  gives the font files; `ThreePresenter`, `withSkin`, `threeDisplay` and `threeScenePresenter`
  pass it on, and the screenshot page does. Every HUD material is transparent (in Three's
  transparent list), so `renderOrder` alone stacks the quads: before, an opaque missing-frame box
  was drawn before every textured quad.

It never changes the frame or the skin (tested with frozen ones) and knows no game or kit. No
`Math.random`, `Date.now` or `performance.now` in this folder's code (a test checks); Three's own
object UUIDs use randomness internally, which is fine: they never reach a state or a hash.

## glTF/GLB models (`models.ts`, Engine 0.16 T11)

A 3D skin's kind or tile entry may name a model in the game's `assets/` beside its text mesh:
`model: "assets/<pack>/<file>.glb"` (or `.gltf`), `scale` (px per model unit), `anchor`
(`bottom`, the default: the model's bounding box's bottom centre on the box's bottom centre;
`center`: its centre on the box's centre; `origin`: the model's origin; or a model point
`{ x, y, z }`), `rotate` (`{ x?, y?, z? }` degrees, applied before scale and anchor), `clip` (a
kind: one name or animation state -> clip name, falling back to `idle`'s; a tile: one name) and
`castShadow` (set on the meshes; shadows show when the skin's `scene3d.sun` has a `shadow`,
Engine 0.16 T12). The schema,
`resolveSkinModel(skin, entity)`, `resolveTileModel(entry, frame)`, `modelClipFor` and
`skinModelUses` are in `@engine/core/present`; `validate`'s checks (`missing_file`, `bad_model`,
`missing_clip`, the credits) in `@engine/core/content/assets.ts`.

- `ModelLibrary(assets)` holds the game's asset files (`content.assets`, data URLs). `load(path)`
  parses one model once with `GLTFLoader.parseAsync` (a `.gltf` is first packed into a GLB by the
  core's `gltfToGlb`, so its embedded buffers need no fetch: Node has no `ProgressEvent` for
  three's file loader) and caches its scene and clips; a missing or broken file resolves to null
  (`status(path)`: `missing`, `loading`, `ready`, `failed`; `error(path)`). `get(path)` gives the
  model or null, starting the load. `preload(skins)` loads every model the skins name;
  `dispose()` frees the cached geometries and materials.
- `ModelInstance(model, spec, box)` is one entity's (or tile cell's) copy: a `SkeletonUtils`
  clone with its own materials (geometries shared), `rotate`d, scaled and placed by `anchor`
  from its rest-pose bounds, then moved by the entry's `offset` (px, y down) and `z`, its meshes
  `castShadow` as the entry says. `pose(clip, time)` plays a clip by name with an
  `AnimationMixer` set to exactly `time` seconds (looped), so the same frame always shows the
  same pose; a new clip stops the old one (its tracks go back to the rest pose), null or an
  unknown name shows the rest pose. `playing`, `meshes()`, `dispose()`.
- `ThreeScene`'s `models` option: an entity whose entry has a `model` is built from it once
  `models.get` has it (`userData.model`), its text mesh until then (`userData.loading`; also
  forever without the option), and rebuilt when it arrives; while it shows the model, `poses`
  frames do not rebuild it, and each frame poses the clip for its `anim.state` at `anim.t` /
  `MODEL_TICKS_PER_SECOND` (60). A tile with a loaded model is one instance per cell (named
  `tile:<key>:model`, at the cell's bottom centre) instead of instanced blocks, posed each frame
  on `frame.frame` / 60; a map built while a tile model was loading is rebuilt once it is there.
  Entries without a `model` are built exactly as before. `ThreePresenter`, `withSkin`,
  `threeDisplay` and `threeScenePresenter` pass `models` on; the screenshot page and the fx lab's
  page make one from `content.assets` and await `preload` before the first frame.

## Lights, shadows, fog, tone mapping and labels (Engine 0.16 T12)

The skin's `scene3d` (`@engine/core/present`'s `scene3d.ts`: `resolveScene3d(skin.scene3d,
camera3d.lights)` fills the defaults; `ThreeScene.look` is the result) sets the scene up:

- `sun` `{ color, intensity, direction, shadow? }`: the `DirectionalLight` (`sun`), placed at
  `direction` (default `DEFAULT_SUN_DIRECTION`, -1, 2, 3, where it always was). With a `shadow`
  `{ mapSize, bias, radius }` it casts: each frame the sun moves to shine from its direction onto
  the view's centre on the z = 0 plane (its `target`, updated by hand, not added to the scene),
  and its orthographic shadow camera covers the view's diagonal plus `SHADOW_MARGIN` (64 px);
  `normalBias` 0.5 against acne on the low-poly faces. Without one, nothing moves.
- `ambient` `{ color, intensity }` (the `AmbientLight`) and `hemisphere` `{ sky, ground,
intensity }` (a `HemisphereLight`, `hemisphere`, added only when given).
- `fog`: `linear` `{ color, near, far }` given in px behind the z = 0 plane (each frame Three's
  `Fog` gets them plus the camera's distance, so zoom does not move it), or `exp2` `{ color,
density }` (`FogExp2`). It shows on the blocks far behind and on the parallax planes (their
  `MeshBasicMaterial`s take fog); the overlay, particles, HUD and labels never.
- `toneMapping` `{ kind: aces | agx | none, exposure }` and `colorSpace` (`srgb` | `linear`): read
  by the presenter (`applyLook`) before each draw of that scene. HUD, label and overlay materials
  have `toneMapped: false`, so the HUD keeps its colours under any tone mapping.
- A kind's `light` `{ kind: point, color, intensity, distance, decay? (POINT_LIGHT_DECAY, 1),
offset? (mesh space from the box's centre, y down), flicker? }` is a `PointLight` child of each
  entity's root (named `light:<id>`, removed with it); `flicker` scales its intensity down by up
  to that share each frame from `fxRng(seed, frame, "light:<id>")`, so a frame always looks the
  same. `pointLights()` lists them.
- `castShadow` / `receiveShadow` on a kind (its text-mesh parts or its model's meshes) and on a
  tile (its `InstancedMesh`es, or each tile model's meshes).

A skin without `scene3d`, `light`, `receiveShadow` or `labels` gives exactly the scene objects
it gave before (tested in `lighting.test.ts`), and the presenter draws it with no shadow map, no
tone mapping and sRGB output, as before.

**Labels.** The skin's `labels` (kind -> a label or a list: `{ from?: id | kind | { tag } |
{ status }, as: text | bar | timer, format?, max?, font?, color?, shadow?, outline?, back?,
border?, w?, h?, anchor?: top | center | bottom, offset? }`) are laid out each `sync`, after the
camera: for each entity of a listed kind each label's anchor (the box's top centre, centre or
bottom centre, at its layer's depth) is projected through the camera to picture px; a point
behind the camera (in front of its near plane) or outside the picture hides that label. The core
`layoutLabels` (`@engine/core/ui`) places them (centred, the `offset` added, default 2 px above;
labels on one anchor stack away from the box) and gives `UiDraw`s, which `labels` (a second
`HudLayer`) paints with `syncDraws`. The presenter draws `labels` after the scene and before the
HUD. `labelViews()` reads what shows (`LabelView`: entity, kind, type, text or bar, box). Text
needs the `fonts` option (a label whose font is missing draws nothing).

## Ground view (Engine 0.16 F2)

A skin with `camera3d.view: "ground"` (with `pitch`, 10-90 degrees down from the horizon, default
55, and `yaw`, -180-180 degrees about the vertical, default 0: looking north) shows a top-down map
as a floor under a pitched camera. A skin without it (`view` defaults to `side`) builds exactly the
scene objects it built before: the side-view code path is unchanged (`scene.test.ts`,
`lighting.test.ts` and the rest pass as they were).

- Axes: world (x, y) lies on the ground: Three's `(x, height, y)`. The camera comes from the core
  `groundProjection(size, zoom, centre, camera)` (`@engine/core/present`'s `ground.ts`): its
  eye, and its turn as Euler `(-pitch, yaw, 0, 'YXZ')`, looking at the framed view's centre from
  the distance the zoom gives (the picture's height shows `height / zoom` world px when looking
  straight down). `RtsCamera` picks through the same function, so drawing and picking cannot
  drift: `ground.test.ts` checks Three's projected points against the core's within 0.5 px at
  three yaws and zooms. `groundProjection` (getter) is last frame's projection without shake.
- Framing: `CameraFollower` with no clamp (a 2D box clamp does not fit a pitched view, so the
  hint's centre is shown as it is; `RtsCamera` keeps the ground footprint over the map), and no
  area for zoom punches. Shake moves the centre along the picture's axes on the ground.
- Map: every layer's cells on the floor (height 0). A tile part's `at.x`, `at.y` place its
  footprint on the cell, `at.z` is the height of its bottom and its `d` (a primitive's `depth`) its
  height, so a box tile with `depth: 2` is a 2 px slab and round shapes stay upright; a `plane`
  lies flat. Tile models stand on the cell's centre.
- Entities: the root is the box's centre on the ground, lifted `layer` x `GROUND_LAYER_LIFT`
  (0.05 px, so flat marks over the floor never flicker); parts are placed as tiles' are, about
  the box's centre. Facing turns the root about the vertical (`groundFacingTurn(facingVector(f))`:
  `down`, toward a yaw-0 camera, is a model's front, +z; `right` a quarter turn; diagonals in
  between), never mirrors; `fx.rotate` turns it clockwise seen from above, `squashX` scales width
  and depth, `squashY` height. Models stand as modelled (y up).
- Labels: the anchor is over the box's centre at the top of the entity's meshes (its parts' tops,
  or its model's bounds), half way up (`center`) or on the ground (`bottom`), projected with this
  frame's projection (shake included).
- Particles fly at their world (x, y) on the ground, `GROUND_PARTICLE_HEIGHT` (8 px) up: the 2D
  particle model has no height, so a burst spreads over the ground and a rising flame drifts north.
- Shadows: the sun shines onto the centre of the picture's ground footprint (`footprint()`: the
  picture's corners on the ground, a ray over the horizon capped at `GROUND_REACH` camera
  distances) and its shadow camera covers that footprint's bounds' diagonal plus `SHADOW_MARGIN`.
  Linear fog is measured from the camera's distance to the centre, as in side view. The overlay,
  `CameraFx` (flash, zoom punch, trauma shake) and parallax planes work as in side view.
- `games/fx-lab`'s `content/skins/ground.json` and `ground.ts` are the worked example (a meadow,
  Pip and beetles turning, labels, braziers with light and flame); its page
  `games/fx-lab/ground/` is built and shot by `tests/browser/fx-lab-ground.test.ts`.

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
pixel ratio 1, `SRGBColorSpace` output, no shadows (from Engine 0.16 T12 the scene's `look`
sets shadows, tone mapping and the output colour space before each draw; PCF shadow filtering,
which honours `shadow.radius`), clear colour `background` (the option, else the skin's, else black). The drawing buffer
is the picture size (`setSize(w, h, false)`: the CSS size is left to the page). `rendererInfo()`
reads the context's renderer (below); `dispose()` frees the scene and the renderer.
`withSkin(skin, opts?)` (Engine 0.7 T8) is another `Presenter` on the same canvas and renderer
with a `ThreeScene` of its own (`.scene`; `opts` as above but `size`, which is this presenter's):
for a second frame source in one stream, such as a stacked mini game's frames in another kit's
skin. Each scene clears to its own skin's `background` (black by default). Each draws its own scene with the one WebGL context; `dispose()` frees them all.

## UI screens over the picture (Engine 0.16 T9)

`HudLayer.syncDraws(draws, size)` places any UI kit draw items as the HUD's quads (the same
painter as a UI HUD). `ThreePresenter.overlay` is one such layer and `ThreePresenter.ui(draws)`
draws it over the frame drawn last (depth cleared, no clear), but only when a frame was drawn
since the last call, so a translucent panel never darkens itself. `threeDisplay`'s `uiPainter()`
collects the shell's menu draws while the scenes draw and `present()` hands them to `ui`; its
`effectSettings` is the presenter's. The overlay is drawn after the transition pass, so a menu
shows over a transition (the shell's menus close or open under a fully covered picture).

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
handing `sheets` to the round scenes, from Engine 0.16 T6 a UI kit HUD (panel pieces as frame
parts, fills, a glyph's coloured texture, every material transparent in draw order, and a
classic skin kept on the old layout), and particles (an old effect flying out for its ticks from a
point or an entity's centre, each buffer capped at `PARTICLE_POOL`, an additive kind emitter in the
additive buffer and in the normal one under reduced flashing, stopping when its entity goes).
`camera-fx.test.ts` (Engine 0.16 T4) checks the scene's trauma shake on both axes decaying (the
same each run), the hit-pause request once per event and the shake scale, a zoom punch's view
widths there and back with its corners on the picture's, an event flash on the overlay fading,
reduced flashing and `effectSettings`, and the parallax planes: each quad's corner projected to
where the 2D layout draws it, on the camera behind the blocks with no depth test, layers moving
at their own rates, and gradients only without sheets. `transition.test.ts` (Engine 0.16 T5) checks the transition pass's
uniforms for a fade, a wipe and an iris, and `ThreeScene.focus()` centred and at the map's edge.
`lighting.test.ts` (Engine 0.16 T12) checks a plain skin's lights and objects unchanged, every
`scene3d` field on the scene (sun, ambient, hemisphere, shadow map and camera round the view, fog
in camera distance, tone mapping, exp2 fog, AgX and linear output), shadow flags on kinds and
tiles, a kind's point light (placed, flickering the same each seed, gone with its entity) and
labels (projected to the picture px a tilt-0 camera gives, stacked, a timer below, quads on the
labels layer, hidden off screen and behind the camera, skipped without a value or font).
`models.test.ts` (Engine 0.16 T11) parses an inline model (written with the core's
`lowPolyModel`) as a GLB and as an embedded `.gltf` in Node, checks missing and broken files,
each anchor, scale, rotate and offset by the instance's bounds, clips posed at exact times (set,
not added) and let go, own materials and shared geometry, `castShadow`, and in a `ThreeScene` the
text mesh while loading then the model, text-mesh kinds unchanged and nothing but text meshes
without a library, the clip mapped from the anim state, tile models per cell rebuilt once, and
repeatable builds over a frozen frame and skin.
WebGL drawing (`ThreePresenter`) is not tested in Node; it needs a browser
(`tests/browser/fx-lab.test.ts` shoots the lab's transitions in 3D too).
