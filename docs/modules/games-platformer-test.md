# games/platformer-test

Folder: `games/platformer-test`. Detailed rules: [`games/platformer-test/CLAUDE.md`](../../games/platformer-test/CLAUDE.md).

## Purpose

The stacking test's game (Engine 0.7): a small original platformer on `kits/platformer`, built
with the engine as it is to find what is missing; every gap goes into
[`docs/reports/stacking-test.md`](../reports/stacking-test.md). It holds only content, skins and
thin glue, and doubles as a worked example and an integration test. Today it plays four short
levels headless, in order; the fourth is the door level, whose door pushes a one-room top-down
challenge (`kits/topdown`'s `roomChallenge`) over the level. The 2D and 3D pages come later in 0.7. At 0.15 it becomes `games/samples/platformer/`.

## Public API entry points

- `game.json`: the manifest (kit `platformer`, `uses: ["topdown"]`, 256x240, seed 1, `headless.ts`).
- `content/`: `levels/level-<n>.json` + `level-<n>.map.txt` (`level-1` to `level-4`, the door level),
  `profiles/hopper.profile.json`, `rooms/vault.json` + `vault.map.txt` (the door's top-down room).
- `content.ts`: `loadTest(files)`, `testStages(content)` (the levels in play order),
  `testRooms(content)`, `mustLoad`.
- `minigames.ts`: `testMiniGames(content)`, one `roomChallenge` per room file (id = room id).
- `headless.ts`: `createGame(content, seed, opts?)` (the `HeadlessGame` contract): the kit's
  `LevelSequence` over the levels (`TestGame`) with the mini games, `LEVEL_PAUSE` ticks between them; the kit's
  `SequenceSnapshot` (the world's plus `stage` and `pause`).
- `files.ts`: `TEST_FILES` (the data files through Vite's `import.meta.glob`).
- `runs/level-<n>.run.json` (one per level, each played from the first level on) with golden
  `level-<n>.hashes.json` and `guards`; together they guard every kit rule (`level-4` guards
  `mini-games`: a failed round, then a passed one).

## Imports allowed

- Relative paths inside `games/platformer-test`, `@engine/*`, `@kits/platformer` and `@kits/topdown`.
- Never other games or kits it does not use. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/platformer-test` (`platformer-test.test.ts`: content, level order, the four
levels cleared in order, the door's round failed then passed, determinism, level restart, the mini
games). `pnpm -s cli validate games/platformer-test --json`,
`pnpm -s cli run games/platformer-test/runs/level-3.run.json --json` (any run file),
`pnpm -s cli mutants games/platformer-test --json` (exit 0: every kit rule guarded), `pnpm test tests/runs` (golden hashes).
