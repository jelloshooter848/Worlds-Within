# engine/tools/debugger

The in-browser simulation debugger (Engine 0.14 T10; docs/BUILD-LOG.md, Engine 0.14, decisions 1
and 2): a tools-only page that opens a run file, a replay file or a dump file the CLI wrote and
lets a person (or an agent through Playwright) inspect the world state and the event log, and step
and rewind through the run. Part of `engine/tools`: the same layer and the same imports.

```sh
pnpm cli debug games/samples/mini-siege/runs/played.run.json --tick 40   # serves it, prints the URL
pnpm -s cli debug games/demo/runs/walk-east.run.json --tick 60 --check --json   # headless check
pnpm -s cli debug .ww-out/replays/<name>.run.json --check --json   # a failing replay at its tick
```

## Files

- `job.ts`: what the page is given (`DebugJob`: `DebugRunJob` for a run or replay, `DebugDumpJob`
  for a dump with its run as a run job when that can be played), `DEBUG_JOB_PATH` (where the
  server serves it), `DEBUG_PAGE`, `ExpectedHash` (`golden`, `run`, `replay`), `DebugCheck`, and
  `DebuggerApi`, the `window.__wwDebugger` hook, `StoredFailure` (a replay's `replay.failure`).
  Types only, no Node, no DOM.
- `model.ts`: `DebugSession` (step, goto, rewind, records, checks, hashes, events, diff,
  `timeline()`, `failure()`),
  `headlessOptions(job)`, `diffStates`, `searchState`. **Pure**: no DOM, no Node, no clock, so
  Node tests check it against golden hashes (`model.test.ts`).
- `timeline.ts` (Engine 0.14 T11): the timeline viewer's model, **pure** like `model.ts`:
  `timelineLayout(record, { gameTick, ticks }, marks?)` lays the timeline record out as rows on
  one axis of game ticks, `placeWorldTick(clock, world)`, `timelineMarkers(layout)` and
  `timelineText(layout)` (what `window.__wwDebugger.timeline()` prints). Tested in Node
  (`timeline.test.ts`).
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

## The timeline viewer

Engine 0.14 T11 (decisions 2 and 4): the Timeline panel draws `DebugSession.timeline()`, the
game's `timeline()` hook (T7) at the tick shown with its `clock` filled from the world tick at
every game tick from 0 there (`compressClock`, as the CLI fills it; a dump shows its own record).
The axis is **game ticks** 0 to the run's last tick; a world tick is placed at the first game tick
the world reached it at (`gameTickOf`), and one past the clock (a window that closes later, an
open mission's commit) as if the world then moves one tick per game tick (`projected`, drawn
faint). Rows, top to bottom:

- `run`: now, and for a replay its failing tick and the tick before, and the first stored-hash
  mismatch;
- `clock`: where the world moves (`moving`) and where it stands still while a round is played
  (`still`);
- `frozen:<event>:<from>`: each frozen span (still frozen: up to now);
- `experience:<mission>`: the experience ticks spent inside a mission (from its open);
- `opportunity:<id>`: the window `opens`-`closes` coloured by its status now, and a marker per
  status change with its cause (`offered by time`, `taken by mission:sabotage`, `closed by time`);
- `mission:<id>`: open to commit, with markers for the open and the commit (outcome and
  resolution).

Clicking a marker goes to its game tick (`goto`). `window.__wwDebugger.timeline()` is the same
layout as text (`timelineText`), `timelineLayout()` the rows; both null for a game with no world.
On the mini siege's `played.run.json` at tick 666: the sabotage window taken and the mission
opened at game 40, the siege frozen from game 40 to 566, the world standing at 40 from game 40 to
446, and the commit (`both-burnt`, played) at game 566 (world 160).

## Failing replays

A replay file (a run file with `replay`, written by a failing `pnpm cli run`, whose result and
text print `pnpm cli debug <replayFile>`) opens at `replay.failure.tick`. The job carries the
stored failure (`StoredFailure`: tick, kind, path, op, expected, message) and the page shows it
above the panels with what it finds there (`DebugSession.failure()`, a `FailureReading`:
`reached`, `actual`, `reproduced`, `tickBefore`), with buttons for the failing tick and the tick
before. `replay.hashes` are expected hashes like any other: the first that differs stops stepping
there and is shown in the banner (with a button to go there) and on the timeline's `run` row.
`debug <replay> --check --json` reports `openTick`, `failure`, `reproduced` (null for a run or
dump, or a save `code` check, which the page does not make) and `hashMismatch` (`{ tick, expected,
actual, source }` or null); a replay that does not reproduce is exit 4.

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
  without the cache, checks, mismatches, the mini siege's event log, diff and search; the
  timeline record against `pnpm cli timeline`'s, a replay's failure; and `timeline.test.ts`, the
  layout and its text).
- `pnpm test engine/tools/debug.test.ts` (the command: kinds, errors, the job route, and `--check`
  on a run, a dump, a replay (its failed check, reproduced, and a stored hash that differs) and a
  stored-hash mismatch in headless Chromium).
- `pnpm test tests/browser/debugger.test.ts` (the page on a mini siege run, stepped forward and
  back through the hook; a failing replay opened at its failing tick, its tick-before button; the
  played run's timeline as text and rows, and its markers clicked). Browser tests skip where Chromium is not installed, never in CI.
