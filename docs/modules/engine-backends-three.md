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
  (bottom-centre roots, `layer` to z through `camera3d.layerDepth`, facing-left mirror, squash,
  rotate and alpha, a fallback box for unlisted kinds); the `PerspectiveCamera` is framed by the
  shared `CameraFollower` at the distance where the z = 0 plane shows exactly the picture (so 2D and
  3D frame the same world box), with `zoom` by distance, `tilt` and shake; one ambient and one
  directional light; `onSound(id)` once per event; flash and tint as a full-screen overlay. The HUD
  and particles are not drawn in 0.6 (known gaps).
- `primitiveGeometry`, `GeometryCache`, `PartSize` (`geometry.ts`): the Three geometry of each skin
  primitive (`box`, `wedge`, `cylinder`, `cone`, `sphere`, `plane`), low-poly.

## Imports allowed

- `@engine/core/*`, files in this folder, the `three` package (pinned exactly; only this folder
  may import it, per `PACKAGES` in `config/layers.js`) and browser APIs.
- Never other backends, `engine/sim`, `engine/tools`, kits or games.

## How to test

`pnpm test` runs `scene.test.ts` in Node with inline fixture frames and an inline `three` skin; it
reads the built scene graph and projects points through the camera. WebGL drawing needs a browser
and is checked by the presenter and screenshot tasks.
