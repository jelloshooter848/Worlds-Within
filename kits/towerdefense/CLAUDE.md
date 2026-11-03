# kits/towerdefense

The tower-defense kit (Engine 0.12, the platform test; docs/BUILD-LOG.md, Engine 0.12, decisions
1-2, items 197-198): placing defences on a map, paying for them with gold, and fighting waves. Like
`kits/topdown` and `kits/platformer` it holds its **own deterministic round rules** (whole cells,
whole sub-cell units and whole ticks; every random draw through the `Rng` it is given), and like
every kit it holds **no world rules**: over a world it will read only what a mission's params and
snapshot give it (`mission-defence.ts`, T6) and report what happened. It never imports `engine/sim` and never draws.
`index.ts` re-exports the public surface; games import it as `@kits/towerdefense`.

## Files

- `map.ts`: the `td-map` text format. `LEGEND` (`.` blocked ground, `#` path, `B` build cell, `S`
  the path entry, `X` the path exit), `CellKind`, `cellKinds(rows, extra)` (every cell's kind, the
  header's own characters first) and `tracePath(kinds)`: the one walk from the entry to the exit
  (neighbours north, east, south, west), or its problems with row and col. Path cells may touch
  only along the walk (a cell with two unwalked path neighbours is a branch).
- `schema.ts`: the content kinds (below), `CELL_SUB` (16 sub-cell units to a cell), the types
  (`TdMap`, `TowerType`, `TowerTable`, `EnemyGroup`, `TdWaves`) and `towerTable(files)` (every
  `td-towers` file's types by id).
- `rules.ts`: `TOWERDEFENSE_RULES` (below).
- `world.ts`: `TdWorld({ map, towers, waves }, { rng?, seed?, disabledRules? })`, one round (below);
  `TdCommand`, `TdEvent`, `TdRefusal`, `TdSnapshot`, `sellValue(type)`. It throws on content that
  does not fit (a bad map, a tower type the table lacks, a wave list the map does not name).
- `present.ts`: `presentWorld(world, opts)` (frozen) / `describeWorld` (not frozen), the round as a
  `PresentFrame`; `tdFrames(size, cursor?, opts?)`, the kit's `FrameSource`; `TdPresentState`,
  `presentMap`, `presentStatus`, `cameraHint`, `enemyPlace`, `facingToward`, `TD_DEPTH`,
  `TD_TILES`, `TD_TILE_SIZE`, `TD_EVENT_TYPES` (below).
- `controls.ts`: `TdControls(grid)` (the cursor and chosen tower, `input(frame)` and `tap(...)`
  giving `TdCommand`s), `gridOf(world)`, `cellAtScreen(x, y, frame, grid, tileSize?)`,
  `REPEAT_DELAY`, `REPEAT_EVERY` (below).
- `game.ts`: `tdGame({ map, towers, waves, seed, disabledRules? })` (`TdGame`, an `engine/core`
  `HeadlessGame`) and `tdRound(content, map?)`, the round from a game's loaded content (below).
- `bot.ts`: `TdBot(plan)`, a deterministic player for tests: `next(game)` gives the actions to
  hold this step (steps `place`, `sell`, `wave`, `wait`, `clear`; one press, then a released frame).
- `mission-defence.ts`: the `td-defence` mini game (`tdDefence`, `TD_DEFENCE`,
  `tdDefenceParamsSchema`, `TdDefenceRound`, `TdDefenceReport`) and the stateless
  `towerdefenseMissionAdapter` (below).
- `kit.ts`: `kit` (`defineKit`): name `towerdefense`, kinds `td-map`, `td-towers`, `td-waves`,
  rules `TOWERDEFENSE_RULES`, `paramsDocs` (the `td-defence` params, listed by `pnpm docs:gen` in
  `docs/reference/schemas.md`, "Mini game params"), `roundBots()` (Engine 0.14 T9, gap M19:
  `TdBot` over a `td-defence` round's game, plan `tdBotPlanSchema`, its steps, for `pnpm cli
record --bot`), **strict mutants** (decision 1; on since T4, when the sample's run
  files came to guard every rule: `pnpm cli mutants games/samples/tower-defense` fails on a rule no
  run file guards). `engine/tools` finds it through the generated
  `engine/tools/kit-list.ts` (`pnpm docs:gen` after changing it). `index.ts` does not re-export it.

## Content kinds (`schema.ts`)

- `td-map` (`maps/<id>.json` + `maps/<id>.map.txt`): `id`, `title?`, `legend` (the map's own
  characters, each one a cell kind: `{ "W": "build" }`; not a kit character), `start` (`{ gold,
lives }`, lives at least 1), `towers` (the tower type ids placeable here, at least one, none twice)
  and `waves` (a `td-waves` file name), with `map` in the grid. Schema codes at the `.map.txt`
  line, with row and col: `unknown_char`, `ragged_row`, `empty_grid`, `no_entry`, `two_entries`,
  `no_exit`, `two_exits`, `path_broken` (the walk stops before the exit), `path_branch`,
  `path_off_walk` (a path cell the walk never reaches); and `bad_legend_char`, `duplicate_tower`.
  `checkAll`: `unknown_tower` at `towers.<i>`, `unknown_waves` at `waves`.
- `td-towers`: `{ towers: { <id>: { cost, range (cells), damage, cooldown (ticks, >= 1), sell? } } }`;
  `sell` left out is half the cost, rounded down. `checkAll`: `duplicate_tower` for a type in two files.
- `td-waves` (`waves/<id>.json`): `id`, `timer?` (ticks), `waves` (at least one, each `{ groups }`,
  each group `{ kind, count, spacing (ticks), hp, speed (sub-cell units a tick, 1..16), bounty,
jitter? }`).
- Examples in `docs/reference/examples/` (`td-map.json`, `td-map.map.txt`, `td-towers.json`,
  `td-waves.json`); every field has a `.describe(...)`. After a schema change: `pnpm docs:gen`.

## The round (`world.ts`)

Commands (`command(cmd)`, or `place(type, col, row)`, `sell(col, row)`, `startWave()`) are queued
and carried out, in order, at the start of the next `step()`, which returns that step's events.
`placeRefusal(type, col, row)` says why a placement would be refused now (for a cursor or ghost).
One step, in this fixed order:

1. commands: `place` on a build cell (`build-on-build-cells`) with no tower, paying its cost
   (`build-costs-gold`); `sell` removes the tower on a cell and gives back its sell value
   (`sell-refunds`); `start-wave` starts the next wave. Refusals are `refused` events with a code
   (`round_over`, `unknown_tower` (not on the map's list), `off_map`, `not_build_cell`, `occupied`,
   `too_poor`, `no_tower`, `no_more_waves`), never thrown;
2. the wave timer (`wave-timer`): with `timer`, the next wave starts once `timer` ticks have passed
   since the last wave started (or the round did, for the first);
3. spawning: enemies still to come enter at the entry (`progress` 0), each `spacing` ticks after
   the one before plus a draw of `0..jitter` from the RNG made when the wave starts, only for a
   group with jitter (`spawn-spacing`; off, all at once). A wave started while one is still coming
   queues behind it (its first enemy one `spacing` after the last);
4. enemies walk, in id order, `speed` sub-cell units (`enemies-walk`); one reaching the exit's
   progress (`(path length - 1) * CELL_SUB`) leaves, counts as leaked and costs a life
   (`leak-costs-life`; lives never go below 0);
5. towers, in id order (`towers-fire`): the cooldown counts down; a ready tower fires at its target
   (`targetOf`): an enemy whose cell (the path cell nearest its progress, `enemyCell`) is within
   `range` (squared cell distance; `tower-range`), the furthest along the path, ties to the lowest
   id (`target-first`; off, the lowest id in reach), for `damage`, then waits `cooldown` ticks
   (`tower-cooldown`; off, it may fire every tick). A tower placed this step can fire at once. An
   enemy at 0 hp is killed at once and pays its bounty (`kill-bounty`);
6. the end: 0 lives is `lost` (`lose-at-zero-lives`); else every wave started, none to come and
   no enemy left is `won` (`win-on-clear`);
7. `tick` counts up. Once won or lost a step only counts the tick and refuses every command.

Events (`TdEvent`): `placed`, `sold`, `refused`, `wave` (`wave` 1-based, `by` `button` or
`timer`), `spawn`, `fire` (the hp left), `kill` (the bounty paid), `leak` (the lives left), `won`,
`lost`. `snapshot()` (`TdSnapshot`) is plain, JSON-safe and whole-number: `tick`, `map`, `outcome`,
`gold`, `lives`, `rng`, `wave` (`started`, `total`, `sinceStart`, `pending`, `spawnIn`), `towers`,
`enemies` (with `progress` and their `col`/`row`), `stats` (`spent`, `refunded`, `earned`,
`killed`, `leaked`) and `events` (the last step's), so `canonicalJson` hashes it.

`waveLeft(wave)` is the enemies of a wave still to come or on the path (0 once it is cleared).

## Controls (`controls.ts`; decision 3, item 199)

A cursor over the grid, starting on the first build cell in reading order, with the chosen tower
type (the map's `towers`, in order). `input(frame)` reads one step's shared `Actions` and returns
the commands, which `TdGame` queues for the round's next step:

- `left`/`right`/`up`/`down`: one cell on the press, then, held, every `REPEAT_EVERY` (4) ticks after
  `REPEAT_DELAY` (10); clamped to the map;
- `attack` cycles the tower type; `jump` places it on the cursor's cell; `special` sells the tower
  there; `start` starts the next wave (the shell does not take `start` from a round).

`tap(x, y, frame, button?, tileSize?)`: picture point to cell through the frame's camera
(`cellAtScreen`, the presenters' framing: the hint's centre and zoom clamped to its `bounds`); a
primary tap moves the cursor there, or on the cursor's own cell places; a secondary one moves
there and sells; off the map nothing. Taps are page input, not in run files (lesson D1).

## Presentation (`present.ts`)

Pure reading: no RNG draws, nothing the snapshot holds changes, so hashes are the same presented or
not (tested). World px, cell (col, row) at `col * tileSize` (default 16). The map is `td:<map
id>`, version 1, rows of `TD_TILES` (`.`, `#`, `B`, `S`, `X`; a header's own characters show as
their kind), sent once per stream (`MapTracker`). Entities, by depth (`TD_DEPTH`):

- `tower-<id>`, kind `tower:<type>`: anim `fire` on a step it fired, else `idle`; facing (eight
  ways, `facingToward`) toward the enemy it fired at or would target; tags `type:<type>`, `ready` or
  `cooling`;
- `enemy-<id>`, kind `enemy:<kind>`: its box slid along the path by progress (`enemyPlace`, whole
  px), facing the way it walks (cardinal), anim `walk`; tags `hp:<hp>`, `wave:<n>`, `hit` (and
  `fx.tint` `hit`) on a step it was shot;
- `shot-<tower id>`, kind `shot:<type>`, over the target on the step a tower fired; tags
  `from:tower-<id>`, `target:enemy-<id>`;
- with a cursor: `ghost` (kind `ghost:<type>`, anim and tag `ok` or `blocked` with `why:<refusal>`,
  from `placeRefusal`; not once the round is over) and `cursor` (tag `cell:<kind>`).

Status (`presentStatus`): `gold`, `lives`, `wave` (`n/m`), `waveNumber`, `waveCount`, `enemies`,
`outcome`, `nextWave` (ticks to the timer's next wave, only with a timer and waves left) and, with
a cursor, `tower` and `towerCost`. Camera: the map's centre, `bounds` the map, `zoom` if given.

Events (`TD_EVENT_TYPES`, for skin sounds): `td-place` (`tower`, `cost`), `td-sell` (`refund`),
`td-refused` (`command`, `code`), `td-wave-start` (`wave`, `by`, `waves`), `td-spawn`, `td-shot`
(at the target; `from`, `fromX`/`fromY`, `tower`, `damage`, `hp`), `td-kill` (`kind`, `bounty`; a
gone enemy placed by the last frame's box), `td-leak` (at the exit; `lives`), `td-wave-clear`
(`wave`, `waves`; once per wave per stream, so only with a `TdPresentState`, and never for a wave
cleared before the stream started) and `td-end` (`result` `won` or `lost`: skin keys
`td-end:won`, `td-end:lost`). `entity` names the tower or enemy.

## The headless game (`game.ts`)

`TdGame`: `step(input)` queues the taps since the last step and the controls' commands, then
steps the round (`events` is that step's); no `order(json)` (decision 3: frame input only).
`snapshot()` is `{ round, controls, kit }`: the round's `TdSnapshot`, the controls' `{ col, row,
tower, held }` and `kit`, a summary for run-file paths: `outcome`, `gold`, `lives`, `wave`,
`waves`, `towers`, `enemies`, `killed`, `leaked`, `spent`, `earned`. `world` and `controls` are
public for a page's frame stream (`new FrameStream(tdFrames(screen, () => game.controls.view()))`)
and `tap`. A game's `createGame` is `tdGame({ ...tdRound(content), seed, disabledRules })`.

## The td-defence mission (`mission-defence.ts`)

The data-driven tower-defense mission (Engine 0.12 T6; docs/BUILD-LOG.md, Engine 0.12, decisions
5-6, items 201-202): a mission over an `engine/sim` world played as one tower-defense round, with
**no adapter code in the game**, in the pattern of the topdown kit's `mission-room`. A mission file
names it with `"play": "td-defence"` (`TD_DEFENCE`) and says everything in its `params`
(`tdDefenceParamsSchema`; the field table is in `docs/reference/schemas.md`, example
`docs/reference/examples/td-defence-params.json`):

- `map`: the id of one of the game's `td-map`s.
- `build?`: `{ select, slot? }`, the world entities (the walls) that stand on the map's build
  cells: those `select` picks, ascending id, on the cells of the `slot` character (a build cell's;
  every build cell when left out) in reading order. Spare slot cells become blocked ground; more
  walls than cells refuses the round. Left out, the map's own build cells, named `"<col>,<row>"`.
- `budget?`: `{ faction, item, cap? }`, the round's gold: the `Inventory` item of the entity with
  that faction's `Stockpile` (0 when it has none of the item), at most `cap`. Left out, the map's
  `start.gold`. `lives?`: the round's lives (the map's `start.lives` when left out). `timer?`:
  ticks until the wave starts by itself (left out, only `start` starts it).
- `wave`: `[{ kind, select?, hpPer?, speed, spacing?, bounty? }]`, the world units that come, as
  one wave: each entry's units in entry order, then ascending id, an entity going to the first
  entry that selects it; hp `ceil(Health.hp / hpPer)` (at least 1; `Health.hp` without `hpPer`, 1
  with no `Health`). Each unit is one group of one, `spacing` ticks after the one before.
- Selectors (`select`): `event?` (`EventMember`; for `wave` the mission's `event` when left out,
  for `build` any), `faction?` (`Owner`), `types?` (`Unit.type` or `Building.kind`), `keys?` (world
  names); only entities with `Position` and, with `Health`, hp above 0, and never one whose
  `Fate` (Engine 0.13, decision 3) is `captured` or `dead` (`engine/core`'s `isLost`, by the data);
  an `injured` raider joins the wave at its current, reduced hp.
- `outcomes`: ordered rules `[{ outcome, when?: { result?, leaksAtMost?, spentAtMost?, killed? }
}]`; the first that holds names the outcome, only the last may (and must) leave out `when`; a
  quit goes to `onQuit` without the rules. `killed` names wave units by world name or id (the
  adapter refuses a name not in the wave).
- **World names**: the scenario key the open mission's `refs` give an entity (the keys its effects
  name), else its id as a string (lesson D6).

The halves (the kit never imports `engine/sim`; it reads the snapshot with `snapshotEntities`):

- `towerdefenseMissionAdapter` (`MissionAdapter<JsonObject, MiniGameEnd>`, stateless; `MissionHost`
  takes it as `adapters: { 'td-defence': ... }`): `input` is `tdDefenceInput`, the round's params
  `TdDefenceInput { map, gold?, lives?, timer?, walls (or null), slot?, foes: [{ entity, name,
kind, hp, speed, spacing, bounty }] }`; `outcome` is `tdDefenceOutcome`, with `stats` `{ placed,
spent, leaked, livesLeft, killed, escaped, fallen, ticks }`. It throws (the host's
  `bad_mission_input` / `unmappable_report`) on malformed params, a budget faction with no
  stockpile, a wave that selects nothing, a `killed` name not in the wave, or no or a foreign
  report.
- `tdDefence({ maps, towers, title?, hostStatus?, inputMap?, size?, disabledRules? })`, the
  `MiniGameDef` (title `DEFENCE`, `hostStatus` `['mission']` by default): `paramsSchema` is
  `tdDefenceParamsSchema`; `checkUse` (`tdDefenceProblems`) checks the map is one of `maps` with a
  build cell, `build.slot` is a build cell on it and each rule names a declared outcome, so `pnpm cli
validate` reports them at their field (`bad_mini_game_use`). `create(ctx, seed)` takes the
  adapter's input, places the walls, gives the map the gold and lives and a one-wave list (with the
  map's `waves` id) of the world's units, and plays it as a `TdDefenceRound`.
- `TdDefenceRound` (a `MiniGame`): a `TdGame` (`game`, for a bot) stepped with frame input;
  **select quits** before the round sees it; `pass` when won, `fail` when lost. `snapshot()` is
  the game's plus `mission: { ticks, result }`. `report()` (`TdDefenceReport`): `result`, `ticks`,
  `lives`, `livesLeft`, `leaked`, `spent`, `refunded`, `goldLeft`, `placed` (towers placed by type,
  sold ones too), `towers` (standing: `cell`, `name`, `type`), `killed` and `escaped` (wave units'
  world names, ascending enemy id), `fallen`, `cells` (`{ cell, name, entity }`) and `foes`
  (`{ enemy, entity, name, kind }`, enemy ids from 1 in wave order). **`fallen`** is the report's
  reading, not a round rule (lesson D5): each leak brings down the build cell nearest the exit
  (squared distance, ties in reading order) not already fallen. `present()` is `describeWorld`
  with the cursor and the events since the last frame, each enemy tagged `foe:<name>`, and the host
  values as `host:<key>`; no stream state (every frame has the full map).

What the world gets back is the declared outcome's effects only: gold spent and losses are fixed
amounts per outcome (lessons D3, D4).

## Named rules (`rules.ts`)

`TOWERDEFENSE_RULES`: `build-on-build-cells`, `build-costs-gold`, `sell-refunds`, `wave-timer`,
`spawn-spacing`, `enemies-walk`, `towers-fire`, `target-first`, `tower-range`, `tower-cooldown`,
`kill-bounty`, `leak-costs-life`, `win-on-clear`, `lose-at-zero-lives`. Each is one `isOn` check
where it is decided; `world.test.ts` has one case per rule that changes when it is off (and fails
when a rule has no case). The kit is strict: the run files of `games/samples/tower-defense` guard
every rule (`pnpm cli mutants games/samples/tower-defense`, `tests/runs/tower-defense-mutants.test.ts`),
so a new rule needs a run there that fails without it.

## Rules

- Imports only `@engine/core/*` (not its drawing and output side, `FORBIDDEN_CORE`) and its own
  files; never `engine/sim`, backends, `engine/tools`, other kits or games
  (`tests/architecture/dependency-rule.test.ts`). Tests may also use `@engine/backends/null`.
  Core files it imports at run time must be on `PURE_CORE`.
- Pure (lint-enforced): no `Math.random`, `Date.now`, `performance.now` or DOM; randomness only
  through the `Rng` it is given (or seeds).
- Whole numbers only in the round's state; no floats.
- Never draws (`tests/architecture/no-drawing.test.ts`). No content outside `__fixtures__/` and
  tests (`tests/architecture/no-content.test.ts`): maps, towers and waves belong in `games/`.
- Every gameplay rule added gets an id in `rules.ts`, an `isOn` guard and a case in `world.test.ts`.
- An `engine/core` (or tools, backend) change the kit needs is logged as a lesson in
  `docs/reports/tower-defense.md` (ids `D1`, ...); `engine/sim` is not changed in 0.12.

## Testing

`pnpm test kits/towerdefense`: `world.test.ts` (placement and paying, refusals, selling, the wave
button, spacing and queueing, the timer, jitter through the given RNG, targeting order, range,
cooldown, kills and bounty, leaks and lives, won and lost, one case per rule switched off, the same
snapshots from the same seed twice and whole numbers only) and `kit.test.ts` (the hook, the
fixture game through `loadContent`, errors naming file and field, cross-file checks, every path
problem with its cell, and the fixture round played to its end twice), `present.test.ts` (frames
before and during a round, schema-valid and frozen; the ghost's reasons; towers, enemies, shots;
enemy placement and facings; the same hashes presented or not; a stream's map, its events on a won
and a lost round, refusals and sales, waves cleared once), `controls.test.ts` (cursor moves and
repeats, the buttons, a round from `ScriptedInput`, taps through the frame's camera at zoom 1 and 2), `game.test.ts` (the snapshot and its `kit` summary, the bot winning with the same hashes on
two runs, losing, disabled rules, selling, `tdRound`) and `mission-defence.test.ts` (the adapter
over a hand-written world snapshot: walls, capped budget, wave order and hp, names, refusals; the
round's map, cells, waves; held, breached and quit rounds with their reports and outcomes; the
rules in order; the frame's `foe:` tags and host status; the same snapshots twice; the validate
errors; fates: a captured raider and a dead wall skipped by the data, an injured raider at its hp).
`tests/kits/hero-mission.test.ts` (Engine 0.13) checks a wave over a real sim world skips a dead
and a captured named raider. `tests/kits/td-mission.test.ts` plays the mission over a real sim world (played cheap and
dear, breached, quit, delegated, golden hashes, and live through `MissionHost`). `__fixtures__/game.ts` loads the fixture
game for them. The fixtures are in
`__fixtures__/` (see its README). `tests/kits/towerdefense-validate.test.ts` runs `pnpm cli
validate` on `__fixtures__/game` (passes) and `__fixtures__/bad` (fails at `start.lives` and the
`.map.txt` row). By hand: `pnpm cli validate kits/towerdefense/__fixtures__/game`.
