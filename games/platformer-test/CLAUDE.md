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
  Content kinds, and `LEGEND` in `kits/platformer/legend.ts`), played in id order. Three today
  (the door level, 0.7 T5, makes four), all `"scroll": "right"`, each about a few kit rules:
  - `level-1`: a short, easy first level, 48x10 tiles: a bump block with a
    coin over the runway, two floor coins, a 2-tile gap, a 2-high step, a 3-tile gap with an arc
    of three coins over it, one `walker` (woken as the view nears it, stompable), a 2-high wall,
    a 1-tile gap and the goal.
  - `level-2` ("bricks and shells"), 56x11: three bricks overhead (one breaks), a one-way
    platform under three coins, a 4-wide, 1-deep trench with a `walker` pacing in it (it turns at
    the trench walls), a `shell-walker` that a stomp turns into a still `shell`, kicked back into
    the trench where it defeats the walker (and stays, bouncing), a 2-high block, a 5-tile gap
    that wants a running jump, and the goal tucked one tile up in the level's last column, so the
    player runs into the right edge and jumps into it.
  - `level-3` ("spikes, pits and lives"), 60x10: a spike (`^`) on the runway, a 3-tile pit, two
    `walker`s close together (the first hurts, the second is passed while invulnerable), a
    `ledge-walker` pacing a floating platform, a 3-spike pit, a 2-tile island with two coins, one
    more spike and the goal.
- `content/profiles/hopper.profile.json`: the game's own physics profile (`hopper`): it started
  from the kit's fixture profile and was changed (a little slower walk and run cap, a slower
  walker, 2 hit points, 3 lives, a 6-tick jump buffer, a softer middle jump tier). Its actor
  types: `walker`, `ledge-walker` (`turnAt: ledges`), `shell-walker` (a stomp turns it into a
  `shell`) and `shell` (still, kickable at 12288). Profiles live in
  their own folder because the `level` glob `content/levels/*.json` would claim them too.
- TypeScript is glue only:
  - `content.ts`: `testKinds()`, `loadTest(files)`, `testStages(content)` (the levels in play
    order: by id, numbers compared as numbers, `level-2` before `level-10`; each paired with the
    profile it names by the kit's `levelStages`), `mustLoad`;
  - `headless.ts`: `createGame(content, seed, opts?)`, the headless contract, a few lines: the
    kit's `LevelSequence` over `testStages(content)` with the run's seed and switched-off rules
    (`TestGame` and `TestSnapshot` are the kit's `LevelSequence` and `SequenceSnapshot`). The
    level flow is the kit's (`kits/platformer/CLAUDE.md`, Level sequences): `LEVEL_PAUSE` (60)
    ticks after a level ends, then the next level or the failed one afresh; the snapshot is the
    kit's plus `stage` and `pause`. (Until Engine 0.7 T2 this was a copy of the lab's: gap G1,
    fixed.)
  - `files.ts`: `TEST_FILES`, the data files through Vite's `import.meta.glob` (for the browser
    pages to come; Node reads them with `readGameFiles`).
- `platformer-test.test.ts`: content loads, a broken field is named by file and field, the level
  order (with `level-10` after `level-9`), the start state, the three levels cleared in order with
  `level-3.run.json`'s input, equal snapshots on two runs, and a failed level starting afresh
  after `LEVEL_PAUSE`.

## Run files

Every run file starts at the first level (a run file cannot start at a later one: gap G9), so
`level-2.run.json` holds `level-1`'s input and then its own, and `level-3.run.json` both before
its own. Each level starts `LEVEL_PAUSE` (60) ticks after the one before it is cleared: `level-2`
at tick 553, `level-3` at tick 1161.

| run       | ticks | ends at                        | guards                                                                                                                                                                                                                                                                                                         |
| --------- | ----- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level-1` | 520   | `level-1` cleared at tick 493  | gravity, walk, air-control, jump, jump-by-speed, variable-jump, solid-tiles, coins-collect, bump-blocks, goal-clears-level, actors-wake, stomping, stomp-bounce                                                                                                                                                |
| `level-2` | 1130  | `level-2` cleared at tick 1101 | gravity, fall-cap, walk, run-speed, run-hold, skid, air-control, jump, jump-by-speed, variable-jump, solid-tiles, one-way-platforms, ceiling-bump, level-bounds, coins-collect, brick-break, goal-clears-level, scroll-lock, actors-wake, walkers-turn, stomping, stomp-bounce, shell-kick, shell-hits-enemies |
| `level-3` | 2030  | `level-3` cleared at tick 1999 | gravity, fall-cap, walk, skid, friction, air-control, jump, solid-tiles, hazards-kill, pits-kill, goal-clears-level, actors-wake, ledge-turn, enemy-touch-hurts, invulnerability                                                                                                                               |

- `level-1.run.json` walks right and jumps five times: under the bump block (coin at tick 59),
  over the 2-tile gap, onto the step (standing on it at 210), over the 3-tile gap through the coin
  arc (6 coins at 282; the walker wakes in between), onto the walker (stomp at 368, bounce
  `vy` -16384), onto the wall (441) and over the last gap to the goal (cleared at 493). Its
  invariants hold 3 lives, 2 hit points and stage 0 all along.
- `level-2.run.json` (level-2 from 553): breaks the middle brick (`break` and `vy` 496 at 612:
  the head bump stops the rise), lands on the one-way platform (`y` 24576 at 668), holds run
  from 653 on (`vx` 9952 at 700, a top-tier jump over the trench at 703), stomps the
  shell-walker into a shell (765), steers back and skids on landing (`vx` 4768 at 795) while the
  walker in the trench has turned (`dir` -1 at 800), walks left into the shell and kicks it
  (856; the view stays where it was: `scrollX` 86747), the shell defeats the walker (898), lets
  go of run 7 ticks before the long gap and still takes off at the top tier (1017: `run-hold`),
  is held by the level's right edge (`x` 227840 at 1096) and jumps into the goal (1101).
  Invariants: 3 lives, 2 hit points, stage 0 or 1.
- `level-3.run.json` (level-3 from 1161) plays it as a learner would, with every life it has:
  walks into the spike (died, 2 lives, 1223), jumps it but walks into the pit (falling `vy` 17600
  at 1367 drops back to 16384 at 1368; died, 1 life, 1370), then jumps both, is hurt by the first
  walker (1 hit point, 120 ticks invulnerable, 1546) and passes the second, while the
  ledge-walker turns at its platform's edge (`dir` 1, still at `y` 24576, 1662), jumps onto the
  island, lets go and steps back (a skid, then friction: standing at `x` 171653 at 1840), hops
  the last spike and clears the level (1999) with 1 life, 1 hit point and 2 coins. Invariants:
  at least 1 life, stage 0 to 2.
- Run one: `pnpm -s cli run games/platformer-test/runs/level-2.run.json --json`. Its rules:
  `pnpm -s cli mutants games/platformer-test/runs/level-2.run.json --json` (exit 0 for each run
  file).
- The whole folder, `pnpm -s cli mutants games/platformer-test --json`, guards 31 of the kit's
  32 rules; it exits 4 with `unguarded: ["mini-games"]` until the door level (0.7 T5) adds a
  run file through its mini game, after which it must exit 0 (gap G7, feedback item 76).
- `runs/level-<n>.hashes.json` are the golden hashes (`tests/runs/run-files.test.ts`). After a
  change meant to change the state: `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`, and commit them.
- Changing a level or the profile moves every later tick, in this level's run file and in every
  later level's: re-find them with `pnpm -s cli dump <run> --tick N --json` and keep the
  assertions on what the rules decide.

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
7. (0.7 T3) The profile got the actor types the next levels use, added with the CLI
   (`pnpm -s cli add <profile> actors.shell '{...}'`, which keeps the file's one-line objects;
   `shell` before `shell-walker`, whose `stompInto` must name a type that is there).
8. `level-2` and `level-3` drawn as text, each around a few kit rules the first level does not
   use, then checked with `validate`. Single cells were fixed with
   `pnpm -s cli set <map> rows.<row>.<col> '#'` (gap G10: placing things by column in a long row).
9. Each run file: the earlier levels' input copied in, then this level's found as for step 5 (one
   jump or hold at a time, traced every few ticks), the assertions read off `dump`, and
   `mutants <run file>` until its `guards` were all guarded. Then `mutants games/platformer-test`
   for the whole game (31 of 32 rules).

## How to test

`pnpm test games/platformer-test`, `pnpm -s cli validate games/platformer-test --json`,
`pnpm -s cli run games/platformer-test/runs/level-<n>.run.json --json`,
`pnpm -s cli mutants games/platformer-test --json`, `pnpm test tests/runs`.

## Imports

- Allowed: relative paths inside `games/platformer-test`, `@engine/*` (core; backends once it has
  views) and `@kits/platformer` (later in 0.7 also `@kits/topdown`, for the door level's mini game).
- Never: other games (not even `games/platformer-lab`: copy and log a gap instead) or kits it does
  not use. Nothing in `engine/` or `kits/` imports from here.
