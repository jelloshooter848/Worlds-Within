# engine/backends/three

Folder: `engine/backends/three`. Detailed rules:
[`engine/backends/three/CLAUDE.md`](../../engine/backends/three/CLAUDE.md).

## Purpose

The 3D backend (Engine 0.6). It shows any `PresentFrame` (`@engine/core/present`) as a side-on
2.5D Three.js scene through a `three` skin (text-defined low-poly meshes), reading the same
snapshot as the Canvas2D backend. It builds the scene in Node without WebGL, so it is tested
there; a WebGL presenter draws it in the browser. It holds no game rules.

## Public API entry points

`index.ts`, imported as `@engine/backends/three`:

- `ThreeScene`, `ThreeSceneOptions` (`scene.ts`): `new ThreeScene(skin, { onSound, size, ... })`;
  `sync(frame)` keeps `scene` and `camera` up to date. Map tiles become instanced blocks built once
  per map id and version (layers behind at their own depth); entities become meshes by id
  (bottom-centre roots, `layer` to z through `camera3d.layerDepth`, facing-left mirror (the left-hand diagonals mirror too), squash,
  rotate and alpha, a fallback box for unlisted kinds, a skin's tag look by `resolveSkinKind` (whole
  tag, or from Engine 0.15 a prefix with a whole-number range, gap M2), rebuilt when the look
  changes, and from Engine 0.16 T2 when a kind's `poses` frame names another mesh); the scene's background is the skin's `background` (Engine 0.15, gap G36; black without
  one, a `background` option first); the `PerspectiveCamera` is framed by the
  shared `CameraFollower` at the distance where the z = 0 plane shows exactly the picture (so 2D and
  3D frame the same world box), with `zoom` by distance, `tilt` and shake; one ambient and one
  directional light (from Engine 0.16 T12 the skin's `scene3d` look: sun colour, strength,
  direction and soft shadows, ambient and hemisphere colours, linear or exp2 fog, tone mapping
  and output colour space, `look`; a kind's flickering point `light`, `pointLights()`;
  `castShadow`/`receiveShadow` on kinds and tiles; without `scene3d` lit exactly as before);
  world-anchored labels (Engine 0.16 T12: the skin's `labels`, names, bars and timers laid out by
  `@engine/core/ui`'s `layoutLabels` at each entity's anchor projected to the picture, hidden off
  screen or behind the camera, on the `labels` HUD layer; `labelViews()`); `onSound(id)` once per event (by `resolveSkinEvent`) and per frame event of a `poses` cycle; flash and tint as a full-screen overlay;
  particles (Engine 0.16 T3: the skin's `emitters`, events' and kinds' `emit`, old `particles`
  effects) as two `Points` buffers, normal and additive, of at most `PARTICLE_POOL` each
  (`particles`, `particleViews()`). Camera effects (Engine 0.16 T4) as in 2D: trauma shake on x
  and y, zoom punches by distance, event flashes on the overlay (skipped with `reduceFlashing`),
  `onHitPause`, `shakeScale`, `effectSettings`; from Engine 0.16 F2 a ground view (the skin's
  `camera3d.view: "ground"`, `pitch`, `yaw`): the map on the floor, entities standing on their
  box centres turned to their facing about the vertical, the camera from the core
  `groundProjection` that `RtsCamera` picks through (`groundProjection` read-out; labels at
  projected anchors, particles over the ground, the sun's shadow camera over the picture's ground
  footprint, fog and camera effects as in side view; `GROUND_LAYER_LIFT`,
  `GROUND_PARTICLE_HEIGHT`), side-view skins unchanged; the skin's `parallax` layers as `ParallaxPlanes`
  (`parallax.ts`): quads on planes at each layer's `depth`, hung on the camera and drawn first,
  placed where the 2D layout draws them (`parallax.draws()`, `meshes()`). The HUD (Engine 0.15,
  gap G33): `hud`, a `HudLayer` (`hud.ts`) that draws the core `layoutHud` items for
  `frame.status` through the skin's `hud` as an orthographic pass of textured quads in picture
  pixels (`DataTexture`s cut from the decoded pixel art the `sheets` option gives, a
  `PixelSheetLookup` such as `contentPixelSheets(content)`; nearest-neighbour; no canvas, so it
  runs in Node); `hud.quads()` lists what it shows. From Engine 0.16 T6 a skin with UI kit items
  is laid out by `@engine/core/ui`'s `SkinHud` and painted as quads (`fill`, a frame part for a
  nine-slice piece, a `glyph` texture per font, character and colour; the `fonts` option on the
  scene, `ThreePresenter`, `threeDisplay` and `threeScenePresenter`); every HUD material is
  transparent, so `renderOrder` alone stacks them.
- `ThreePresenter`, `ThreePresenterOptions` (`presenter.ts`, browser only):
  `new ThreePresenter(canvas, skin, { size, onSound, background, clamp, reduceFlashing, sheets })`
  implements the core `Presenter`; `present(frame)` syncs a `ThreeScene` and draws it with a
  `WebGLRenderer` set up to draw a paused frame the same every time on one machine (no antialias,
  `preserveDrawingBuffer`, pixel ratio 1, sRGB output, fixed clear colour (the `background` option, else the skin's, else black), buffer at
  the picture size, or from Engine 0.16 F3 that times `renderScale` (the option, else the skin's
  `scene3d.renderScale`: supersampled, the HUD, labels, menus and transitions laid out in picture
  px and drawn scaled), then the scene's labels and HUD passes over it; from Engine 0.16 T12 each
  draw sets the renderer from the scene's `look` (shadow map on with PCF filtering when the sun
  casts shadows, ACES or AgX tone mapping and exposure, sRGB or linear output), and HUD, label and
  overlay materials are never tone mapped or fogged; `resize(size)`; `rendererInfo()`; `dispose()`; `withSkin(skin, opts?)`
  (Engine 0.7): another presenter on the same canvas and renderer with its own skin and scene (a
  stacked mini game's frames).
- `webglRendererInfo`, `isSoftwareRenderer`, `GlInfoSource`, `WebglRendererInfo`
  (`renderer-info.ts`, pure): the unmasked vendor and renderer through `WEBGL_debug_renderer_info`
  (else `VENDOR` / `RENDERER`), and whether a renderer string is a software rasteriser
  (SwiftShader, llvmpipe, softpipe, "Software", Microsoft Basic Render).
- `fitCanvas`, `applyCanvasBox`, `canvasToScreen`, `CanvasBox` (`fit.ts`): letterbox the WebGL
  canvas with the `fitGame` maths the Canvas2D `Viewport` uses (CSS only; the buffer stays the
  picture size), and map client points back to game px.
- `primitiveGeometry`, `GeometryCache`, `PartSize` (`geometry.ts`): the Three geometry of each skin
  primitive (`box`, `wedge`, `cylinder`, `cone`, `sphere`, `plane`), low-poly.

- `threeDisplay`, `ThreeDisplayOptions`, `webgl2Available`, `threeScenePresenter`
  (`display.ts`, Engine 0.7): the page's 3D `BrowserDisplay` for `bootBrowserGame`
  (`@engine/core/shell`), or why it cannot start (no WebGL 2), and a Node-side `Presenter` over
  `ThreeScene` for tests. Both take `rounds` (a skin per mini game id, the core `skinSet`'s), so
  a stacked mini game's frames are drawn through their own skin, and `sheets` (the decoded pixel
  art every skin's HUD draws from).
- `TransitionLayer` (`transition.ts`, Engine 0.16 T5): the screen transition pass, one
  full-picture quad with a small `ShaderMaterial` working out each pixel's cover as the core
  `transitionAlphaAt` does, drawn by `ThreePresenter` after the HUD (`transition(view)`, which
  `threeDisplay` hands the shell's transitions; an iris closes on `ThreeScene.focus()`, the
  camera's target projected onto the picture).
- `ModelLibrary`, `ModelInstance`, `LoadedModel`, `ModelStatus` (`models.ts`, Engine 0.16 T11):
  glTF/GLB models in 3D skins. `new ModelLibrary(content.assets)` loads a skin's models with
  three's `GLTFLoader` from the game's asset files (a `.gltf` is packed into a GLB first, so
  nothing is fetched and it parses in Node without WebGL), each once, cached; `get(path)` starts a
  load and gives null until it is there, `preload(skins)` loads every model the skins name (the
  page and `pnpm cli screenshot --backend three` await it). The `models` option of `ThreeScene`,
  `ThreePresenter`, `withSkin`, `threeDisplay` and `threeScenePresenter` hands it to the scenes: a
  kind or tile whose skin entry has a `model` shows a `ModelInstance` (a clone with its own
  materials, turned by `rotate`, scaled by `scale`, placed by `anchor` on the box's bottom centre,
  moved by `offset` and `z`, `castShadow` on its meshes) once loaded and its text `mesh` until
  then; the clip for the entity's anim state plays at `anim.t` / 60 s through an
  `AnimationMixer` set to exactly that time (a tile's clip on the frame clock). Text meshes are
  built exactly as before.
- `HudLayer`, `HudQuad` (`hud.ts`) and `PARTICLE_POOL` (`scene.ts`): the HUD pass and the
  particle buffers' size (Engine 0.15, gap G33; 1024 from Engine 0.16 T3), and `PARTICLE_Z`.

## Imports allowed

- `@engine/core/*`, files in this folder, the `three` package (pinned exactly; only this folder
  may import it, per `PACKAGES` in `config/layers.js`) and browser APIs.
- Never other backends, `engine/sim`, `engine/tools`, kits or games.

## How to test

`pnpm test` runs in Node: `scene.test.ts` (inline fixture frames and an inline `three` skin; it
reads the built scene graph and projects points through the camera), `renderer-info.test.ts`
(software and hardware renderer strings, a fake WebGL context with and without the debug
extension), `fit.test.ts` (`fitCanvas` against `fitGame`) and `display.test.ts`
(`threeScenePresenter`, the no-WebGL 2 message) and `hud.test.ts` (the HUD pass's quads for a
frame's status, textures cut and flipped from a sheet, the round skins' HUD through
`threeScenePresenter`, particles and their pool) and `transition.test.ts` (the transition pass's
uniforms for each kind, `ThreeScene.focus()`; Engine 0.16 T5) and `models.test.ts` (Engine 0.16
T11: a GLB and an embedded `.gltf` parsed in Node, missing and broken files, anchors, scale,
rotate and offset by the model's bounds, clips posed at exact times and let go, own materials,
the text mesh while loading then the model, the clip from the anim state, tile models per cell,
text-mesh kinds unchanged) and `lighting.test.ts` (Engine 0.16 T12: a skin without `scene3d`
keeping its lights and objects, the sun, ambient, hemisphere, shadows, fog and tone mapping from
the skin, shadow flags on kinds and tiles, point lights flickering the same each run, labels
projected to the right picture px, stacked and hidden off screen or behind the camera) and
`decor.test.ts` (Engine 0.16 F3: a 48 x 32 map of tile models as one `InstancedMesh` per tile key
and model mesh, instances placed as a `ModelInstance` would be, `vary` per seed, the skin's decor
grid instanced per character and model or copied per cell, `places` labels in ground and side
view, the render scale).
`tests/runs/presentation-invariance.test.ts` plays every run with the `lighting` switch on.
`ThreePresenter` and
`applyCanvasBox` are browser only: in Node they only typecheck. They are exercised in Playwright
Chromium by the 3D play page and `pnpm cli screenshot --backend three`, which skip cleanly where no
browser is installed; `tests/browser/platformer.test.ts` checks the platformer sample's HUD is
drawn at `?backend=three`.

## Engine 0.16 F3: crisp output, instanced tile models, decor and places

- `ThreePresenter({ renderScale?, decor? })`, `threeDisplay({ renderScale?, decor? })`,
  `ThreeScene({ renderScale?, decor? })`: the drawing buffer at `size * renderScale` (whole, 1-8;
  default the skin's `scene3d.renderScale`), every 2D pass still in picture px. `pnpm cli
screenshot --backend three --render-scale N` (default the skin's) is byte-identical on two runs.
- `modelMeshParts(model, spec, box)` (`models.ts`): a model's meshes with the matrices that place
  them as a `ModelInstance` does, for instancing (null for skinned models).
- Model tiles without a `clip` are one `InstancedMesh` per tile key and mesh, varied per cell by
  the tile's `vary` (`tileVariation`, the presentation RNG). The skin's `decor` (with
  `contentDecor(content)` as the `decor` option) places scenery per map id, and its `places`
  names regions on the label layer. See `engine/backends/three/CLAUDE.md`.
