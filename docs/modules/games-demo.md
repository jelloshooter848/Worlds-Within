# games/demo

Folder: `games/demo`. Detailed rules: [`games/demo/CLAUDE.md`](../../games/demo/CLAUDE.md).

## Purpose

The proof-of-life demo game built on the top-down kit: three rooms, one MML song, three sound
effects, a hero sprite, a placeholder sheet and a Canvas2D skin, all in data files checked by
schemas, plus a thin scene that runs the kit's world, hands the kit's presentation frames to the
Canvas2D backend's `SkinnedCanvasPresenter`, plays the skin's event sounds and restarts the world
when the hero dies. It never calls a kit drawing function. It is content, not engine, and grows into `games/samples/dungeon`
at Engine 0.15.

## Public API entry points

- `game.json`: the game manifest (id, kit, content globs by kind, start seed, headless and view entries).
- `content/`: `rooms/*.json` + `*.map.txt`, `songs/*.json`, `sfx/*.json`, `palettes/*.json`,
  `sprites/*.txt`, `skins/canvas2d.json` (every kind, tile, event and HUD value the kit presents).
- `content.ts`: `demoKinds`, `loadDemo(files)`, `demoDungeon`, `demoSongs`, `demoSfx`, `demoSkin`,
  `mustLoad` (the engine's `contentArt`, `contentSfx` and `mustLoad` underneath; sheets from
  `contentSheets`).
- `picture.ts`: `demoLook(content)` (skin, sheets, picture size) and `DemoPicture`
  (`draw(world, events)`: `presentWorld` -> frozen frame -> `SkinnedCanvasPresenter`, plus the
  status lines; `onSound` for the skin's sounds).
- `headless.ts`: `createWorld(content, seed?)` and `createGame(content, seed)` (the engine's
  `HeadlessGame` contract), the headless entry named in `game.json`.
- `view.ts`: `createView(content, seed, opts?)` (the engine's `ViewGame` contract), the view entry
  named in `game.json`, for `pnpm cli screenshot games/demo/runs/walk-east.run.json --tick 60`.
- `runs/walk-east.run.json`: a run file (`pnpm -s cli run games/demo/runs/walk-east.run.json --json`)
  and `runs/walk-east.hashes.json`, its committed golden state hashes (checked by
  `tests/runs/run-files.test.ts`, and by `tests/runs/backend-parity.test.ts` with every tick
  presented through the null and the Canvas2D backends).
- Any picture size: change only `screen` in `game.json` (such as 320x240); the kit's camera hint
  keeps the HUD band on top and centres the room. `tests/build/two-resolutions.test.ts` validates,
  runs, screenshots and builds such a copy.
- `index.html` and `main.ts` (browser boot, data files from `virtual:game-files`); `scene.ts` (`DemoScene`).

## Imports allowed

- Relative paths inside `games/demo`, `@engine/*` (core and backends) and `@kits/*`.
- Never other games. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test` runs `demo.test.ts` (loads the data files, walks into the guard room drawn through the
skin, checks the skin covers what the kit presents and that walk-east's events call the skin's
sound callback, compiles the song, and checks errors name the file and field).
`pnpm -s cli validate games/demo --json` checks the skin with everything else. `pnpm dev` and
open `/games/demo/` to play it.
