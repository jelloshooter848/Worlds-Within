# engine/core/present

Folder: `engine/core/present` (part of `engine/core`). Detailed rules:
[`engine/core/present/CLAUDE.md`](../../engine/core/present/CLAUDE.md).

## Purpose

The presentation contract: the read-only snapshot a backend gets each frame. A kit describes what
is there (entities, the level map, this frame's events and HUD status); a backend decides how it
looks, from the frame and a skin, and can't change anything. Camera framing, depth layers and
squash and stretch are optional extension points a backend may ignore.

## Public API entry points

Import from `@engine/core/present` (`index.ts`).

- Types: `PresentFrame`, `PresentEntity`, `PresentAnim`, `PresentFx`, `Facing`, `PresentMap`,
  `PresentMapRef`, `PresentMapLayer`, `PresentEvent`, `PresentStatusValue`, `CameraHint`,
  `PresentBox`, `DeepReadonly`.
- `Facing` (Engine 0.9, owner answer 128): `up`, `down`, `left`, `right` and the diagonals
  `up-left`, `up-right`, `down-left`, `down-right` (`FACINGS`). Helpers: `cardinalFacing(f)` (a
  diagonal's horizontal part), `mirrorFacing(f)` and `facesLeft(f)`. Four-way kits keep emitting
  cardinals.
- `CameraHint` (all optional past `x`/`y`, a backend may ignore them): `zoom`, `follow` (an
  entity id; beats `x`/`y`), `shake`, and overrides of the skin's camera defaults for this frame:
  `deadzone` (`{ w, h }` world pixels), `lerp` (0 to 1, 1 snaps) and `bounds` (a world box the
  view stays inside instead of the map, for a kit-side scroll lock). The hint wins over the skin
  field by field; the skin's `camera` gives the defaults.
- `Presenter`: what a backend implements, `present(frame: DeepReadonly<PresentFrame>)` and
  optional `resize(size)`.
- `freezeFrame(frame)`: deep-freezes a frame so writes throw (tests and dev).
- `MapTracker`: `next(map)` gives the full map on the first frame and when its id or version
  changes, else `{ id, version }`; `reset()`. `isFullMap(map)` tells the two apart.
- `presentFrameSchema`: Zod schema for a frame, for tests and tools.
- `hostedSource(main, { round, events? })` (`hosted.ts`, Engine 0.15 T6, gap M6): one round
  picture for any game hosting rounds: the game's own source's frames (`status.miniGame` '') or,
  while `round(world)` gives one, the hosted round's frame (`MissionHost.roundFrame()`, named by
  the host, gap D9), with the host's events added (`missionHostEvents`, gap M21).
- Skins (`skin.ts`): `skinSchema` and the `skin` content kind (`SKIN_KIND`, one of the engine's
  kinds), a per-backend JSON file mapping each entity kind to a sprite (2D) or mesh (3D), each tile
  to a frame, each event to a sound and effect, and status values to HUD items. Its cross-file
  check reports sheets, palettes, sounds and frames the game lacks (`missing_ref`,
  `missing_frame`). `resolveSkinFrame(skin, entity)` gives the `SkinFrame` to draw (sheet, frame,
  flip, fallback colour) from the entity's kind, animation state and tick, and facing (a
  diagonal with no frame uses its horizontal part; `flipFacing` mirrors right-hand frames for the
  left-hand facings). A kind's `byTag` list (Engine 0.11, gaps G13 and G30) gives looks by
  entity tag, `{ tag | prefix, min?, max?, sheet?, palette?, frames?, fallbackColor?, mesh?,
color? }`: `tag` matches one whole tag; `prefix` (Engine 0.15, gap M2) any tag starting with
  it, and with `min`/`max` only one whose rest is a whole number in that inclusive range
  (`{ "prefix": "progress:", "min": 50 }`; `skinTagMatches(look, tag)`). Order rule: the first
  look in file order that matches any of the entity's tags replaces those fields of the kind's
  (`resolveSkinKind(skin, entity)`, used by both backends; `skinTagIndex`), so a skin lists its
  looks from the most specific; else the kind is used as it is, so a skin without it draws as
  before. A look with both or neither of `tag` and `prefix`, or `min`/`max` without `prefix`, is
  `bad_tag_look`. A skin's optional `background` (Engine 0.15, gap G36) is the colour both
  backends clear to before each frame drawn with it (`skinBackground(skin)`, else
  `DEFAULT_BACKGROUND`, black); each skin of a skin set clears to its own. An `events` key may also match a field (Engine 0.11, gap G28):
  `mini-game-end:pass` (the event's `result`) or `type:field=value`; `resolveSkinEvent(events,
event)` gives the entry, the first matching field key in file order, else the bare type's. Field
  reference: `docs/reference/schemas.md`, section `skin`.
- 3D skins (`backend: "three"`): every kind and tile is a text-defined low-poly mesh, either a
  primitive (`MESH_PRIMITIVES`: `box`, `wedge`, `cylinder`, `cone`, `sphere`, `plane`) or a named
  compound mesh in the skin's `meshes` (a list of `{ shape, size, at?, color?, rotate? }` parts in
  world px), with `depth` (tiles default to one tile deep) and `z`. `camera3d` gives `fov`,
  `tilt`, `layerDepth` (z px per entity `layer`) and minimal `lights` (`DEFAULT_CAMERA3D`,
  `resolveCamera3d(skin)`). `resolveMeshParts(skin, entry, box)` turns an entry into the
  `MeshPart` list a 3D backend builds, so the backend and tests read the text the same way.
- Camera framing (`camera.ts`): `CameraFollower` (`new CameraFollower({ clamp? })`,
  `update(frame, skin.camera, view, map)` gives the camera's whole-pixel world top-left;
  `reset()`) is the one copy of the follow, deadzone, 1/256 fixed-point lerp and clamp maths, so
  the 2D and 3D backends frame the same point. It works in zoomed units: `view` is
  `cameraView(picture, cameraZoom(frame, skin.camera))`, the picture size over the zoom in world
  pixels, so clamping keeps the zoomed picture inside the map. `cameraShake(frame, extra)` is the shake offset,
  added on top and never stored; `cameraTarget(frame, skin.camera)` the point to keep in view.
  Each presenter owns its follower: camera state is never in a kit, a frame or a hash.
- RTS camera control (`rts-camera.ts`, Engine 0.9): `RtsCamera({ view, area, zoom?, minZoom?,
maxZoom?, centre? })`: position and zoom (0.5 to 2 by default) clamped to the map as the
  follower clamps (`clampCameraAxis`), `panBy`, `zoomBy(factor, at?)` about a picture point,
  `centreOn`, `apply(gesture)` for pan and zoom gestures (`@engine/core/input/pointer-logic`),
  `hint()` (the frame's `CameraHint` with `x`/`y`/`zoom`, no deadzone or lerp, `bounds` the area),
  and `screenToWorld` / `worldToScreen` / `screenBoxToWorld`, which agree with where the Canvas2D
  presenter draws at that zoom. Presentation state only, never in a world or a hash.

- Frame streams (`stream.ts`, Engine 0.7): `FrameSource` (a kit's `start(world)` and
  `present(world, events, state)`), `FrameStream` (`next(world, events)`: frozen frames, fresh
  state per world), `PendingEvents` (events between frames, dropped on a new world) and
  `FramePicture` (`draw(world, events)` onto a `Presenter`). Games and tools use them instead of
  their own per-frame glue.
- `presenterByStatus(status, presenters, otherwise)` (`switch.ts`, Engine 0.7): one presenter
  per frame source, picked per frame by a status value (`miniGame`), so a stacked mini game's
  frames get their own skin, camera and map cache.
- `skinSet(content, backend)`, `MINI_GAME_STATUS`, `presenterBySkinSet(main, rounds)`
  (`skin-set.ts`, Engine 0.7 T8): one backend's skins by file name (`<backend>.json` for the
  game, `<backend>-<id>.json` for mini game `<id>`'s frames), shared by pages, views and the
  screenshot tool.

Example: a kit keeps `const maps = new MapTracker()` and each frame builds
`{ frame, size, entities, map: maps.next(roomMap), events, status }`; a test runs
`validate('frame', frame, presentFrameSchema)` and hands `freezeFrame(frame)` to a presenter.

## Imports allowed

- `zod` and pure files in `engine/core`. Never backends, the sim, tools, kits or games.
- Pure: `engine/core/present/**` is on `PURE_CORE` in `config/layers.js`.

## How to test

`engine/core/present/present.test.ts`, run with `pnpm test`: a fixture frame passes the schema,
`freezeFrame` makes mutation throw, and `MapTracker` sends the map only when it must;
`engine/core/present/skin.test.ts` covers the skin schema (2D and 3D), its cross-file checks,
`resolveSkinFrame`, `resolveMeshParts` and `resolveCamera3d`; `engine/core/present/camera.test.ts`
covers `CameraFollower` and `cameraShake`; `engine/core/present/rts-camera.test.ts` covers
`RtsCamera` (clamping, zoom limits, round trips at zoom 0.5, 1, 1.5 and 2, its hint through the
follower) and `engine/backends/canvas2d/rts-camera.test.ts` its agreement with the presenter; `engine/core/present/stream.test.ts` the frame streams.
