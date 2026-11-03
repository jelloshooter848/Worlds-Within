# games/samples/dungeon

Folder: `games/samples/dungeon`. Detailed rules and how it was built: [`games/samples/dungeon/CLAUDE.md`](../../games/samples/dungeon/CLAUDE.md).

## Purpose

The top-down kit's sample game, **The Old Crypt** (the old engine demo, moved into the samples in
Engine 0.15 T2 and finished in T12): a short, complete dungeon of five rooms (the courtyard start,
a guard room of monsters, a store room with the bombs, a bat hall with the key, and the crypt with
the relic and the exit), with two end states (escaped through the exit, or fallen), in data files
checked by schemas: rooms, original NES-style pixel art as text (`hero` and `dungeon` sheets), two
MML songs, thirteen sound effects and a Canvas2D skin. A thin scene runs the kit's world, hands the
kit's presentation frames to the Canvas2D backend's `SkinnedCanvasPresenter`, plays the skin's
sounds, shows the end and starts a new run on Z or X. Its `CLAUDE.md` is a worked example of
building a top-down game on the engine.

## Public API entry points

- `game.json`: the game manifest (id `dungeon`, kit `topdown`, content globs by kind, start seed,
  headless and view entries).
- `content/`: `rooms/*.json` + `*.map.txt` (five rooms), `songs/` (`crypt`, `daylight`), `sfx/`,
  `palettes/` (`hero`, `dungeon`), `sprites/` (`hero.txt`, `dungeon.txt`), `skins/canvas2d.json`
  (every kind, tile, event and HUD value the kit presents, a `background`, no per-kind fallback).
- `content.ts`: `loadDungeon(files)` (the kit hook's kinds), `dungeonRooms`, `dungeonSkin`
  (the engine's `mustSkinSet`), `mustLoad`, `DUNGEON_MUSIC`, `ESCAPE_MUSIC`; songs and sfx are the
  engine's `contentSongs` and `contentSfx`.
- `picture.ts`: `dungeonLook(content)`, `DungeonPicture` (`draw(world, events)`), `dungeonEnd(world)`
  (`escaped`, `fallen` or null) and `drawStatusLines`.
- `headless.ts`: `createWorld(content, seed?)` and `createGame(content, seed)` (the engine's
  `HeadlessGame` contract), the headless entry named in `game.json`.
- `view.ts`: `createView(content, seed, opts?)` (the engine's `ViewGame` contract), for
  `pnpm cli screenshot games/samples/dungeon/runs/escape.run.json --tick 950`.
- `scene.ts`: `DungeonScene` (with `headless()` for the page's step hook) and `END_HOLD`;
  `main.ts` boots it with the shell's `bootBrowserGame` (audio, volume control, `?debug=step`).
- `runs/`: `walk-east` (into the guard room; unchanged since the demo), `escape` (the path to the
  exit) and `lost-in-the-guard-room` (the fall), each with golden hashes in `<name>.hashes.json`,
  checked by `tests/runs/run-files.test.ts` and `tests/runs/backend-parity.test.ts`; together
  they guard every top-down kit rule (`tests/runs/dungeon-mutants.test.ts`).
- Any picture size: change only `screen` in `game.json`.

## Imports allowed

- Relative paths inside `games/samples/dungeon`, `@engine/*` (core and backends) and `@kits/*`.
- Never other games. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test` runs `dungeon.test.ts` (content, rooms, songs, sounds, every run file's ticks drawn
with no fallback box, the end states, the scene against the headless game), the run files and
`tests/runs/dungeon-mutants.test.ts`; `tests/browser/dungeon.test.ts` opens it from the built
games index and plays it (headless Chromium, skipped without one). `pnpm -s cli validate
games/samples/dungeon --json` checks every data file. `pnpm dev` and open
`/games/samples/dungeon/` to play it.
