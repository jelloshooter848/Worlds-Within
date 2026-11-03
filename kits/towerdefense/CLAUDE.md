# kits/towerdefense

The tower-defense kit (Engine 0.12, the platform test; docs/BUILD-LOG.md, Engine 0.12, decisions
1-2, items 197-198): placing defences on a map, paying for them with gold, and fighting waves. Like
`kits/topdown` and `kits/platformer` it holds its **own deterministic round rules** (whole cells,
whole sub-cell units and whole ticks; every random draw through the `Rng` it is given), and like
every kit it holds **no world rules**: over a world it will read only what a mission's params and
snapshot give it (T6) and report what happened. It never imports `engine/sim` and never draws.
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
- `kit.ts`: `kit` (`defineKit`): name `towerdefense`, kinds `td-map`, `td-towers`, `td-waves`,
  rules `TOWERDEFENSE_RULES`, **no strict mutants yet** (decision 1: T4 turns it on once the sample's
  run files guard every rule). `engine/tools` finds it through the generated
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

## Named rules (`rules.ts`)

`TOWERDEFENSE_RULES`: `build-on-build-cells`, `build-costs-gold`, `sell-refunds`, `wave-timer`,
`spawn-spacing`, `enemies-walk`, `towers-fire`, `target-first`, `tower-range`, `tower-cooldown`,
`kill-bounty`, `leak-costs-life`, `win-on-clear`, `lose-at-zero-lives`. Each is one `isOn` check
where it is decided; `world.test.ts` has one case per rule that changes when it is off (and fails
when a rule has no case).

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
problem with its cell, and the fixture round played to its end twice). The fixtures are in
`__fixtures__/` (see its README). `tests/kits/towerdefense-validate.test.ts` runs `pnpm cli
validate` on `__fixtures__/game` (passes) and `__fixtures__/bad` (fails at `start.lives` and the
`.map.txt` row). By hand: `pnpm cli validate kits/towerdefense/__fixtures__/game`.
