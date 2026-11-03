# engine/tools/debugger

Folder: `engine/tools/debugger` (part of `engine/tools`). Detailed rules:
[`engine/tools/debugger/CLAUDE.md`](../../engine/tools/debugger/CLAUDE.md).

## Purpose

The in-browser simulation debugger (Engine 0.14): a tools-only page that opens a run file, a
replay file or a dump file the CLI wrote, shows the world state (a collapsible tree with search
and the paths changed since the previous tick), the world's event log (filtered by world ticks,
entity, cause and component), the run's checks with pass or fail at each tick and the state hash
against the golden file, draws the game's picture beside them, and steps forward (1, 10, N, to a
tick) and back (re-simulating from tick 0, with a per-tick cache). A dump opens read-only at its
tick. The timeline viewer (Engine 0.14 T11) draws the world's timeline record on one axis of game
ticks (the world clock, frozen spans, experience time, opportunity windows with their status
changes and causes, missions open to commit with the outcome); clicking a marker goes to its
tick. A replay opens at its failing tick with the failed check (path, op, expected against the
actual value), buttons for that tick and the tick before, and the first stored-hash mismatch
marked. Never part of the Pages build.

## Public API entry points

- `pnpm cli debug <file> [--tick N] [--port P] [--check]` (`engine/tools/commands/debug.ts`):
  serves the page and prints `{ url, file, kind: run|replay|dump, game, ticks, openTick, failure,
serving }`; `--check` opens it in headless Chromium at the tick and adds `{ tick, hash,
headlessHash, matchesHeadless, mismatch, eventCount, failure, reproduced, hashMismatch }` (exit 4
  on a mismatch or a replay that does not reproduce). A failing `pnpm cli run` prints the line that
  opens its replay (`debug` in its result).
- `window.__wwDebugger` on the page (`DebuggerApi` in `job.ts`): `ready`, `error`, `kind`, `tick`,
  `ticks`, `hash()`, `state()`, `events(filter?)`, `stepEvents()`, `eventCount()`, `step(n)`,
  `goto(tick)`, `checks()`, `diff()`, `mismatch()`, `failure()`, `timeline()` (text),
  `timelineLayout()` (rows), `playFromHere()`.
- `model.ts` (pure): `DebugSession` (`step`, `goto`, `hash`, `state`, `checks`, `assertions`,
  `hashRows`, `events`, `stepEvents`, `diff`, `mismatch`, `timeline`, `failure`, `rebuilds`),
  `headlessOptions`, `diffStates`, `searchState`.
- `timeline.ts` (pure): `timelineLayout(record, { gameTick, ticks }, marks?)` (rows of spans and
  markers on the game-tick axis), `placeWorldTick`, `timelineMarkers`, `timelineText`.
- `server.ts` (Node): `buildDebugJob`, `debugKindOf`, `startDebugServer`, `closeDebugServers`,
  `checkInBrowser`.
- `job.ts`: `DebugJob`, `DebugRunJob`, `DebugDumpJob`, `DEBUG_JOB_PATH`, `DEBUG_PAGE`.

## Imports allowed

Those of `engine/tools` (`config/layers.js`): `engine/tools`, `engine/sim`, `engine/backends`,
`engine/core` and `kits`; games only by URL or path at run time, never statically. `model.ts` and
`job.ts` use no Node and no DOM; `page.ts` is browser only; `server.ts` is Node only.

## How to test

- `pnpm test engine/tools/debugger engine/tools/debug.test.ts tests/browser/debugger.test.ts`.
- A failing run: `pnpm -s cli run <run-file> --json` prints `debug`, the line that opens its
  replay; `pnpm -s cli debug <replay> --check --json` reports `openTick` (the failing tick),
  `failure`, `reproduced` and `hashMismatch`.
- By hand: `pnpm cli debug games/samples/mini-siege/runs/played.run.json --tick 40` and open the
  URL; `pnpm -s cli debug games/samples/dungeon/runs/walk-east.run.json --tick 60 --check --json` must exit 0
  with `matchesHeadless: true`.
