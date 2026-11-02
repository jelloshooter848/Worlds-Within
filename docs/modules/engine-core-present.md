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
  `DeepReadonly`.
- `Presenter`: what a backend implements, `present(frame: DeepReadonly<PresentFrame>)` and
  optional `resize(size)`.
- `freezeFrame(frame)`: deep-freezes a frame so writes throw (tests and dev).
- `MapTracker`: `next(map)` gives the full map on the first frame and when its id or version
  changes, else `{ id, version }`; `reset()`. `isFullMap(map)` tells the two apart.
- `presentFrameSchema`: Zod schema for a frame, for tests and tools.

Example: a kit keeps `const maps = new MapTracker()` and each frame builds
`{ frame, size, entities, map: maps.next(roomMap), events, status }`; a test runs
`validate('frame', frame, presentFrameSchema)` and hands `freezeFrame(frame)` to a presenter.

## Imports allowed

- `zod` and pure files in `engine/core`. Never backends, the sim, tools, kits or games.
- Pure: `engine/core/present/**` is on `PURE_CORE` in `config/layers.js`.

## How to test

`engine/core/present/present.test.ts`, run with `pnpm test`: a fixture frame passes the schema,
`freezeFrame` makes mutation throw, and `MapTracker` sends the map only when it must.
