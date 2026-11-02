# engine/core/present

The presentation contract (docs/DESIGN.md, section 6; docs/ROADMAP.md, Engine 0.4): the read-only
snapshot a backend gets each frame. A kit describes what is there; a backend decides how it looks,
from the frame and a skin. Types and small pure helpers only: no drawing, no kit or backend code.

- `types.ts`: `PresentFrame` `{ frame, size, entities, map?, events, status, camera? }`.
  - `PresentEntity` `{ id, kind, x, y, w, h, facing, anim: { state, t }, tags, layer?, fx? }`:
    `id` is stable across frames; `x`/`y`/`w`/`h` are the box in world pixels (top-left); `facing`
    is `up | down | left | right`; `anim.t` is ticks since the state began.
  - `map` is either the full `PresentMap` `{ id, version, tileSize, cols, rows, tiles, layers? }`
    (`tiles` as text rows or a grid of tile ids) or only a `PresentMapRef` `{ id, version }`.
    `isFullMap(map)` tells them apart. Bump `version` whenever any tile changes.
  - `PresentEvent` `{ type, x?, y?, entity?, ...any JSON-safe fields }`: this frame's events, for
    a skin's sounds and effects.
  - `status`: HUD values, `Record<string, number | string | boolean>`.
  - Extension points, all optional and all ignorable by a backend: `camera` (`CameraHint`
    `{ x, y, zoom?, follow?, shake? }`), `layer` (depth, drawn low to high), `fx` (`PresentFx`
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
frame and on a version (or id) change only. Run with `pnpm test`.
