# engine/tools/debugger

The in-browser simulation debugger (Engine 0.14 T10; docs/BUILD-LOG.md, Engine 0.14, decisions 1
and 2): a tools-only page that opens a run file, a replay file or a dump file the CLI wrote and
lets a person (or an agent through Playwright) inspect the world state and the event log, and step
and rewind through the run. Part of `engine/tools`: the same layer and the same imports.

```sh
pnpm cli debug games/samples/mini-siege/runs/played.run.json --tick 40   # serves it, prints the URL
pnpm -s cli debug games/demo/runs/walk-east.run.json --tick 60 --check --json   # headless check
```

## Files

- `job.ts`: what the page is given (`DebugJob`: `DebugRunJob` for a run or replay, `DebugDumpJob`
  for a dump with its run as a run job when that can be played), `DEBUG_JOB_PATH` (where the
  server serves it), `DEBUG_PAGE`, `ExpectedHash` (`golden`, `run`, `replay`), `DebugCheck`, and
  `DebuggerApi`, the `window.__wwDebugger` hook. Types only, no Node, no DOM.
- `model.ts`: `DebugSession` (step, goto, rewind, records, checks, hashes, events, diff),
  `headlessOptions(job)`, `diffStates`, `searchState`. **Pure**: no DOM, no Node, no clock, so
  Node tests check it against golden hashes (`model.test.ts`).
- `page.ts` and `index.html`: the page (browser only). Fetches the job, checks the content
  (`checkGameTexts`), imports the game's headless module and its view by URL, and wires the panels
  and `window.__wwDebugger` to a `DebugSession`.
- `server.ts` (Node only, never imported by the page): `buildDebugJob(cwd, file, tick?)`,
  `debugKindOf(json)`, `startDebugServer(built, port?)` (the screenshot command's `serveRepo` plus
  one GET-only route for the job, held in memory), `closeDebugServers()` and
  `checkInBrowser(built, port?)` (headless Chromium, used by `debug --check`).
- The command is `../commands/debug.ts`; the CLI's docs are in `../CLAUDE.md` (The debugger).

## How it steps

- A run plays exactly as `pnpm cli run` plays it: the game created from the job's content, seed,
  `from` save (`campaign`), `start` and switched-off rules; before each step from tick t, that
  tick's recorded orders, then its mission steps, then the step with the run's `ScriptedInput`.
  Tick N in the page is tick N of the run.
- **Rewinding re-simulates from tick 0** (decision 2): going back builds a fresh game and steps it
  forward. Every tick's record (snapshot, hash, failed checks, world tick) is cached once made
  (`cache: false` turns it off), so a rewind only steps the game; the fresh game's hash at the tick
  it lands on is compared with the cached one (a `rewind` mismatch if the game does not replay).
- The view module's game (the picture) is stepped alongside; its hash is compared with the
  headless game's at every tick shown (a `view` mismatch).
- Every record's hash is compared with the job's expected hashes (the golden `<name>.hashes.json`
  for a run file, the run's sync `hashes`, a replay's `replay.hashes`). The first mismatch stops
  stepping at its tick and is shown in a banner: past it the page is not showing the run.
- The event log comes from the game's `worldEvents` hook (T7); a game without it has no event
  panel (`events()` is null). `stepEvents()` is the world ticks the last step covered (the previous
  tick's world tick to now, both included).
- A dump opens read-only at its tick (its state, its stored hash checked, its events); Play from
  here (`playFromHere()`) steps its run to that tick, when the dump's run is a game run file that
  is there.
- World runs (`world` in the run file) are not stepped by the page (it builds games, not scenario
  worlds); `debug` refuses them with a usage error naming `dump --out`.

## Rules

- **Never in the Pages build**: `build/pages.ts` only builds the launcher and game pages
  (`tests/build/pages.test.ts` checks the debugger is not an input).
- The page reads no files and writes nothing: everything comes in the job, served by
  `server.ts` from memory on a GET-only route. Tools only read and replay (they never change a
  world by hand).
- The page loads a game by URL at run time, never by a static import (nothing in `engine/`
  imports from `games/`).
- Imports: what `engine/tools` may import (core, sim, backends, kits; the page uses the canvas2d
  backend for the picture). `model.ts` and `job.ts` stay free of Node and the DOM; Node code goes
  in `server.ts`.
- The hook (`window.__wwDebugger`, `DebuggerApi` in `job.ts`) is what tests and agents use: keep it
  in step with the panels, and test new hook members in `tests/browser/debugger.test.ts`.

## How to test

- `pnpm test engine/tools/debugger` (the model in Node: golden hashes stepping, rewinding with and
  without the cache, checks, mismatches, the mini siege's event log, diff and search).
- `pnpm test engine/tools/debug.test.ts` (the command: kinds, errors, the job route, and `--check`
  on a run, a dump, a replay and a stored-hash mismatch in headless Chromium).
- `pnpm test tests/browser/debugger.test.ts` (the page on a mini siege run, stepped forward and
  back through the hook). Browser tests skip where Chromium is not installed, never in CI.
