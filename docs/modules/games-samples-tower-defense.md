# games/samples/tower-defense

Folder: `games/samples/tower-defense`. Detailed rules: [`games/samples/tower-defense/CLAUDE.md`](../../games/samples/tower-defense/CLAUDE.md).

## Purpose

The standalone tower-defense sample (Engine 0.12, the platform test): one winding road on a 16 x 15
map, arrow and cannon towers and three waves, on `kits/towerdefense` with no `engine/sim`. It holds
only content (the map and its grid, the tower types, the waves) and thin glue; every rule of the
round is the kit's. Its run files place towers with the cursor, hold every wave or lose to a thin
defence, and guard every kit rule (the kit is strict). Art, sound, a skin and a playable page come
in T5.

## Public API entry points

- `game.json`: kit `towerdefense`, 256x240, seed 12, `headless.ts`.
- `content/`: `maps/road.json` + `maps/road.map.txt` (`td-map`), `towers/towers.json`
  (`td-towers`), `waves/road.json` (`td-waves`).
- `headless.ts`: `createGame(content, seed, opts?)`, the kit's `TdGame` (snapshot
  `{ round, controls, kit }`).
- `content.ts`: `loadTowerDefense(files)`, `sampleRound(content)`; `files.ts`:
  `TOWER_DEFENSE_FILES` for the page.
- `runs/build.run.json` (placing, refusals, selling), `won.run.json` (every wave held),
  `target.run.json` (the tower shoots the runner furthest along), `leaked.run.json` (waves by the
  timer, lives lost, the round lost), each with sync `hashes` and golden `<name>.hashes.json`.

## Imports allowed

- Relative paths inside the folder, `@engine/core/*` and `@kits/towerdefense`. Tests may also use
  `@engine/backends/null`.
- Never `engine/sim`, other games or other kits. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/samples/tower-defense`, `pnpm -s cli validate games/samples/tower-defense --json`,
`pnpm -s cli run games/samples/tower-defense/runs/won.run.json --json`,
`pnpm -s cli mutants games/samples/tower-defense --json` (exit 0, `strict: true`, every rule
guarded; `tests/runs/tower-defense-mutants.test.ts`), `pnpm test tests/runs` (golden hashes).
