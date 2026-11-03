# games/samples/tower-defense

The standalone tower-defense sample (Engine 0.12, the platform test): one map, two tower types and
three waves on `kits/towerdefense`, as data files plus a few lines of glue. Every rule of the round
(placing and paying, selling, waves by button or timer, walking, targeting, cooldowns, bounties,
leaks, won and lost) is the kit's; this folder holds only content and the run files that prove the
kit's rules. It does not use `engine/sim`. From T5 it also gets original art, sound, a skin, a
`view.ts` and a playable page; until then it is headless only (no `view` in `game.json`).

## How it was built

1. `game.json` names the kit (`towerdefense`), claims the three content kinds, the seed (12) and a
   256x240 picture; the map is 16 x 15 cells of 16 px, so it fills the picture.
2. The content was written as data: `content/maps/road.json` + `road.map.txt` (the grid),
   `content/towers/towers.json` and `content/waves/road.json`, and checked with
   `pnpm cli validate games/samples/tower-defense`.
3. `headless.ts` is `createGame` over the kit's `tdGame` and `tdRound` (in `content.ts`).
4. The run files' `input` was made by playing the kit's `TdBot` (the same button presses a person
   makes: one press, then a released frame) and writing down the held actions; the assertions were
   read from the round's snapshot at those ticks.
5. `pnpm cli mutants games/samples/tower-defense` showed which kit rules each run guards; the
   `target` run was added because no other run guarded `target-first`. With every rule guarded,
   the kit turned on strict mutants (`kits/towerdefense/kit.ts`).
6. Sync `hashes` were added last (below), then the golden files
   (`WW_UPDATE_GOLDEN=1 pnpm test tests/runs`).

## Files

- `game.json`: kit `towerdefense`, content `td-map` (`content/maps/*.json`), `td-towers`
  (`content/towers/*.json`), `td-waves` (`content/waves/*.json`), seed 12, 256x240,
  `headless.ts`.
- `content/maps/road.json`: the map's header: 40 gold and 5 lives to start, towers `arrow` and
  `cannon` (in the order `attack` cycles them), the wave list `road`.
- `content/maps/road.map.txt`: the grid (kit legend: `.` ground, `#` path, `B` build cell, `S`
  entry, `X` exit). The road winds from the entry at (0, 1) to the exit at (15, 13), 36 cells; the
  cursor starts on the first build cell, (1, 2).
- `content/towers/towers.json`: `arrow` (10 gold, range 2, 1 damage, cooldown 6, sells for 5) and
  `cannon` (25 gold, range 3, 4 damage, cooldown 20, sells for 15).
- `content/waves/road.json`: a timer of 400 ticks and three waves: six runners; a slow brute with
  four fast runners behind it (they overtake it near the entry, with jitter); eight runners and two
  brutes.
- `content.ts`: `loadTowerDefense(files)` (the checked bundle) and `sampleRound(content)` (the
  kit's `tdRound`).
- `files.ts`: `TOWER_DEFENSE_FILES`, the data files bundled by Vite for the page (T5).
- `headless.ts`: `createGame(content, seed, opts?)`, the kit's `TdGame` (snapshot
  `{ round, controls, kit }`; see `kits/towerdefense/CLAUDE.md`), rules switched off in `opts`
  passed to the kit.
- `tower-defense.test.ts`: the content (one map filling the picture, two tower types, three waves),
  the start state, every run file played twice to the same snapshots with its assertions passing,
  won and lost, each run failing without each rule in its `guards`, and the `won` input equal to
  the bot's plan.
- `runs/`: four run files, each with sync `hashes` and a golden `<name>.hashes.json`:
  - `build.run.json` (40 ticks): an arrow on the path is refused (`not_build_cell`), a cannon
    bought, a second refused (`too_poor`), the first sold for 15, an arrow bought. Guards
    `build-on-build-cells`, `build-costs-gold`, `sell-refunds`.
  - `won.run.json` (700 ticks): four arrows and a cannon placed with the cursor between waves
    started by the button; every wave held (5 lives, nothing leaked) and the round won at tick 673. Guards `build-costs-gold`, `spawn-spacing`, `enemies-walk`, `towers-fire`, `tower-range`,
    `tower-cooldown`, `kill-bounty`, `win-on-clear`.
  - `target.run.json` (260 ticks): one cannon at the entry; in wave 2 it kills the runner that
    overtook the brute (enemy 8 at tick 229), not the brute. Guards `target-first`.
  - `leaked.run.json` (1340 ticks): a thin defence of two arrows at the entry, every wave started
    by the timer (ticks 401, 801, 1201); wave 1 is held, waves 2 and 3 leak, and the round is lost
    at tick 1320. Guards `wave-timer`, `tower-range`, `tower-cooldown`, `leak-costs-life`,
    `lose-at-zero-lives`.

## Rules

- Content only: maps, towers and waves are data files under `content/`; game rules belong in the
  kit (`kits/towerdefense`), never here. `tests/architecture/no-content.test.ts` keeps content out
  of the engine and kits.
- Imports: relative paths, `@engine/core/*` and `@kits/towerdefense` (and its `kit.ts`). Never
  `engine/sim` (the sample needs none), other games or other kits. Tests may also use
  `@engine/backends/null`.
- Every kit rule must stay guarded by some run file: the kit is strict, so
  `pnpm -s cli mutants games/samples/tower-defense` exits 4 otherwise
  (`tests/runs/tower-defense-mutants.test.ts`). A new kit rule needs a run here that fails without
  it; list it in that run's `guards`.
- Sync hashes and mutants: a switched-off rule that changes the state before one of a run's
  checks fails would stop the run at a hash mismatch, which is not a failed check, and the rule
  would look unguarded. So each run's `hashes` are its `hashEvery` ticks minus the ones a mutant of
  a rule the run guards reaches with a changed state before a check fails. The golden
  `<name>.hashes.json` still holds every `hashEvery` tick.
- After a change meant to change the state, replay the bot plans (in the test and above), update
  the assertions, sync hashes and goldens, and rerun `mutants`.

## Testing

`pnpm test games/samples/tower-defense`; `pnpm -s cli validate games/samples/tower-defense`;
`pnpm -s cli run games/samples/tower-defense/runs/won.run.json` (and `build`, `target`, `leaked`);
`pnpm -s cli mutants games/samples/tower-defense` (exit 0, strict, 14 rules guarded);
`pnpm test tests/runs` (golden hashes and the mutants test).
