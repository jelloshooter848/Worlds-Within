# engine/core/present

The presentation contract (docs/DESIGN.md, section 6; docs/ROADMAP.md, Engine 0.4): the read-only
snapshot a backend gets each frame. A kit describes what is there; a backend decides how it looks,
from the frame and a skin. Types and small pure helpers only: no drawing, no kit or backend code.

- `types.ts`: `PresentFrame` `{ frame, size, entities, map?, events, status, camera? }`.
  - `PresentEntity` `{ id, kind, x, y, w, h, facing, anim: { state, t }, tags, layer?, fx? }`:
    `id` is stable across frames; `x`/`y`/`w`/`h` are the box in world pixels (top-left); `facing`
    is one of `FACINGS`: `up | down | left | right` or (Engine 0.9, owner answer 128 to item 48)
    a diagonal `up-left | up-right | down-left | down-right`; `anim.t` is ticks since the state
    began. Four-way kits (topdown, platformer) keep emitting cardinals only.
  - Facing helpers (pure): `cardinalFacing(f)` (a diagonal's horizontal part: `up-right` gives
    `right`), `mirrorFacing(f)` (left to right: `up-left` gives `up-right`) and `facesLeft(f)`
    (`left`, `up-left`, `down-left`).
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
  `content/engine-kinds.ts`). One JSON file per backend: `{ backend, background?, sheets?, kinds,
tiles?, events?, hud?, camera?, meshes?, camera3d? }`. `background` (Engine 0.15, gap G36,
  decision 3) is the colour (`#rgb` or `#rrggbb`) the backend clears to before each frame it draws
  with that skin: `skinBackground(skin)` gives it, else `DEFAULT_BACKGROUND` (`#000`, the black
  every skin had before). Both backends clear through it (a presenter's own `background` option
  still wins, for a caller that must override it), and each skin of a skin set clears to its own,
  so a hosted round keeps its skin's (black by default). The platformer games' sky and the RTS,
  tower-defense and mini siege grass are their skins' `background`, no constant in glue. `sheets` gives defaults (`sheet`, `palette`, `fallbackColor`) for
  entries that leave them out. A kind entry is 2D (`sheet`, `palette?`, `frames`, `flipFacing?`,
  `size?`, `fallbackColor`, `offset?`) or 3D (`mesh`, `color`, `scale?`, `depth?`, `z?`,
  `offset?`), either with an optional `byTag` list (below); a tile entry 2D (`sheet?`, `frame`, `fallbackColor`) or 3D (`mesh`, `color`,
  `depth?`, `z?`). The backend picks which (`MESH_BACKENDS`, today `three`), and a field of the
  other shape (including the skin-level `meshes` and `camera3d` on a 2D skin) is a
  `wrong_backend_field` error, a needed one left out `missing_field`. `frames` maps an animation
  state to a frame name, a cycle `{ frames, ticks? (default 8), loop? }` or a per-facing map
  of names or cycles, keyed by any of the eight facings, all optional. `tiles` maps a tile character or id to
  `{ sheet?, frame, fallbackColor }`; `events` maps an event type to `{ sound?, effect? }`
  (`effect.kind`: `flash`, `particles`, `shake`, `tint`); a key may also match one of the event's
  fields (Engine 0.11, gap G28, item 180): `type:value` matches its `result` field
  (`EVENT_KEY_FIELD`; `mini-game-end:pass`), `type:field=value` any other
  (`mission-commit:outcome=both-burnt`); any other shape is `bad_event_key`; `hud` lists `{ status, as: hearts |
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
  - `resolveSkinEvent(skin.events, event)` (pure, for backends; gap G28): the entry for one event:
    the first key of its type, in file order, whose field matches (a string, number or boolean
    whose text is the key's value), else the bare type's entry, else undefined. So
    `mini-game-end:pass`, `mini-game-end:fail` and a fallback `mini-game-end` sit side by side,
    and a skin with bare keys only reads as before. `parseEventKey(key)` reads a key
    (`{ type, match: { field, value } | null }`, null for a bad one). Both backends' presenters
    play sounds and start effects through it.
  - Looks by tag (Engine 0.11, gaps G13 and G30, item 181; prefixes and values Engine 0.15, gap
    M2, decision 3, item 280): a kind entry's `byTag` is a list of `{ tag | prefix, min?, max?,
sheet?, palette?, frames?, fallbackColor?, mesh?, color? }`. A look matches by exactly one of
    `tag` (the whole tag) or `prefix` (any tag starting with it, `progress:`), and with `min`
    and/or `max` (inclusive whole numbers, only with `prefix`) only a tag whose rest reads as a
    whole number (`-?\d+`) in that range: `progress:half` never matches a look with a range.
    `skinTagMatches(look, tag)` is that test. Both `tag` and `prefix`, neither, `min`/`max`
    without `prefix`, or `min` above `max` are `bad_tag_look`. **Order rules** for
    `resolveSkinKind`: looks are tried in file order and the first that matches any of the
    entity's tags wins (the entity's tag order does not matter), so a skin lists its stages from
    the most specific (`progress:` 75 and up, then 50-74, then plain `site`); a look for two tags
    at once is not built (moved to 1.0). For an entity with tags, the winning look lays its fields
    (never `tag`, `prefix`, `min` or `max`) over the kind's (`frames`
    replace the kind's frames whole; the fields it leaves out, `flipFacing`, `size`, `offset`,
    `depth`, `scale`, `z`, come from the kind); the state and facing are then picked inside it as
    usual. No match (or no tags) uses the kind as it is, so a skin without `byTag` draws as
    before. `resolveSkinKind(skin, entity)` gives that entry (undefined for an unlisted kind) and
    `skinTagIndex(entry, tags)` the look's index (-1: none); the Canvas2D presenter picks frames
    and the 3D scene builds meshes through them (and rebuilds an entity whose look changes). The
    other shape's fields in a look are `wrong_backend_field`, a look's unknown `mesh` is
    `missing_ref`, and its sheet, palette and frames are checked across files like the kind's.
    A tag is any of the entity's tags: `used`, `brick` (a bumped block), `look:<id>` (a platformer
    trigger's `look`), `site` (the RTS kit's building under construction); the mini siege uses it
    for its construction site and its burnt or damaged siege engines; the RTS skirmish's
    barracks site takes a half-built look from `progress:50` (a `prefix` look with `min`).
  - `resolveSkinFrame(skin, entity)` (pure, for backends): the `SkinFrame` `{ sheet, frame, flipX,
palette?, fallbackColor, size?, offset? }` for an entity's kind (its tag look, if any),
    `anim.state` (else `idle`,
    else the first state), `anim.t` (cycle frame; `loop: false` holds the last) and `facing`. A facing without its own
    frame falls back in turn: a left-hand facing uses its right-hand mirror flipped when
    `flipFacing` (`up-left` uses `up-right`, `left` uses `right`); a diagonal uses its horizontal
    part (`cardinalFacing`), then that part's own fallback; then `down`, then the first given (in
    `FACINGS` order). A single frame or cycle is flipped for any left-hand facing under
    `flipFacing`. An unknown kind or a mesh entry gives `frame: null`: draw a
    `fallbackColor` box (`DEFAULT_FALLBACK_COLOR` when the skin gives none).
- `camera.ts`: camera framing shared by every backend, so 2D and 3D frame the same world point.
  `CameraFollower` (`new CameraFollower({ clamp? })`, default clamp on; both presenters pass the
  skin's `camera.clamp` unless their own `clamp` option is set, Engine 0.7 T9) keeps one camera's state;
  `update(frame, skin.camera, view, map)` returns its top-left in whole world pixels (`map` is the
  shown map's `{ id, cols, rows, tileSize }`, or null). It works in zoomed units: `view` is the
  world box the picture shows, `cameraView(size, zoom)` (the picture size over the zoom), with
  `cameraZoom(frame, skin.camera)` the hint's `zoom`, else the skin's, else 1; so the deadzone
  is in world pixels and clamping keeps the zoomed picture inside the area. Both backends call it
  this way. Target: the hint's `follow` entity (by id,
  its box centre) when in the frame, else the hint's `x`/`y`, else the skin's `camera.follow`
  (entity id, then kind), else none (top-left 0, 0). `deadzone` and `lerp`: the hint's, else the
  skin's, else 0x0 and 1. Past the deadzone the camera moves just enough to put the target back on
  its edge. Lerp is 1/256 fixed point (`Math.trunc`, at least 1 px, so it always arrives); 1
  snaps, 0 holds. The first frame, a new map id, a frame with no target and a `reset()` snap; a
  repeated `frame` number does not move it. Clamp: the hint's `bounds`, else the map; an area
  smaller than the picture is centred. `cameraShake(frame, extra)` is the whole-pixel shake (the
  hint's `shake` plus `extra`, flipping side each frame), added by the backend and never stored.
  The follower lives in a presenter only: never in a kit, a frame or a hash.
- `rts-camera.ts` (Engine 0.9 T5): `RtsCamera({ view, area, zoom?, minZoom?, maxZoom?, centre? })`,
  a scrolling, zoomable view over a map larger than the picture: its position (the top-left in
  world px, kept unrounded so slow pans add up) and zoom (`RTS_MIN_ZOOM` 0.5 to `RTS_MAX_ZOOM` 2 by
  default, shown in 1/64 steps so 0.5, 1 and 2 are exact). `panBy(dx, dy)` (picture px, as a `pan`
  gesture gives them), `zoomTo(z, at?)` / `zoomBy(factor, at?)` (keeping the world point under
  picture point `at` still), `centreOn`, `apply(gesture)` (pan and zoom gestures from
  `input/pointer-logic.ts`; false for taps and boxes), `resize(view)`. It clamps to `area` exactly as
  `CameraFollower` does (`clampCameraAxis`, exported from `camera.ts`; an area smaller than the
  view is centred). `topLeft()` is the whole-pixel top-left; `hint()` is the frame's `CameraHint`
  `{ x, y, zoom, deadzone: 0x0, lerp: 1, bounds: area }`, which makes the follower (both
  presenters) frame that same top-left whatever the skin's camera says. `worldToScreen(wx, wy)`
  is where the Canvas2D presenter draws a world point (`round(wx * zoom) - round(left * zoom)`,
  shake aside), `screenToWorld(sx, sy)` its inverse (unrounded world px) and
  `screenBoxToWorld(box)` a box gesture's `boxRect` in world px. Presentation only: it lives in the
  glue or a kit's presentation state, never in a world or a hash.
- `stream.ts` (Engine 0.7): the per-frame stream games had written by hand. `FrameSource<W, E, S>`
  `{ start(world), present(world, events, state) }` is how a kit presents its world (the
  platformer kit's `platformerFrames(size)`); `FrameStream(source).next(world, events)` gives the
  frozen frame with one stream state per world object (a new world, such as the next level,
  starts afresh); `PendingEvents(world, initial?)` keeps the events of several steps between two
  frames (`add(world, events)` drops those of an older world; `take()` empties it);
  `FramePicture(frames, presenter).draw(world, events)` presents a stream's frame and returns it.
- `switch.ts` (Engine 0.7, gap G14): `presenterByStatus(status, presenters, otherwise)`, a
  `Presenter` that hands each frame to `presenters[frame.status[status]]` when that value is one
  of its own keys (a string), else to `otherwise`; `resize` goes to all. A game that stacks kits
  gives each frame source its own presenter (own skin, camera and map cache): the platformer
  kit's `status.miniGame` is the running round's id, '' on the level.
- `hosted.ts` (Engine 0.15 T6, gap M6, decision 7, item 284): one round picture for every hosted
  mission. `hostedSource(main, { round, events? })` is a `FrameSource` over a game's own source
  (`main`): while `round(world)` gives a frame (`MissionHost.roundFrame()`: the hosted round's own
  frame, `status.miniGame` already set by the host, gap D9) it is shown, its map through a
  `MapTracker` of its own that is reset when the round ends; otherwise `main`'s frame with
  `status.miniGame` set to ''. `events(events)` picks the host's events to add to whichever frame
  is shown (`missionHostEvents` for a `MissionHost`'s `mission-open`, `mini-game-end` and
  `mission-commit`, gap M21); left out, none. With a skin set (`presenterBySkinSet`) a page writes
  this one call instead of the battle-or-round switch. `HostedPresentState<S>` is its stream
  state (`main`, `roundMaps`, `inRound`).
- `skin-set.ts` (Engine 0.7 T8, gap G32): `skinSet(content, backend)` gives one backend's skins
  for a game by file name: `main` (`content/skins/<backend>.json`, else the first skin of that
  backend that is not a mini game's; null when none) and `rounds` (`<backend>-<id>.json`, by the
  mini game id `<id>`). `MINI_GAME_STATUS` (`miniGame`) is the status a host kit sets to the
  running mini game's id; `presenterBySkinSet(main, rounds)` is `presenterByStatus` on it. The
  page, the view and `pnpm cli screenshot --backend three` all read the same set.
- `index.ts`: re-exports all of the above; import from `@engine/core/present` (or `./present`).

## Rules

- Pure: `engine/core/present/**` is on `PURE_CORE` (`config/layers.js`). No clock, DOM or
  `Math.random`. Import only `zod` and pure core files (`../gfx/screen`, `../headless` types,
  `../content/bundle` for `skinSet`; `import type` of `../input/pointer-logic` for `RtsCamera.apply`).
- Everything in a frame is plain JSON-safe data: no classes, functions, `Map`s or kit objects. A
  backend never sees kit internals.
- Frames are read-only to backends. Never add a field a backend would write back to.
- New presentation-only effects go in as optional fields (extension points) that a backend may
  ignore; keep `presentFrameSchema` and the types in step, and add a fixture field to the tests.
- No world rules here and no drawing: kits fill frames, backends draw them.

## Testing

`present.test.ts`: a fixture frame using every field passes the schema, wrong fields are reported
at their path, `freezeFrame` makes every write throw, and `MapTracker` sends the map on the first
frame and on a version (or id) change only. `present.test.ts` also checks all eight facings pass the schema and the facing helpers.
`skin.test.ts`: its `looks by tag prefix and value (M2)` block covers `skinTagMatches` (whole
tag, prefix, ranges, non-numbers), file order picking the most specific stage first, the merged
entry without match fields, and the `bad_tag_look` refusals; `skin background (G36)` covers
`skinBackground` and the schema. A fixture skin passes, bad fields
are reported at their path (inside unions too), 2D and 3D fields are kept apart, missing sheets,
palettes, sounds and frames are cross-file errors (sounds of field-matched event keys too), event
keys are read and bad ones rejected, `resolveSkinEvent` tries field keys in file order then the
bare type, and `resolveSkinFrame` picks states, cycles
frames by `t`, handles facings and flips (a diagonal falling back to its cardinal, diagonal
frames, a mirrored left diagonal, all eight facings in the schema), and falls back for unknown kinds.
Its `frames by tag` block covers `byTag` (the first matching look in file order, the kind
otherwise, a skin without it unchanged, its 2D/3D fields kept apart, mesh refs, and the cross-file
sheet, palette and frame checks). Its 3D part covers a
`three` skin with primitives and compound meshes, unknown mesh ids (`missing_ref`), 2D/3D fields
on the wrong backend, the demo and platformer-lab canvas2d skins still validating,
`resolveMeshParts` (primitive, compound, scale) and `resolveCamera3d`. `stream.test.ts` covers `FrameStream`
(state per world, frozen frames), `PendingEvents` (kept across steps, dropped on a new world) and
`FramePicture`. `switch.test.ts` covers `presenterByStatus` (picking by value, inherited keys
ignored, resize to all). `skin-set.test.ts` covers `skinSet` (main and rounds by file name, the
fallbacks) and `presenterBySkinSet`. `camera.test.ts` covers
`CameraFollower` (follow by id and kind, hint `x`/`y`, deadzone, lerp, clamp to bounds and map,
small-area centring, the zoomed view at 0.5 and 2, snap on a new map id, repeated frames,
`reset`), `cameraZoom`, `cameraView` and `cameraShake`. `rts-camera.test.ts` covers `RtsCamera`:
clamping at zoom 0.5, 1 and 2 (no stored overshoot), a small area centred, zoom limits, zooming
about a point, slow pans and pinches adding up, `apply`, round trips screen -> world -> screen at
zoom 0.5, 1, 1.5 and 2, boxes, and that `CameraFollower` frames its `hint()` to exactly its
`topLeft()` despite a skin deadzone and lerp. The agreement with the Canvas2D presenter's drawing
is checked in `engine/backends/canvas2d/rts-camera.test.ts`. `hosted.test.ts` covers `hostedSource` (the main frame with
`miniGame` '', the round's frame, its map sent once per round, the host's events added or none). Run with
`pnpm test`.
