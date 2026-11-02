# games/demo

Folder: `games/demo`. Detailed rules: [`games/demo/CLAUDE.md`](../../games/demo/CLAUDE.md).

## Purpose

The proof-of-life demo game built on the top-down kit: three rooms, one MML song and one hero
sprite, all in data files checked by schemas, plus a thin scene that runs the kit's world and
restarts it when the hero dies. It is content, not engine, and grows into `games/samples/dungeon`
at Engine 0.15.

## Public API entry points

- `game.json`: the game manifest (id, kit, content globs by kind, start seed, headless and view entries).
- `content/`: `rooms/*.json` + `*.map.txt`, `songs/*.json`, `palettes/*.json`, `sprites/*.txt`.
- `content.ts`: `demoKinds`, `loadDemo(files)`, `demoDungeon`, `demoSongs`, `demoArt`,
  `DEMO_SHEETS`, `mustLoad`.
- `headless.ts`: `createWorld(content, seed?)` and `createGame(content, seed)` (the engine's
  `HeadlessGame` contract), the headless entry named in `game.json`.
- `view.ts`: `createView(content, seed, opts?)` (the engine's `ViewGame` contract), the view entry
  named in `game.json`, for `pnpm cli screenshot games/demo/runs/walk-east.run.json --tick 60`.
- `runs/walk-east.run.json`: a run file (`pnpm -s cli run games/demo/runs/walk-east.run.json --json`)
  and `runs/walk-east.hashes.json`, its committed golden state hashes (checked by
  `tests/runs/run-files.test.ts`).
- `index.html` and `main.ts` (browser boot, files from `files.ts`); `scene.ts` (`DemoScene`, `renderDemo`).

## Imports allowed

- Relative paths inside `games/demo`, `@engine/*` (core and backends) and `@kits/*`.
- Never other games. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test` runs `demo.test.ts` (loads the data files, walks into the guard room headless with the
hero sprite drawn, compiles the song, and checks errors name the file and field). `pnpm dev` and
open `/games/demo/` to play it.
