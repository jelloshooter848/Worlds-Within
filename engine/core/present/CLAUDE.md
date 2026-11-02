# engine/core/present

The presentation contract (docs/DESIGN.md, section 6; docs/ROADMAP.md, Engine 0.4): the read-only
snapshot a backend gets each frame. A kit describes what is there; a backend decides how it looks,
from the frame and a skin. Types and small pure helpers only: no drawing, no kit or backend code.

- `types.ts`: `PresentFrame` `{ frame, size, entities, map?, events, status, camera? }`.
  - `PresentEntity` `{ id, kind, x, y, w, h, facing, anim: { state, t }, tags, layer?, fx? }`:
    `id` is stable across frames; `x`/`y`/`w`/`h` are the box in world pixels (top-left); `facing`
    is `up | down | left | right`; `anim.t` is ticks since the state began.
  - `map` is either the full `PresentMap` `{ id, version, tileSize, cols, rows, tiles, layers?, tags? }`
    (`tiles` as text rows or a grid of tile ids; `tags?` free labels such as `dark`) or only a `PresentMapRef` `{ id, version }`.
    `isFullMap(map)` tells them apart. Bump `version` whenever any tile changes.
  - `PresentEvent` `{ type, x?, y?, entity?, ...any JSON-safe fields }`: this frame's events, for
    a skin's sounds and effects.
  - `status`: HUD values, `Record<string, number | string | boolean>`.
  - Extension points, all optional and all ignorable by a backend: `camera` (`CameraHint`
    `{ x, y, zoom?, follow?, shake?, deadzone?, lerp?, bounds? }`: `deadzone`, `lerp` and `bounds`
    override the skin's camera defaults for one frame; `bounds` is a world box the view stays
    inside, for a kit-side scroll lock), `layer` (depth, drawn low to high), `fx` (`PresentFx`
    `{ squashX?, squashY?, rotate?, alpha?, tint? }`) and the map's `layers`.
  - `DeepReadonly<T>` and the `Presenter` interface: `present(frame: DeepReadonly<PresentFrame>)`
    and optional `resize(size)`. Backends implement `Presenter`.
- `freeze.ts`: `freezeFrame(value)` deep-freezes a frame in place and returns it as
  `DeepReadonly`, so a backend that writes to it throws. Use it in tests and dev; it is not needed
  per frame in a release build.
- `map-tracker.ts`: `MapTracker.next(map)` returns the full map on the first frame and when the
  map's id or version changes, otherwise `{ id, version }`. `reset()` sends it again next time.
  Use one tracker per stream of frames.
- `schema.ts`: `presentFrameSchema`, a Zod schema for tests and tools (not run per frame). It
  checks finite numbers, that a full map's tiles (and layers) are `rows` x `cols`, and that event
  fields are JSON-safe. Unknown fields are errors everywhere except on events.
- `skin.ts`: skin files, the engine's `skin` content kind (`SKIN_KIND`, registered in
  `content/engine-kinds.ts`). One JSON file per backend: `{ backend, sheets?, kinds, tiles?,
events?, hud?, camera?, meshes?, camera3d? }`. `sheets` gives defaults (`sheet`, `palette`, `fallbackColor`) for
  entries that leave them out. A kind entry is 2D (`sheet`, `palette?`, `frames`, `flipFacing?`,
  `size?`, `fallbackColor`, `offset?`) or 3D (`mesh`, `color`, `scale?`, `depth?`, `z?`,
  `offset?`); a tile entry 2D (`sheet?`, `frame`, `fallbackColor`) or 3D (`mesh`, `color`,
  `depth?`, `z?`). The backend picks which (`MESH_BACKENDS`, today `three`), and a field of the
  other shape (including the skin-level `meshes` and `camera3d` on a 2D skin) is a
  `wrong_backend_field` error, a needed one left out `missing_field`. `frames` maps an animation
  state to a frame name, a cycle `{ frames, ticks? (default 8), loop? }` or a per-facing map
  `{ up?, down?, left?, right? }` of names or cycles. `tiles` maps a tile character or id to
  `{ sheet?, frame, fallbackColor }`; `events` maps an event type to `{ sound?, effect? }`
  (`effect.kind`: `flash`, `particles`, `shake`, `tint`); `hud` lists `{ status, as: hearts |
number | text | icon, x, y, sheet?, frame?, font? }`.
  - 3D (Engine 0.6; owner answer 22: procedural low-poly meshes written in the skin). A `mesh`
    is a primitive (`MESH_PRIMITIVES`: `box`, `wedge`, `cylinder`, `cone`, `sphere`, `plane`;
    round ones use `LOW_POLY_SEGMENTS`) that fills the entity box (or tile) and is `depth` px
    thick (default the box's width, so a tile is a one-tile block), or a key of `meshes`: a
    compound mesh, a list of parts `{ shape, size: { w, h, d }, at?: { x, y, z }, color?,
rotate? }` in world px (x right, y down, z toward the camera; `at` is the top-left corner in
    x/y and the centre in z; `rotate` is quarter turns about the upright axis). A `mesh` that is
    neither is `missing_ref` at that field; a `meshes` key may not be a primitive's name.
    `camera3d` `{ fov?, tilt?, layerDepth?, lights?: { ambient?, directional? } }` gives framing
    defaults (`DEFAULT_CAMERA3D`; `layerDepth` is z px per entity `layer`).
  - `resolveMeshParts(skin, entry, box)` (pure, the one reading of mesh text shared by backends
    and tests): the `MeshPart[]` `{ shape, size, at, color, rotate }` for a kind or tile entry,
    with `box` the entity box or `{ w: tileSize, h: tileSize }`: a primitive is one part filling
    the box; parts default to the entry's colour; `scale` grows every part about the box's
    bottom centre; then `offset` and `z` move the mesh. A sprite entry or unknown mesh gives `[]`.
    `resolveCamera3d(skin)` fills `camera3d` from `DEFAULT_CAMERA3D`.
  - Cross-file (`SKIN_KIND.checkAll`, `checkSkinRefs`): every sheet, palette and sound must be a
    sprite, palette, song or sfx of the game (`missing_ref`), and every frame a frame of its
    sheet (`missing_frame`), each at the skin file and field.
  - `resolveSkinFrame(skin, entity)` (pure, for backends): the `SkinFrame` `{ sheet, frame, flipX,
palette?, fallbackColor, size?, offset? }` for an entity's kind, `anim.state` (else `idle`,
    else the first state), `anim.t` (cycle frame; `loop: false` holds the last) and `facing` (a
    left-facing entity without a `left` frame uses `right` mirrored when `flipFacing`; else
    `down`, else the first given). An unknown kind or a mesh entry gives `frame: null`: draw a
    `fallbackColor` box (`DEFAULT_FALLBACK_COLOR` when the skin gives none).
- `camera.ts`: camera framing shared by every backend, so 2D and 3D frame the same world point.
  `CameraFollower` (`new CameraFollower({ clamp? })`, default clamp on) keeps one camera's state;
  `update(frame, skin.camera, size, map)` returns its top-left in whole world pixels (`map` is the
  shown map's `{ id, cols, rows, tileSize }`, or null). Target: the hint's `follow` entity (by id,
  its box centre) when in the frame, else the hint's `x`/`y`, else the skin's `camera.follow`
  (entity id, then kind), else none (top-left 0, 0). `deadzone` and `lerp`: the hint's, else the
  skin's, else 0x0 and 1. Past the deadzone the camera moves just enough to put the target back on
  its edge. Lerp is 1/256 fixed point (`Math.trunc`, at least 1 px, so it always arrives); 1
  snaps, 0 holds. The first frame, a new map id, a frame with no target and a `reset()` snap; a
  repeated `frame` number does not move it. Clamp: the hint's `bounds`, else the map; an area
  smaller than the picture is centred. `cameraShake(frame, extra)` is the whole-pixel shake (the
  hint's `shake` plus `extra`, flipping side each frame), added by the backend and never stored.
  The follower lives in a presenter only: never in a kit, a frame or a hash.
- `stream.ts` (Engine 0.7): the per-frame stream games had written by hand. `FrameSource<W, E, S>`
  `{ start(world), present(world, events, state) }` is how a kit presents its world (the
  platformer kit's `platformerFrames(size)`); `FrameStream(source).next(world, events)` gives the
  frozen frame with one stream state per world object (a new world, such as the next level,
  starts afresh); `PendingEvents(world, initial?)` keeps the events of several steps between two
  frames (`add(world, events)` drops those of an older world; `take()` empties it);
  `FramePicture(frames, presenter).draw(world, events)` presents a stream's frame and returns it.
- `index.ts`: re-exports all of the above; import from `@engine/core/present` (or `./present`).

## Rules

- Pure: `engine/core/present/**` is on `PURE_CORE` (`config/layers.js`). No clock, DOM or
  `Math.random`. Import only `zod` and pure core files (`../gfx/screen`, `../headless` types).
- Everything in a frame is plain JSON-safe data: no classes, functions, `Map`s or kit objects. A
  backend never sees kit internals.
- Frames are read-only to backends. Never add a field a backend would write back to.
- New presentation-only effects go in as optional fields (extension points) that a backend may
  ignore; keep `presentFrameSchema` and the types in step, and add a fixture field to the tests.
- No world rules here and no drawing: kits fill frames, backends draw them.

## Testing

`present.test.ts`: a fixture frame using every field passes the schema, wrong fields are reported
at their path, `freezeFrame` makes every write throw, and `MapTracker` sends the map on the first
frame and on a version (or id) change only. `skin.test.ts`: a fixture skin passes, bad fields
are reported at their path (inside unions too), 2D and 3D fields are kept apart, missing sheets,
palettes, sounds and frames are cross-file errors, and `resolveSkinFrame` picks states, cycles
frames by `t`, handles facings and flips, and falls back for unknown kinds. Its 3D part covers a
`three` skin with primitives and compound meshes, unknown mesh ids (`missing_ref`), 2D/3D fields
on the wrong backend, the demo and platformer-lab canvas2d skins still validating,
`resolveMeshParts` (primitive, compound, scale) and `resolveCamera3d`. `stream.test.ts` covers `FrameStream`
(state per world, frozen frames), `PendingEvents` (kept across steps, dropped on a new world) and
`FramePicture`. `camera.test.ts` covers
`CameraFollower` (follow by id and kind, hint `x`/`y`, deadzone, lerp, clamp to bounds and map,
small-area centring, snap on a new map id, repeated frames, `reset`) and `cameraShake`. Run with
`pnpm test`.
