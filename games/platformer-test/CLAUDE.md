# games/platformer-test

The stacking test's game (Engine 0.7, `docs/ROADMAP.md`, "0.7 The stacking test"): a small
original platformer built on `kits/platformer` with the engine as it is, to find out what is
missing. Every gap found while building it goes into `docs/reports/stacking-test.md` at once.
It is also a worked example for LLM users: this file says how it was built, step by step.
At Engine 0.15 it grows into the platformer sample, `games/samples/platformer/`, and this folder
goes away (its run files move with it and stay green).

## The rule

This folder holds **only content, skins and thin glue** (DESIGN.md's rule of thumb: if two games
could use it, it is engine; if it is content, it is the game). Game rules go in data files
(levels, profiles), never in code here. Anything this game has to write that another game would
write too is a gap: log it in the report, and move it into the engine or the kit (or name the
release that will).

## Files

- `game.json`: the manifest: kit `platformer`, 256x240, seed 1, `headless.ts`. No `view` yet
  (2D and 3D views come with 0.7 T7 and T8), so there is no `index.html` and no screenshot.
- `content/levels/<id>.json` + `<id>.map.txt`: levels (format: `kits/platformer/CLAUDE.md`,
  Content kinds, and `LEGEND` in `kits/platformer/legend.ts`). Today one:
  - `level-1`: a short, easy first level, 48x10 tiles, `"scroll": "right"`: a bump block with a
    coin over the runway, two floor coins, a 2-tile gap, a 2-high step, a 3-tile gap with an arc
    of three coins over it, one `walker` (woken as the view nears it, stompable), a 2-high wall,
    a 1-tile gap and the goal.
- `content/profiles/hopper.profile.json`: the game's own physics profile (`hopper`): it started
  from the kit's fixture profile and was changed (a little slower walk and run cap, a slower
  walker, 2 hit points, 3 lives, a 6-tick jump buffer, a softer middle jump tier). Profiles live in
  their own folder because the `level` glob `content/levels/*.json` would claim them too.
- TypeScript is glue only:
  - `content.ts`: `testKinds()`, `loadTest(files)`, `testStages(content)` (the levels in play
    order: by id, numbers compared as numbers, `level-2` before `level-10`; each with the
    profile it names), `mustLoad`;
  - `headless.ts`: `TestGame` and `createGame(content, seed, opts?)`, the headless contract. It
    plays the levels in order: once a level is `cleared` or `failed` it waits `LEVEL_PAUSE` (60)
    ticks, ignoring input, then starts the next level (after the last, the first again) or the
    failed one afresh, each a new `PlatformerWorld` with the run's seed and switched-off rules.
    Its snapshot is the kit's (`snapshotWorld`, every path in `kits/platformer/CLAUDE.md`) plus
    `stage` and `pause`. This flow is a minimal copy of the lab's (gap G1; 0.7 T2 moves it into
    the kit);
  - `files.ts`: `TEST_FILES`, the data files through Vite's `import.meta.glob` (for the browser
    pages to come; Node reads them with `readGameFiles`).
- `platformer-test.test.ts`: content loads, a broken field is named by file and field, the level
  order (with `level-10` after `level-2`), the start state, equal snapshots on two runs, and a
  failed level starting afresh after `LEVEL_PAUSE`.

## Run files

| run       | ticks | ends at                       | guards                                                                                                                                                          |
| --------- | ----- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level-1` | 520   | `level-1` cleared at tick 493 | gravity, walk, air-control, jump, jump-by-speed, variable-jump, solid-tiles, coins-collect, bump-blocks, goal-clears-level, actors-wake, stomping, stomp-bounce |

- `level-1.run.json` walks right and jumps five times: under the bump block (coin at tick 59),
  over the 2-tile gap, onto the step (standing on it at 210), over the 3-tile gap through the coin
  arc (6 coins at 282; the walker wakes in between), onto the walker (stomp at 368, bounce
  `vy` -16384), onto the wall (441) and over the last gap to the goal (cleared at 493). Its
  invariants hold 3 lives, 2 hit points and stage 0 all along.
- Run it: `pnpm -s cli run games/platformer-test/runs/level-1.run.json --json`. Its rules:
  `pnpm -s cli mutants games/platformer-test/runs/level-1.run.json --json` (exit 0). The whole
  folder (`mutants games/platformer-test`) exits 4 for now: the kit is strict and the game's levels
  do not use every kit rule (gap G7, feedback item 76).
- `runs/level-1.hashes.json` are the golden hashes (`tests/runs/run-files.test.ts`). After a
  change meant to change the state: `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`, and commit them.
- Changing the level or the profile moves every later tick: re-find them with
  `pnpm -s cli dump <run> --tick N --json` and keep the assertions on what the rules decide.

## How it was built so far

1. (0.7 T1) `game.json` copied in shape from the lab (kit, screen, seed, `headless`), with only
   the `level` and `profile` content globs.
2. The profile: the kit's fixture numbers as a start, then the game's own values.
3. `level-1.map.txt` drawn as text, then checked with `pnpm -s cli validate games/platformer-test
--json` (exit 0).
4. `content.ts` and `headless.ts`: the lab's glue cut down to what this game needs (no fixture
   level, no mini games, no skins yet). Each copied piece is a gap in the report (G1 to G5).
5. The run script was found by playing the level headless and printing the player's position
   every few ticks, adding one jump at a time where the player fell or stopped (gap G8: the CLI
   has no trace command), then the assertions read off `dump` at the ticks that matter, and the
   `guards` checked with `mutants` on the run file.
6. Golden hashes with `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`.

## How to test

`pnpm test games/platformer-test`, `pnpm -s cli validate games/platformer-test --json`,
`pnpm -s cli run games/platformer-test/runs/level-1.run.json --json`, `pnpm test tests/runs`.

## Imports

- Allowed: relative paths inside `games/platformer-test`, `@engine/*` (core; backends once it has
  views) and `@kits/platformer` (later in 0.7 also `@kits/topdown`, for the door level's mini game).
- Never: other games (not even `games/platformer-lab`: copy and log a gap instead) or kits it does
  not use. Nothing in `engine/` or `kits/` imports from here.
