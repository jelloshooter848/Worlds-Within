# kits/platformer

The platformer kit: gameplay rules for a side-scrolling platformer, extracted from SMBC as rules
only, with generic names and none of its content. Today (Engine 0.5, T9) it holds the content
kinds and a headless world that plays a whole level: integer physics, tile collision and named
movement rules for the player, level objects (coins, bump blocks, bricks, hazards, pits, goals),
data-set enemies (walkers and shells: stomps, kicks, harm), hit points with invulnerability,
lives, the camera's scroll lock and the mini game hook (a trigger that pauses the level for a
mini game and acts on its result), and its presentation frames (`present.ts`, T9). Since Engine
0.7 it also holds the level-after-level flow (`sequence.ts`, `LevelSequence`).

- `legend.ts`: `LEGEND`, the level text format: one character per 16x16 tile (`.` empty, `#`
  solid, `B` breakable brick, `?` bump block, `=` one-way platform, `^` hazard, `o` coin, `@`
  player start, `G` goal, `!` mini-game trigger: what it starts is the next entry of the header's
  `triggers`). Enemy spawns have no fixed character: the level header's `spawns` maps characters
  of its own to actor types.
- `level.ts`: `levelSchema` (the level header plus its `map`), `LevelDef`, `levelCells`,
  `levelSize` and `checkLevel(level, profile)`, the checks beyond the shape.
- `profile.ts`: `profileSchema`, `ProfileDef` and `profileKind()`: physics profiles, the player's
  movement numbers and the actor types (`walker`, `shell`, ...) with data-set behaviour.
- `schema.ts`: `levelKind()`, the `level` content kind (header JSON + `.map.txt` grid) whose
  `checkAll` runs `checkLevel` against the profile each level names.
- `rules.ts`: `PLATFORMER_RULES`, the kit's named rules: `MOVEMENT_RULES` (under Movement rules
  below), then `OBJECT_RULES` (under Level objects and enemies), then `MINI_GAME_RULES` (under
  Mini games).
- `tiles.ts`: `TileGrid`, a level's tiles as the world collides with them (a cell kind per tile,
  collision from `CELL_COLLISION` in `legend.ts`; empty outside the grid, so the left and right
  edges are the `level-bounds` rule's). The world changes cells as it plays (`setCell`: a coin
  taken, a block `used`, a brick broken) and `changed()` lists them for the snapshot.
- `body.ts`: `Body` (a box in sub-pixels, `x`/`y` its top-left corner, velocity, `onGround`,
  `hitWall`, `bumped`), `makeBody`, `moveX` and `moveY`: SMBC-style tile collision, x then y.
- `player.ts`: `Player`, moved by the profile's `player` numbers once per tick
  (`Player.atStart(col, row, ...)` centres it in the start tile, feet on its bottom edge).
- `actor.ts`: `Actor`, one enemy of an actor type from the profile: a body that waits until woken,
  walks `dir * speed`, turns at walls and (for `turnAt: ledges`) at drops, and falls with
  `actorGravity`; `id` is its number in the level, kept when a stomp changes its type.
- `world.ts`: `PlatformerWorld(level, profile, { seed, disabledRules, viewWidth, miniGames })`:
  checks the level (`checkLevel`, and that the profile is the one it names; throws otherwise), owns the
  seeded `rng`, the `rules` switch, the tiles, the player, the actors, `coins`, `lives`,
  `scrollX` (the view's left edge; the view is `viewWidth` px wide, 256 by default) and `outcome`
  (`playing`, `cleared`, `failed`), the mini-game `triggers` (`TriggerState`) and `miniGame`
  (the `MiniGameRun` being played, or null) and `endedRound` (the `EndedRound`, a run with its
  `result`, on the tick it ended, else null; gap G20); `update(input)` steps one tick and pushes
  `PlatformerEvent`s (below).
- `snapshot.ts`: `snapshotWorld(world, events?, ended?)`, a JSON-safe, whole-number snapshot with no
  presentation state (`ended` defaults to the world's `endedRound`; `snapshotEndedRound` and
  `EndedRoundSnapshot` are its `endedRound` key), and `platformerGame(world)`, the headless contract (`engine/core/headless.ts`)
  as `topdownGame` does it: each step takes that step's events.
- `present.ts`: `presentWorld(world, events?, { size, state, miniGameFrames })`, the world as a
  read-only `PresentFrame` (under Presentation frames), and `PlatformerPresentState`, what a
  stream of frames remembers outside the world; `platformerFrames(size?)`, the kit's
  `FrameSource` for the engine's `FrameStream` (`@engine/core/present`): a fresh state per world
  and `presentWorld` at `size`, so a game's stream is `new FrameStream(platformerFrames(screen))`.
- `sequence.ts`: `LevelSequence(stages, { seed, disabledRules, miniGames, pause, start })`, levels
  played one after another as the headless contract (under Level sequences), `LevelStage`
  (`{ level, profile }`), `levelStages(levels, profiles, who?)` (each level paired with the
  profile it names), `levelsInPlayOrder(levels, first?, campaign?)`,
  `contentStages(content, { first?, campaign?, who? })`,
  `LEVEL_PAUSE`, `SequenceSnapshot`, and (Engine 0.14, gap G9) `stageStarts(stages)` and
  `startStage(start)` (a run file's start stage, below). `LevelSequence` is a `HostedGame`
  (`engine/core/headless.ts`, Engine 0.10 gap G37): `world`, `events` and `miniGame()`.
- `kit.ts`: `kit`, the kit's hook for the tools (`defineKit` from `engine/core/kit.ts`): name
  `platformer`, kinds `level` and `profile`, `PLATFORMER_RULES`, `strictMutants: true` and
  `miniGameUses: levelMiniGameUses` (Engine 0.10, gap G16: every level's `triggers.<i>.game` and
  `.params`, so `validate` checks them against the game's mini games).
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

Then the world holds the player inside the level's left and right edges (and the view's left edge,
under Level objects and enemies). There is no corner slip and no coyote time yet.

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
- The camera's left edge stopping a player who walks back (the `scroll-lock` rule); the traces'
  level has `"scroll": "none"`, so it never applies to them.
- Start modes other than standing (pipe exit, fall-in, auto-walk, ...).

Movement rule ids (`MOVEMENT_RULES` in `rules.ts`), each guarded by `rules.isOn(id)` and each made
to fail a test in `world.test.ts` when off: `gravity`, `fall-cap`, `walk`, `run-speed`, `run-hold`, `friction`,
`skid`, `air-control`, `jump`, `jump-by-speed`, `variable-jump`, `solid-tiles`,
`one-way-platforms`, `ceiling-bump` (off: the head stays under the tile but the rise goes on),
`level-bounds`.

## Level objects and enemies

One tick of the world (`world.ts`; nothing happens once the outcome is `cleared` or `failed`):

1. the player's invulnerability counts down; the player moves (above);
2. a head bump (`bump` event) on a bump block gives what it holds and leaves it `used`
   (`bump-blocks`; a `block` event with the content): `coin` a coin, `coins` a coin a bump for
   `MULTI_COIN_HITS` (10) bumps, `powerup` one hit point up to `maxHp`, `life` a life,
   `actor:<type>` that actor, awake, on top of the block (`spawn`). On a brick it breaks it when the
   player has `breakBricksAt` hit points or more (`brick-break`; `break` event); else it is only a
   bump;
3. the level's edges hold the player in (`level-bounds`); with `"scroll": "right"` the view's left
   edge does too (`scroll-lock`). Then the view follows the player's centre, held at its middle,
   inside the level: `right` never scrolls back (with `scroll-lock` off it scrolls back like
   `free`), `free` scrolls both ways, `none` never scrolls;
4. an actor wakes once it is within `WAKE_MARGIN` (2 tiles) of the view (`actors-wake`; off, every
   actor is awake from the start); awake actors move (`actor.ts`): a wall turns one round
   (`walkers-turn`; off, it stands against the wall), a `turnAt: ledges` type turns before a drop
   (`ledge-turn`); actors below the last row are gone. A moving kickable actor (a kicked shell)
   defeats every other awake actor it touches (`shell-hits-enemies`; `defeat` event);
5. the player against each awake actor it overlaps (one in its `kickGrace` ticks after a kick or
   a stomp is skipped): a still kickable actor is kicked away from the player at its `kickSpeed`
   (`shell-kick`; `kick`); a player who moved down this tick with its feet, before the move, in the
   actor's top 3/5 (SMBC's test) stomps a `stompable` actor (`stomping`; `stomp` with `into`): it
   becomes its `stompInto` type (same id, place and way, still if that type's `speed` is 0) or is
   gone, and the player bounces at `stompBounce` with the normal gravity (`stomp-bounce`);
   otherwise a `harms` actor takes a hit point (`enemy-touch-hurts`; `hurt` with the hp left),
   unless the player is invulnerable; a hit starts `invulnTicks` of invulnerability
   (`invulnerability`);
6. the tiles the player's box covers: a coin is taken (`coins-collect`; `coin` with the count), a
   hazard kills (`hazards-kill`), a goal ends the level as `cleared` (`goal-clears-level`;
   `cleared`);
7. a player whose top is below the last row dies (`pits-kill`; off, it falls on for ever).
8. an armed mini-game trigger the player touches starts its round (`mini-games`; under Mini
   games); while a round runs, a tick steps only the round.

A death (`died` with `cause` `pit`, `hazard` or `hurt` at 0 hit points, and the lives left) takes
a life; with lives left the player starts again at the start with full hit points (`respawn`; the
view goes back to the start, the actors and tiles stay as they are), else the outcome is `failed`.

Events (`PlatformerEvent`, the last step's in the snapshot): `jump` (tier), `land`, `bump`,
`block`, `break`, `coin`, `spawn`, `stomp`, `kick`, `defeat`, `hurt`, `died`, `respawn`,
`cleared`, `mini-game` and `mini-game-end` (under Mini games). They are deterministic, so they
are part of the hashed snapshot.

Left out for now (simplifications, not SMBC's full behaviour): a power-up is given at once (no
moving item), a bump does not hit actors standing on the block, actors do not turn at each other,
a respawn is immediate (a presentation can add the pause), and there is no score or timer.

Object rule ids (`OBJECT_RULES` in `rules.ts`), each made to fail a test in `objects.test.ts` when
off: `coins-collect`, `bump-blocks`, `brick-break`, `hazards-kill`, `pits-kill`,
`goal-clears-level`, `scroll-lock`, `actors-wake`, `walkers-turn`, `ledge-turn`, `stomping`,
`stomp-bounce`, `shell-kick`, `shell-hits-enemies`, `enemy-touch-hurts`, `invulnerability`.

## Mini games

The hook is SMBC's `MiniGameDef` made generic: the contract is `engine/core/minigame.ts`
(`MiniGameDef { id, title, create(ctx, seed) }`, `MiniGame { step, snapshot, result, present? }`,
`MiniGameResult` `pass` | `fail` | `quit`), which is pure and has no scenes, so the kit hosts mini
games headless. The kit defines no mini games: **the game supplies the defs** as the world's
`miniGames` option (checked by `miniGameTable`: well-formed ids, none twice), and the world throws
when a level's trigger names an id that is not there. A game that also exports them from its
headless module (`miniGames(content)`, `engine/core/headless.ts`) gets that, and each trigger's
params against the def's `paramsSchema`, checked by `pnpm cli validate` (Engine 0.10, gap G16).

- A level's `!` cells are triggers; the header's `triggers` gives one entry per `!` in reading
  order: `{ game, params?, pass?, fail?, quit?, look? }`. `params` (JSON) is handed to the round as
  `ctx.params`; each result's list of outcomes applies in order (`TRIGGER_OUTCOMES` in
  `level.ts`): `coins:<n>` (n coins), `life`, `clear` (the level is `cleared`), `respawn` (the
  player stands on the trigger again, with its hit points kept), `open:<col>:<row>` (that tile is
  emptied: a gate). Left out, a result does nothing. `look` (an id, lower-case letters, digits
  and `-`; Engine 0.11, gap G13) is presentation only: the trigger's entity is tagged
  `look:<id>`. It is not in the snapshot, so adding one moves no hash.
- Each tick, after the pit check, a trigger the player overlaps starts a round when it is armed
  (`mini-games`; `mini-game` event with `trigger`, `game` and `attempt`): `def.create({ params,
attempt }, seed)`, the seed drawn from the world's `rng`. A trigger is disarmed by its round and
  re-armed once the player no longer touches it, so standing on it (or a `respawn` onto it) does
  not start another round.
- While the round runs, `update(input)` steps only the round (the frame counter goes on; the
  player, actors, view and tiles stay as they are), through the engine's `RoundInput` (Engine
  0.11, gap G18): a button held into the trigger (held, not newly pressed, on the round's first
  tick) is ignored until released, and the def's `inputMap` applies. On the tick it reports a
  result the world emits `mini-game-end` (`trigger`, `game`, `result`), empties the trigger on a
  `pass`, applies the outcomes, and the level moves again from the next tick.
- A def with `hostStatus` (gap G19) is handed the level's HUD values it names, from `coins`, `hp`,
  `maxHp`, `lives` and `level` (as `presentStatus` gives them), in `ctx.hostStatus`; a def without
  it gets no `hostStatus`, as before.
- The snapshot holds `triggers` (`col`, `row`, `game`, `armed`, `attempts`) and `miniGame`
  (`trigger`, `game` and `state`, the round's own `snapshot()`, or null), so state hashes cover
  the round.
- **The round's last tick (Engine 0.10, gap G20, items 81 and 158).** On the tick a round ends,
  `miniGame` is already null, so the world keeps the ended round (`endedRound`, an `EndedRound`)
  for that tick and the snapshot adds `endedRound`: `trigger`, `game`, `result`, `state` (the
  round's final `snapshot()`, with its last step's events when the mini game keeps them, as a
  room challenge's `state.events`) and `report` (its `report()`, when it has one). The key is left
  out on every other tick (the next `update` drops it; a `LevelSequence` drops it between levels),
  so snapshots without a round's end hash as before. A run file checks a round's last events
  there: `games/samples/platformer/runs/level-4.run.json` asserts the last knight's `kill` at the
  tick the round passes.
- **Browser glue (games, not the kit):** a game's page passes its `LevelSequence` to the
  shell's `new HostScene({ stack, game, picture })`, which, after each step, pushes
  `miniGameScene` (`engine/core/minigame-scene.ts`) over itself when `game.miniGame()` is set,
  with the sequence's `step` so the world still steps the round and applies its outcome, and
  pops it in `done`. A `SceneStack` updates only its top, so the level stays paused
  exactly as headless. The kit never imports the scene helper (it is on `FORBIDDEN_CORE`).

Rule id (`MINI_GAME_RULES`): `mini-games` (off: a trigger is an empty tile). `minigame.test.ts`
plays a test-only mini game (passes after N ticks of holding attack, fails on left, quits on
select): a pass (coins, a gate opened, the level goes on to the goal), a fail (`respawn` onto the
trigger, which waits to be left), a quit with no outcome and a second attempt, equal snapshots on
two runs, the rule switched off, and the `triggers` schema codes. `games/platformer-lab`'s
run files guard it (`runs/mini-game.run.json`) with every other rule, so
`pnpm cli mutants games/platformer-lab` passes.

## Level sequences (`sequence.ts`)

The level-after-level flow every platformer game needs, as a gameplay flow rule (pure, no
drawing): `new LevelSequence(stages, opts)` implements the headless contract over an ordered list
of `LevelStage`s (`{ level, profile }`; `levelStages(levels, profiles)` pairs levels with the
profiles they name and throws on a missing one). The order is the game's; most games want
`contentStages(content, { first?, campaign?, who? })` (Engine 0.7 T9 and 0.10 T10, gap G2): the
bundle's `level`, `profile` and `campaign` files, the levels in play order (`levelsInPlayOrder`),
each with its profile.

- **With a campaign file** (the engine's `campaign` kind, `engine/core/campaign.ts`; Engine 0.10):
  the campaign's `level` entries in its order, from its `start` (the first entry when left out)
  and round to the ones before it. Levels it does not name are not played; its `mission` entries
  are skipped (a level sequence plays levels only). With one campaign file that one is used; with
  several, `campaign` names the one (it throws without). `validate` already fails a campaign naming
  a missing level; `contentStages` throws too (`<who>: campaign "main" names level "x", which is
not there`), and on a campaign with no level.
- **Without one**, the levels by id with numbers compared as numbers (`level-2` before
  `level-10`), so a game with no campaign plays as it did in 0.7.
- `first` puts that level ahead of the rest either way (with a campaign, the rest follow round
  from it). Both platformer games have a campaign file giving the order they played in before
  (`content/campaigns/main.campaign.json`), so their run files and golden hashes did not move.

- While a level's outcome is `playing`, `step(input)` steps its world and keeps that step's
  events (`events`; the world's own list is emptied every step).
- Once it is `cleared` or `failed`, each step only counts `pause` up (the input is ignored and
  there are no events); at `opts.pause` ticks (`LEVEL_PAUSE`, 60, when left out; a whole number
  > = 1) it starts the next level (cleared; after the last, the first again) or the same level
  > afresh (failed).
- Every level is a new `PlatformerWorld` with the options' `seed`, `disabledRules` and
  `miniGames`, so a run file's switched-off rules reach every level.
- **Start stage** (Engine 0.14, gap G9, decision 6): `opts.start` (0-based, default 0) is the
  stage played first: that level, fresh, as the sequence would start it after the level before
  it (so its tick 0 is the state a full run reaches it in), then on from it as from any level
  (after the last, the first). A stage the sequence lacks throws. A game passes a run file's
  `start: { "stage": n }` through: `startStage(opts.start)` reads `HeadlessOptions.start` (undefined
  without one; it throws on a campaign `entry` start), and the game's headless module exports
  `starts(content) => stageStarts(itsStages(content))` (the level ids in play order), which the
  tools check `start` against (`engine/tools/CLAUDE.md`, Start levels and entries).
- `world`, `stage`, `pause`, `events` and `stageCount` are public for browser glue (a scene draws
  `world` and watches for a new world to start a new event stream).
- `snapshot()` is a `SequenceSnapshot`: `snapshotWorld(world, events)` (every path under
  `snapshot.ts` above) plus `stage` (the level's place in the order, 0 for the first) and `pause`
  (ticks waited since the level ended, 0 while it is played). These paths are the same in every
  game that uses it, so run files check "between levels" the same way.

`minigame.test.ts` also covers `endedRound` (on the end tick only, with the report when the
round has one, and in a `LevelSequence` whose round clears the level: that tick, not the pause,
and `miniGame()` while the round runs). `sequence.test.ts` covers the play order (by id, `first`, a campaign's order and `start`, its
missions skipped, a missing level, the bundle's one campaign or the one named), cleared -> next, failed -> the same level afresh, wrap-around, the pause
ignoring input, the pause from the options, the seed, rules and mini games given to every world,
and equal snapshots on two runs.

## Presentation frames (`present.ts`)

`presentWorld(world, events?, opts?)` describes the world as a `PresentFrame`
(`@engine/core/present`) without drawing; a backend draws it through a skin. Pass the step's
events (`world.events.splice(0)` after `update`). It only reads the world: no RNG draws, nothing
`snapshotWorld` reads is changed, so state hashes are the same with or without it
(`present.test.ts` checks it per tick on the fixture playthrough). Options: `size` (the picture,
`DEFAULT_SCREEN` when left out), `state` (a `PlatformerPresentState`, one per stream of frames:
the `MapTracker`, animation clocks, the last frame's boxes and short effects; without it every
runner or actor `anim.t` is 0, there are no effects, and the map is sent in full each time) and
`miniGameFrames` (true by default; under Mini game). Positions are world pixels (the level's
top-left tile at 0,0); boxes are whole pixels (the body's sub-pixel box floored).
`platformerFrames(size?)` (Engine 0.7) wraps it as a `FrameSource` for the engine's `FrameStream`:
one `PlatformerPresentState` per world, so a new level starts a new stream.

- **Map** (`presentMap`): the terrain only, as rows of `PRESENT_TILES` characters: `.` open air,
  `#` solid, `B` brick, `?` bump block, `u` used bump block, `=` one-way platform, `^` hazard.
  Coins, goals, triggers and the start are `.` (coins, goals and triggers are entities). `id` is
  the level's id, `tileSize` 16, tags `scroll:<right|free|none>`, `version` a 32-bit hash of the
  rows, so it changes when a bump block is used, a brick breaks or a gate opens (`open:` outcome),
  never when a coin is taken. With `state` the map is sent in full on the first frame and after a
  change, else as `{ id, version }`.
- **Entities**, in draw order, with `layer` from `PF_DEPTH`:

  | id                    | kind                                         | layer | `anim.state` / `t`                                                                          | tags                                    |
  | --------------------- | -------------------------------------------- | ----- | ------------------------------------------------------------------------------------------- | --------------------------------------- |
  | `coin@<col>,<row>`    | `coin`                                       | 0     | `idle`, `t` = world frame                                                                   |                                         |
  | `goal@<col>,<row>`    | `goal`                                       | 0     | `idle`, `t` = world frame                                                                   |                                         |
  | `trigger@<col>,<row>` | `trigger`                                    | 0     | `idle`, `t` = world frame                                                                   | `armed`, `running`, `look:<id>`         |
  | `bump-block@<c>,<r>`  | `bump-block`                                 | 5     | `bump`, `t` 0..7; the box is raised by `BUMP_RISE[t]` px                                    | the cell now: `used`, `bump` or `brick` |
  | `coin-pop@<c>,<r>`    | `coin`                                       | 5     | `pop`, `t` 0..29 (`COIN_POP_TICKS`), one tile over the block                                | `popped`                                |
  | `actor#<n>`           | the actor type name (`walker`, `shell`, ...) | 10    | `idle` (asleep or still), `walk`, `run` (faster than its type's `speed`: kicked), `fall`    | `asleep`, `kicked`                      |
  | `actor#<n>` (remains) | its last type                                | 10    | `stomped` (stomped, no `stompInto`) or `dead` (hit by a shell), `t` 0..29 (`REMAINS_TICKS`) |                                         |
  | `runner/dead`         | `runner`                                     | 20    | `dead`, `t` 0..59 (`RUNNER_DEAD_TICKS`), where it died                                      |                                         |
  | `runner`              | `runner`                                     | 20    | see below                                                                                   | `invuln`, `hp:<n>`                      |

  A trigger whose level entry gives a `look` (Engine 0.11, gap G13) is tagged `look:<id>`, so a
  skin's `byTag` (`engine/core/present/CLAUDE.md`) draws it its own way (a door, a pipe, a sign);
  one without a `look` gets no such tag. A bump-block's tag is the cell after the bump, so a skin
  can draw a bumped brick as a brick and a used block as used (`byTag` on `bump-block`).

  Effects (bounces, popped coins, remains, `runner/dead`) need `state`. The bump-block entity is
  drawn over its own tile (a skin should draw it with the block's look, raised). `actor#<n>` keeps
  its number when a stomp turns it into another type (a `shell-walker` into a `shell`), so a skin
  sees the kind change on the same id. Actors not yet woken are listed with `asleep`.

- **Runner** (`runnerState`): `dead` (the level is `failed`), `hurt` (the first `HURT_TICKS`, 12,
  of invulnerability), in the air `jump` (rising) or `fall`, on the ground `skid`, `idle` (no
  speed), `run` (over the profile's `maxWalk`) or `walk`. `t` is ticks in the state (with `state`).
  Facing `left`/`right`. A death with lives left respawns at once (the world's rule), so the
  remains `runner/dead` show where it died.
- **Events**: every `PlatformerEvent` field copied. `jump`, `land`, `hurt`, `died`, `respawn`,
  `cleared` sit at the runner's centre with `entity: 'runner'` (`died` where the last frame showed
  it); `spawn`, `stomp`, `kick`, `defeat` at the actor's centre (the last frame's box when it is
  gone) with `entity: 'actor#<n>'`; `bump`, `block`, `break`, `coin` at the tile's centre;
  `mini-game`, `mini-game-end` at the trigger's centre.
- **Status** (`presentStatus`): `coins`, `hp`, `maxHp`, `lives`, `outcome` (`playing`, `cleared`,
  `failed`), `level` and `miniGame` (the running mini game's id, '' when none).
- **Camera** (`cameraHint`): `follow: 'runner'`; `x`/`y` the centre of the world's own view
  (`scrollX`, `viewWidth`) as the fallback; `bounds` carries the scroll lock: scrolling `right`
  with `scroll-lock` on, `{ x: scrollX px, y: 0, w: level width - that, h: level height }` (the
  view never goes back left); `none` the level's first `viewWidth` px; `free` none (the map).
- **Mini game**: while a round runs and its `MiniGame` has `present()`, the frame is that one
  (copied), with the world's `frame`, the given `size`, `status.miniGame` set, the level's events
  of the tick it started put first, and its full map passed through the same `MapTracker` (so the
  level map is sent in full again after the round). With no `present()` (or
  `miniGameFrames: false`) the frame is the paused level with `status.miniGame` set and the
  trigger tagged `running`. A mini game's `present()` must only read its state.

## Content kinds

- `level` (`levels/<id>.json` + `levels/<id>.map.txt`): `id`, `profile` (a `profile` id), `scroll`
  (`right` default, `free`, `none`), `size` (optional `[cols, rows]`; the size comes from the grid
  and must match), `spawns` (`{ "<char>": { actor, facing } }`), `blocks` (what each `?` holds in
  reading order: `coin`, `coins`, `powerup`, `life` or `actor:<type>`; all coins when left out),
  `triggers` (one per `!` in reading order: `game`, `params`, `pass`, `fail`, `quit`, `look`;
  under Mini games) and `map`. Schema codes: `bad_spawn_key` (more than one character, a space or a legend
  character), `size_mismatch`, `wrong_block_count`, `wrong_trigger_count`, `bad_outcome` (an
  `open:<col>:<row>` outside the map), plus the grid's `ragged_row`, `unknown_char`,
  `empty_grid` at the `.map.txt` line.
- `checkAll` (`checkLevel`), once every file passes its schema: `no_start`, `two_starts` (at each
  extra `@`, row/col), `no_goal`, `missing_profile` (at `profile`) and `unknown_actor` (at each map
  cell using a spawn whose actor the profile lacks, with row/col; at `spawns.<char>.actor` when no
  cell uses it; at `blocks.<n>` for a block's `actor:<type>`).
- `profile` (`<id>.profile.json`): `player` (`box`, `minWalk`, `walkAccel`, `runAccel`,
  `friction`, `skid`, `skidTurn`, `maxWalk`, `maxRun`, `runHold` ticks, `jumps` tiers of
  `{ below?, speed, holdGravity, gravity }` with no `below` on the last, `jumpBuffer?` ticks
  (0 when left out), `maxFall`, `fallReset`,
  `stompBounce`, `hp` (1 when left out), `maxHp?` (`hp` when left out), `invulnTicks` (0),
  `breakBricksAt?` (left out: bricks never break), `lives` (1)), `actorGravity`, `actorMaxFall`
  and `actors` by name (`box?`, `speed`, `turnAt` `walls`/`ledges`, `stompable`, `stompInto?`,
  `kickable`, `kickSpeed?`, `harms`, `kickGrace?` ticks, 15 when left out). Codes:
  `bad_jump_tiers`, `bad_speed_caps`, `bad_hp` (`maxHp` under `hp`), `unknown_actor` (a
  `stompInto` that is not an actor type) and `missing_field` (a kickable actor with no
  `kickSpeed`).

## Testing

`pnpm test kits/platformer`: `level.test.ts` and `profile.test.ts` check good and broken inputs
(file, path, code, row and col); `kit.test.ts` loads the fixtures as a game would (with
`loadContent` and the kit's hook) and checks the cross-file problems. `world.test.ts` holds the
movement tests as a list of cases, plays each with every rule on, then with each movement rule off
in turn and fails if a rule leaves every case passing; `objects.test.ts` does the same for the
object rules (coins, blocks, bricks, hazards, pits, goal, scroll lock, waking, turning, stomp,
bounce, kick, shell hits, touch damage, invulnerability), `minigame.test.ts` the mini game hook
(under Mini games), and `objects.test.ts` plays the fixture level from start to
goal with a scripted input (`cleared`, both coins, the same snapshot hashes on two runs); `golden.test.ts` checks the movement against
SMBC (above); `present.test.ts` the presentation frames (under Presentation frames); `sequence.test.ts` the level sequences (under Level sequences); `world.test.ts` also checks that two runs of the same input
and seed give equal `canonicalJson` snapshots tick by tick, and that snapshots hold whole numbers. After changing a schema or a
description, run `pnpm docs:gen` (the schema reference lists both kinds; their examples are
`docs/reference/examples/level.json`, `level.map.txt` and `profile.json`).
