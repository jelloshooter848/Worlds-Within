# engine/backends/three

The 3D backend (Engine 0.6, "Basic 3D backend"): shows any presentation frame
(`@engine/core/present`) as a 2.5D Three.js scene through a `three` skin, side-on with
perspective, in the style of New Super Mario Bros. It reads the same snapshot as the Canvas2D
backend and holds no game rules. `index.ts` exports `ThreeScene` (`scene.ts`) and the primitive
geometry helpers (`geometry.ts`: `primitiveGeometry(shape, size)`, `GeometryCache`).

## ThreeScene

`new ThreeScene(skin, opts?)` builds a scene graph; it needs no WebGL and runs in Node. A renderer
(the WebGL `ThreePresenter`, Engine 0.6 T4) only draws `scene` with `camera`.
`opts`: `size?` (the picture to frame in; else `frame.size`; `resize(size)` changes it),
`onSound?(id)`, `background?` (`#000`), `clamp?` (true), `reduceFlashing?`.
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
  parts. Facing left mirrors x (scale -1); `fx.squashX`/`squashY` scale the root (so about the
  bottom centre); `fx.rotate` turns clockwise on screen (negative about z); `fx.alpha` sets each
  material's opacity (transparent below 1). A kind the skin does not list, or an entry with no
  mesh, is a fallback box of the entity's box, as deep as it is wide, in `sheets.fallbackColor`,
  else `DEFAULT_FALLBACK_COLOR` (`userData.fallback` is true). Same-layer entities share a depth
  plane: list order is not kept there (depth decides).
- Camera: a `PerspectiveCamera` framed by the core `CameraFollower` (shared with Canvas2D; change
  the framing there, not here) from the frame's hint (`follow`, `x`/`y`, `bounds`, `deadzone`,
  `lerp`) and the skin's `camera` defaults. `zoom` (the hint's, else the skin's, else 1) is honoured
  by distance: the view is the picture size divided by `zoom`, and the follower frames that view.
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

### Known gaps (Engine 0.6)

- HUD: `skin.hud` and `frame.status` are not drawn in 3D.
- `particles` effects are not drawn.
- Same-layer entities are not ordered by list order (they share a depth plane).

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
parts placed from the box, layer to z, the facing mirror, squash about the bottom centre, rotate
and alpha, the fallback box, the camera framing the same world box as `CameraFollower` (corners
projected to the picture's corners), hint framing, zoom, tilt and shake, lights, sounds once per
event, the flash overlay, frozen frames and skin never changed, and repeatable builds. WebGL
drawing is not tested here (it needs a browser).
