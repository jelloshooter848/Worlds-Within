# games/platformer-test

Folder: `games/platformer-test`. Detailed rules: [`games/platformer-test/CLAUDE.md`](../../games/platformer-test/CLAUDE.md).

## Purpose

The stacking test's game (Engine 0.7): a small original platformer on `kits/platformer`, built
with the engine as it is to find what is missing; every gap goes into
[`docs/reports/stacking-test.md`](../reports/stacking-test.md). It holds only content, skins and
thin glue, and doubles as a worked example and an integration test. Today it plays one short
level headless; the other levels, the 2D and 3D pages and the door level's top-down mini game come
later in 0.7. At 0.15 it becomes `games/samples/platformer/`.

## Public API entry points

- `game.json`: the manifest (kit `platformer`, 256x240, seed 1, `headless.ts`).
- `content/`: `levels/level-1.json` + `level-1.map.txt`, `profiles/hopper.profile.json`.
- `content.ts`: `loadTest(files)`, `testStages(content)` (the levels in play order), `mustLoad`.
- `headless.ts`: `createGame(content, seed, opts?)` (the `HeadlessGame` contract): the kit's
  `LevelSequence` over the levels (`TestGame`), `LEVEL_PAUSE` ticks between them; the kit's
  `SequenceSnapshot` (the world's plus `stage` and `pause`).
- `files.ts`: `TEST_FILES` (the data files through Vite's `import.meta.glob`).
- `runs/level-1.run.json` with golden `level-1.hashes.json`, with `guards`.

## Imports allowed

- Relative paths inside `games/platformer-test`, `@engine/*` and `@kits/platformer`.
- Never other games or kits it does not use. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/platformer-test` (`platformer-test.test.ts`: content, level order, determinism,
level restart). `pnpm -s cli validate games/platformer-test --json`,
`pnpm -s cli run games/platformer-test/runs/level-1.run.json --json`,
`pnpm -s cli mutants games/platformer-test/runs/level-1.run.json --json`, `pnpm test tests/runs`
(golden hashes).
