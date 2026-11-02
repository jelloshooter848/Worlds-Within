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
  rotate and alpha, a fallback box for unlisted kinds); the `PerspectiveCamera` is framed by the
  shared `CameraFollower` at the distance where the z = 0 plane shows exactly the picture (so 2D and
  3D frame the same world box), with `zoom` by distance, `tilt` and shake; one ambient and one
  directional light; `onSound(id)` once per event (by `resolveSkinEvent`); flash and tint as a full-screen overlay. The HUD
  and particles are not drawn (known gaps; moved to 0.15, gap G33 of the stacking test).
- `ThreePresenter`, `ThreePresenterOptions` (`presenter.ts`, browser only):
  `new ThreePresenter(canvas, skin, { size, onSound, background, clamp, reduceFlashing })`
  implements the core `Presenter`; `present(frame)` syncs a `ThreeScene` and draws it with a
  `WebGLRenderer` set up to draw a paused frame the same every time on one machine (no antialias,
  `preserveDrawingBuffer`, pixel ratio 1, sRGB output, fixed clear colour `background`, buffer at
  the picture size); `resize(size)`; `rendererInfo()`; `dispose()`; `withSkin(skin, opts?)`
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
  a stacked mini game's frames are drawn through their own skin.

## Imports allowed

- `@engine/core/*`, files in this folder, the `three` package (pinned exactly; only this folder
  may import it, per `PACKAGES` in `config/layers.js`) and browser APIs.
- Never other backends, `engine/sim`, `engine/tools`, kits or games.

## How to test

`pnpm test` runs in Node: `scene.test.ts` (inline fixture frames and an inline `three` skin; it
reads the built scene graph and projects points through the camera), `renderer-info.test.ts`
(software and hardware renderer strings, a fake WebGL context with and without the debug
extension), `fit.test.ts` (`fitCanvas` against `fitGame`) and `display.test.ts`
(`threeScenePresenter`, the no-WebGL 2 message). `ThreePresenter` and
`applyCanvasBox` are browser only: in Node they only typecheck. They are exercised in Playwright
Chromium by the 3D play page and `pnpm cli screenshot --backend three`, which skip cleanly where no
browser is installed.
