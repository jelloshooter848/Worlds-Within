# kits/platformer

The platformer kit: gameplay rules for a side-scrolling platformer, extracted from SMBC as rules
only, with generic names and none of its content. Today (Engine 0.5, T5) it holds the content
kinds and a headless world: integer physics, tile collision and named movement rules for the
player. Level objects and enemies, the mini game hook and presentation frames follow in later
tasks of the release.

- `legend.ts`: `LEGEND`, the level text format: one character per 16x16 tile (`.` empty, `#`
  solid, `B` breakable brick, `?` bump block, `=` one-way platform, `^` hazard, `o` coin, `@`
  player start, `G` goal, `!` mini-game trigger, reserved for the mini game hook). Enemy spawns
  have no fixed character: the level header's `spawns` maps characters of its own to actor types.
- `level.ts`: `levelSchema` (the level header plus its `map`), `LevelDef`, `levelCells`,
  `levelSize` and `checkLevel(level, profile)`, the checks beyond the shape.
- `profile.ts`: `profileSchema`, `ProfileDef` and `profileKind()`: physics profiles, the player's
  movement numbers and the actor types (`walker`, `shell`, ...) with data-set behaviour.
- `schema.ts`: `levelKind()`, the `level` content kind (header JSON + `.map.txt` grid) whose
  `checkAll` runs `checkLevel` against the profile each level names.
- `rules.ts`: `PLATFORMER_RULES`, the kit's named rules (listed under Movement rules below).
- `tiles.ts`: `TileGrid`, a level's tiles as the world collides with them (cell kind and collision
  per tile; empty outside the grid, so the left and right edges are the `level-bounds` rule's).
- `body.ts`: `Body` (a box in sub-pixels, `x`/`y` its top-left corner, velocity, `onGround`,
  `hitWall`, `bumped`), `makeBody`, `moveX` and `moveY`: SMBC-style tile collision, x then y.
- `player.ts`: `Player`, moved by the profile's `player` numbers once per tick
  (`Player.atStart(col, row, ...)` centres it in the start tile, feet on its bottom edge).
- `world.ts`: `PlatformerWorld(level, profile, { seed, disabledRules })`: checks the level
  (`checkLevel`, and that the profile is the one it names; throws otherwise), owns the seeded `rng`,
  the `rules` switch, the tiles and the player; `update(input)` steps one tick and pushes
  `PlatformerEvent`s (`jump` with its tier, `land`, `bump` with col/row, `fell`).
- `snapshot.ts`: `snapshotWorld(world, events?)`, a JSON-safe, whole-number snapshot with no
  presentation state, and `platformerGame(world)`, the headless contract (`engine/core/headless.ts`)
  as `topdownGame` does it: each step takes that step's events.
- `kit.ts`: `kit`, the kit's hook for the tools (`defineKit` from `engine/core/kit.ts`): name
  `platformer`, kinds `level` and `profile`, `PLATFORMER_RULES` and `strictMutants: true`.
  `index.ts` re-exports the rest (not the hook); games import it as `@kits/platformer`.

## Imports

- Only `kits/platformer` itself (relative paths) and `@engine/core/*`, never the core's drawing
  and output side (`FORBIDDEN_CORE` in `config/layers.js`: the `Renderer`, sprite sheets,
  `assets/`, audio output, scenes, the loop). Tests may also use `@engine/backends/null`.
- Never other backends, `engine/sim`, `engine/tools`, other kits (not even `kits/topdown`) or games.
  `tests/architecture/dependency-rule.test.ts` checks every import.
- Any core file imported at run time must be on `PURE_CORE` (`tests/architecture/purity.test.ts`).

## Rules only

- **Never draws (enforced).** The kit describes what happened; a backend draws its frames from a
  read-only snapshot through a skin. No drawing call in any non-test file
  (`tests/architecture/no-drawing.test.ts`). State, never frame names or colours.
- **No world rules, no content.** The kit reads what a level gives it and reports what happened.
  Levels and profiles for real games live in `games/`; the kit keeps only the tiny fixtures in
  `__fixtures__/` (tests only), and `tests/architecture/no-content.test.ts` fails on content in its
  other files. `LEGEND` is the text format, not a level.
- **No SMBC names.** Actor types and fields have generic names. The fixture profile's numbers match
  SMBC's default runner (values only).
- **Whole numbers.** Positions in sub-pixels (1/256 px, `SUB`), velocities and accelerations in
  1/4096 px per tick (`VEL`), as SMBC, so results never depend on floating-point rounding.
- **Named rules, strict mutants.** Every gameplay rule the kit adds (gravity, variable jump,
  stomping, ...) gets an id in `rules.ts` and its code is guarded by `rules.isOn(id)`. The hook sets
  `strictMutants: true`, so `pnpm cli mutants` fails when a rule is not guarded by a run file.
- **Purity (lint-enforced):** no `Math.random`, `Date.now`, `performance.now` or DOM globals.

## Units

`engine/core/math/units.ts`, as SMBC: positions in sub-pixels (`SUB` = 256 per px; a tile is
`TILE_SUB` = 4096), velocities and accelerations in 1/4096 px per tick (`VEL`); a body moves
`velToSub(v)` = `v >> 4` sub-pixels a tick (floored), x first, then y. Down is positive. The
snapshot's `player.x`/`player.y` are the body position: the bottom centre of its box. No floats in
state: `world.test.ts` checks `Number.isInteger` on every snapshot number.

## Movement rules

One tick of the player (`player.ts`), every number from the profile's `player`:

1. run (or attack) held sets the run timer to `runHold`, else it counts down; running = held or
   timer > 0;
2. on the ground: no direction means friction down to 0 (under `minWalk` it stops); from rest a
   direction starts at `minWalk`; the other way skids (`skid` off |vx|, turning round at `minWalk`
   once |vx| <= `skidTurn`); the same way accelerates by `walkAccel`/`runAccel` up to
   `maxWalk`/`maxRun`, and over the cap slows by `friction` to it. In the air the direction steers
   towards `airCap` (`maxRun` only if the take-off |vx| was over `maxWalk`), no friction;
3. a jump press (remembered `jumpBuffer` ticks, `bufferedJump`) on the ground takes off at the tier
   picked by |vx| (the first tier whose `below` is over |vx|, else the last);
4. move x (solid tiles stop it), then y (a standing body probes 1 sub-pixel down; falling, it lands
   on solid tiles and on one-way tiles its feet were above; rising, a solid tile puts the head back
   under it);
5. on the ground the jump ends and vy is 0; in the air gravity adds the tier's `holdGravity`
   while jump is held and the player rises, else its `gravity`; past `maxFall` vy drops to
   `fallReset`.

Then the world holds the player inside the level's left and right edges and stops it, once its top
is below the last row, as fallen (`fell`). There is no corner slip and no coyote time yet.

The player starts as SMBC's does: placed on the start tile but not yet on the ground, so tick 0 is
an air tick (air control from rest gives `minWalk`, and the first tier's `gravity` is added) and
tick 1's fall lands it (a `land` event). The first tick a jump can start on is tick 2.

## Golden traces (SMBC)

`golden.test.ts` replays six scripts (walk, run then skid and let go, tap jump, held jump, a
running jump over a gap into a wall, a jump into a ceiling) on `__fixtures__/golden/flat.map.txt`
with `runner.profile.json`, and compares the body's `x`, `y`, `vx`, `vy` with SMBC v0.4.73
(`e0eeee7`) tick by tick; a failure names the script, the first differing tick and field, and
both rows. The traces, the command and the generator source are in `__fixtures__/golden/README.md`;
the test reads only the committed JSON. **If you change the movement code or the fixture profile,
this test must stay green**; never edit a trace by hand: regenerate it from SMBC as the README
says.

SMBC behaviour deliberately left out of the kit (and kept out of the traces' scripts):

- Character-specific moves: crouching and crouch-slides, slides and dash jumps, wall cling, wall
  jumps and wall climbs, flutter, air (double) jumps, the "cut" jump on release, instant
  acceleration, inertia-style movement, rise/launch profiles, stairs and vines, swimming and every
  water rule, and power states (only the small 12x16 body).
- Running over one-tile gaps at speed (SMBC's `crossGapMinVx`); the traces avoid one-tile gaps.
- Coyote time (an assist, 0 for the default runner) and SMBC's Classic-mode rule variants.
- The camera's left edge stopping a player who walks back (scroll lock comes with T7's `scroll`
  work); the scripts stay clear of it.
- Start modes other than standing (pipe exit, fall-in, auto-walk, ...).

Rule ids (`rules.ts`), each guarded by `rules.isOn(id)` and each made to fail a test in
`world.test.ts` when off: `gravity`, `fall-cap`, `walk`, `run-speed`, `run-hold`, `friction`,
`skid`, `air-control`, `jump`, `jump-by-speed`, `variable-jump`, `solid-tiles`,
`one-way-platforms`, `ceiling-bump` (off: the head stays under the tile but the rise goes on),
`level-bounds`.

## Content kinds

- `level` (`levels/<id>.json` + `levels/<id>.map.txt`): `id`, `profile` (a `profile` id), `scroll`
  (`right` default, `free`, `none`), `size` (optional `[cols, rows]`; the size comes from the grid
  and must match), `spawns` (`{ "<char>": { actor, facing } }`), `blocks` (what each `?` holds in
  reading order: `coin`, `coins`, `powerup`, `life` or `actor:<type>`; all coins when left out)
  and `map`. Schema codes: `bad_spawn_key` (more than one character, a space or a legend
  character), `size_mismatch`, `wrong_block_count`, plus the grid's `ragged_row`, `unknown_char`,
  `empty_grid` at the `.map.txt` line.
- `checkAll` (`checkLevel`), once every file passes its schema: `no_start`, `two_starts` (at each
  extra `@`, row/col), `no_goal`, `missing_profile` (at `profile`) and `unknown_actor` (at each map
  cell using a spawn whose actor the profile lacks, with row/col; at `spawns.<char>.actor` when no
  cell uses it; at `blocks.<n>` for a block's `actor:<type>`).
- `profile` (`<id>.profile.json`): `player` (`box`, `minWalk`, `walkAccel`, `runAccel`,
  `friction`, `skid`, `skidTurn`, `maxWalk`, `maxRun`, `runHold` ticks, `jumps` tiers of
  `{ below?, speed, holdGravity, gravity }` with no `below` on the last, `jumpBuffer?` ticks
  (0 when left out), `maxFall`, `fallReset`,
  `stompBounce`), `actorGravity`, `actorMaxFall` and `actors` by name (`box?`, `speed`, `turnAt`
  `walls`/`ledges`, `stompable`, `stompInto?`, `kickable`, `kickSpeed?`, `harms`). Codes:
  `bad_jump_tiers`, `bad_speed_caps`, `unknown_actor` (a `stompInto` that is not an actor type)
  and `missing_field` (a kickable actor with no `kickSpeed`).

## Testing

`pnpm test kits/platformer`: `level.test.ts` and `profile.test.ts` check good and broken inputs
(file, path, code, row and col); `kit.test.ts` loads the fixtures as a game would (with
`loadContent` and the kit's hook) and checks the cross-file problems. `world.test.ts` holds the
movement tests as a list of cases, plays each with every rule on, then with each named rule off in
turn and fails if a rule leaves every case passing; `golden.test.ts` checks the movement against
SMBC (above); `world.test.ts` also checks that two runs of the same input
and seed give equal `canonicalJson` snapshots tick by tick, and that snapshots hold whole numbers. After changing a schema or a
description, run `pnpm docs:gen` (the schema reference lists both kinds; their examples are
`docs/reference/examples/level.json`, `level.map.txt` and `profile.json`).
