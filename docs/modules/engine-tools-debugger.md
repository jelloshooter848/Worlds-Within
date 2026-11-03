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
tick. Never part of the Pages build.

## Public API entry points

- `pnpm cli debug <file> [--tick N] [--port P] [--check]` (`engine/tools/commands/debug.ts`):
  serves the page and prints `{ url, file, kind: run|replay|dump, game, ticks, openTick, serving }`;
  `--check` opens it in headless Chromium at the tick and adds `{ tick, hash, headlessHash,
matchesHeadless, mismatch, eventCount }` (exit 4 on a mismatch).
- `window.__wwDebugger` on the page (`DebuggerApi` in `job.ts`): `ready`, `error`, `kind`, `tick`,
  `ticks`, `hash()`, `state()`, `events(filter?)`, `stepEvents()`, `eventCount()`, `step(n)`,
  `goto(tick)`, `checks()`, `diff()`, `mismatch()`, `playFromHere()`.
- `model.ts` (pure): `DebugSession` (`step`, `goto`, `hash`, `state`, `checks`, `assertions`,
  `hashRows`, `events`, `stepEvents`, `diff`, `mismatch`, `rebuilds`), `headlessOptions`,
  `diffStates`, `searchState`.
- `server.ts` (Node): `buildDebugJob`, `debugKindOf`, `startDebugServer`, `closeDebugServers`,
  `checkInBrowser`.
- `job.ts`: `DebugJob`, `DebugRunJob`, `DebugDumpJob`, `DEBUG_JOB_PATH`, `DEBUG_PAGE`.

## Imports allowed

Those of `engine/tools` (`config/layers.js`): `engine/tools`, `engine/sim`, `engine/backends`,
`engine/core` and `kits`; games only by URL or path at run time, never statically. `model.ts` and
`job.ts` use no Node and no DOM; `page.ts` is browser only; `server.ts` is Node only.

## How to test

- `pnpm test engine/tools/debugger engine/tools/debug.test.ts tests/browser/debugger.test.ts`.
- By hand: `pnpm cli debug games/samples/mini-siege/runs/played.run.json --tick 40` and open the
  URL; `pnpm -s cli debug games/demo/runs/walk-east.run.json --tick 60 --check --json` must exit 0
  with `matchesHeadless: true`.
