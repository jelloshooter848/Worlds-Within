---
name: debug-failing-run
description: Go from a failing `pnpm cli run` (exit 4, or a red tests/runs test) to its cause and a fix - read the first failing tick, open the replay in the in-browser debugger at that tick (failed check, tick before, state diff, event log, timeline), trace the checked paths over the ticks before it, dump the state there and the tick before, screenshot it, check the replay reproduces, use mutant checks to see what the run guards, then fix and rerun. Use when a run file, replay file or golden-hash test fails.
---

# Debug a failing run

Every run is repeatable from its seed, so a failure always comes back the same way: work from the
tools' output, not from guesses. Run everything from the repo root as `pnpm -s cli ... --json`
(stdout is then exactly one JSON object). Background: the run-file and CLI sections of the
[cheat sheet](../../../docs/CHEATSHEET.md) and `docs/reference/cli.md`.

## 1. Run it and read the first failing tick

```sh
pnpm -s cli run games/<game>/runs/<run>.run.json --json
```

- Exit 0: it passes. If a test still fails, it is the golden hashes (step 8).
- Exit 2: a usage mistake (path, flag). Exit 3: invalid content: fix each `errors[]` entry (it names
  `file` and the field `path`), check with `pnpm -s cli validate games/<game> --json`, then rerun.
- Exit 5: a crash. Read `error.message` and `error.stack`; it is a bug in the game's
  `headless.ts`, the kit or the engine, not in the run file.
- Exit 4: a check failed. The result holds:
  - `failure`: the **first failing tick** and check: `tick`, `kind` (`assertion` or `invariant`),
    `index` (which entry of that list), `path`, `op`, `expected`, `actual`, `message`;
  - `failures`: every check that failed at that same tick (the run stops there);
  - `hashes`: the state hashes up to that tick;
  - `replayFile`: a replay file in `.ww-out/replays/` that reproduces the failure;
  - `debug`: the line that opens that replay in the debugger, `pnpm cli debug <replayFile>`
    (step 2; also printed by the text form as `open it in the debugger: ...`).

A run file plays a game (`game`) or, from Engine 0.8, an `engine/sim` world (`world`, a
`*.world.json` scenario; sample `engine/sim/__fixtures__/village-build.run.json`). Steps 1, 3, 5,
6 and 8 work the same on a world run; a world has no input, view or kit rules, so step 4
(screenshot) and step 7 (mutants) do not apply (both exit 2 on it), and the debugger (step 2)
steps game runs only (`debug` is null; open a world run's `dump --out` file instead). Its state is the world
snapshot: compare `components.<Kind>` between dumps, and look in `engine/sim` (scenario, systems)
rather than a game.

Write down `T = failure.tick`. Everything below looks at ticks `T` and `T - 1`.

## 2. Open it in the debugger at the failing tick

```sh
pnpm cli debug <replayFile>                      # serves the page, prints the URL; Ctrl-C stops it
pnpm -s cli debug <replayFile> --check --json    # headless: what the page finds there
```

The in-browser debugger (`engine/tools/debugger/CLAUDE.md`) opens the replay **at its failing
tick** (`openTick` = `replay.failure.tick`) with the failed check shown above the panels (path,
op, expected against the actual value there) and buttons for **the failing tick** and **the tick
before**. Step and rewind (+1, -1, +10, go to tick: a rewind re-simulates from tick 0), read the
state tree (search a path) and **what changed since the previous tick**, the checks at each tick
and the event log (a game with a world: filter by world ticks, entity, cause, component). For a
game with a world the **timeline** panel shows the world clock, frozen spans, experience time,
opportunity windows (opened, taken, closed, and by what) and mission opens and commits with their
outcomes on one axis of game ticks: click a marker to go to that tick. A stored hash that differs
stops stepping at its tick and is marked in the banner and on the timeline.

`--check --json` gives `{ openTick, failure, reproduced, hashMismatch }`: `failure.actual` is the
value the page saw, `reproduced: true` says the page fails the same check at that tick, and
`hashMismatch` names the first stored hash that differs (exit 4 for either problem: go to step 5).
An agent drives the served page with Playwright through `window.__wwDebugger` (`goto(tick)`,
`state()`, `diff()`, `checks()`, `failure()`, `events(filter)`, and `timeline()`, the timeline as
text). Needs Chromium; without it, steps 3 and 5 cover the same ground with the CLI alone.

## 3. Trace the failing path, then dump the state at the failing tick and the tick before

Start with a trace of the path the failing check reads (and a few related ones) over the ticks
before it: one call, one row per tick, so you see when the value first went wrong without a dump per
tick or a throwaway script:

```sh
pnpm -s cli trace games/<game>/runs/<run>.run.json --paths <failure.path>,hero.x,hero.y --from <T-60> --to <T> --json
```

`rows` is `[{ tick, hash, values: { <path>: value } }]` (`--every K` for every K-th tick; without
`--json` it is a table). A path not in the snapshot is null and listed in `missing`: check the
spelling against a dump. Long traces are cut by the output cap (`truncated`, the whole trace in
`fullOutput`). Then dump the first tick that looks wrong, and the one before it:

```sh
pnpm -s cli dump games/<game>/runs/<run>.run.json --tick <T-1> --json
pnpm -s cli dump games/<game>/runs/<run>.run.json --tick <T> --json
```

`state` is the whole snapshot (the same object the checks' dotted paths read). Compare the two:
what changed in the one step between them (`hero`, `room`, `entities`, `events`)? `events` lists
what the last step emitted (a room change, a hit, a pickup). For an assertion at a late tick, the trace
above finds when the state first went the wrong way; tick 0 is the start, before
any step. A dump is capped like any output: if `truncated` is true, read the file in `fullOutput`.

## 4. Look at it

```sh
pnpm -s cli screenshot games/<game>/runs/<run>.run.json --tick <T> --json
```

Writes a PNG (`path` in the result; default `.ww-out/screenshots/<run>-t<tick>.png`) of the paused,
seeded frame, and checks its state hash against the headless run (`matchesHeadless: true`). Open the PNG to see where the
hero, walls and enemies really are. Needs the game's `view` entry and Chromium; without a browser it
exits with a clear error, and steps 1, 2 and 4 are enough on their own.

To see the same frame in 3D (a game with a `three` skin and a view `frame()`, such as
`games/platformer-lab`), add `--backend three`. In a container without a GPU WebGL runs on
SwiftShader, which the command refuses (exit 4, naming the renderer string) unless you add
`--allow-software-gl`. The state hash is the same whichever backend draws.

## 5. Check the replay reproduces it

```sh
pnpm -s cli run <replayFile> --json
```

The replay is the run file plus the failure and hashes it saw. Its result has
`replay.reproduced: true` and `replay.hashMismatch: null` when the failure comes back at the same
tick with the same state. If `reproduced` is false or `hashMismatch` names a tick, the run is not
deterministic: look for `Math.random`, the clock, `Map`/`Set` iteration in a snapshot, or state kept
between runs (module-level variables) in the game or kit. Fix that first: nothing else can be trusted
until two runs agree.

## 6. Decide what is wrong

- **The check is wrong** (the game does what it should; the run file expected something else): fix
  the assertion's `tick`, `path`, `op` or `value`, using the dumped values. Do not just copy `actual`
  into `value` without being sure the game is right.
- **The input is wrong** (the hero never reached the place): change `input.steps` (`frame`, `hold`)
  or `ticks`; dump to see where the hero is.
- **The content is wrong** (a wall in the way, a missing door): edit the content file with the
  editing verbs, which schema-check and read back every write:
  `pnpm -s cli get <file> <path> --json`, then `pnpm -s cli set <file> <path> <value> --json` and
  check `verified: true`. Then `validate` the game.
- **The code is wrong** (the kit or game breaks a rule): fix it in the kit or game and add or
  extend a unit test there.

## 7. Mutant checks: does the run guard what it should?

```sh
pnpm -s cli mutants games/<game>/runs/<run>.run.json --json
```

Plays the run once per kit rule switched off. `guarded` lists the rules whose loss makes the run
fail; `weak` lists the rules it is expected to guard and does not notice: the run file's `guards`
when it gives them, else every rule. If your fix was to a rule (say `doors-change-room`), it
should be in `guarded`; if it is in `weak`, add an assertion that would catch it. To reproduce one
mutant: `pnpm -s cli run <run-file> --disable-rule <id> --json`.

A kit whose hook says `strictMutants: true` makes a weak rule fail the command (exit 4, `strict:
true` in the result); other kits (topdown) only report it (exit 0). For a strict kit, give each run
file the `guards` it is meant for, and check the game as a whole:

```sh
pnpm -s cli mutants games/<game> --json
```

That plays every run file of the game; `rules[].guardedBy` lists the run files that guard each
rule and `unguarded` the rules none does (exit 4 for a strict kit), and a run whose own `guards`
are not all guarded has them in its `runs[].weak` (also exit 4). Fix an unguarded rule by
strengthening a run file or adding one that the rule decides.

## 8. Fix, rerun, and keep the golden hashes honest

```sh
pnpm -s cli run games/<game>/runs/<run>.run.json --json   # exit 0
pnpm -s cli run games/<game>/runs/<run>.run.json --json   # same hashes again
```

`tests/runs/run-files.test.ts` compares every run file's hashes with its committed
`<run>.hashes.json`. If the fix was meant to change the game's state, regenerate them with
`WW_UPDATE_GOLDEN=1 pnpm test tests/runs` and commit them with the fix. If the state was not meant
to change and the hashes did, the fix changed more than intended: go back to step 2 (the
debugger on the run file shows the first golden hash that differs) or step 3.

Finish with `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Don'ts

- Don't delete or weaken a failing assertion to make a run pass; find out why it fails.
- Don't regenerate golden hashes to hide a change you can't explain.
- Don't edit replay files in `.ww-out/`: they are output, rewritten on every failing run. Copy one
  into `games/<game>/runs/` (removing its `replay` field) only if it should become a permanent run.
