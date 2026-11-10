# games/samples/dungeon

Folder: `games/samples/dungeon`. Detailed rules and how it was built: [`games/samples/dungeon/CLAUDE.md`](../../games/samples/dungeon/CLAUDE.md).

## Purpose

The top-down kit's sample game, **The Old Crypt** (the old engine demo, moved into the samples in
Engine 0.15 T2 and finished in T12): a short, complete dungeon of five rooms (the courtyard start,
a guard room of monsters, a store room with the bombs, a bat hall with the key, and the crypt with
the relic and the exit), with two end states (escaped through the exit, or fallen), in data files
checked by schemas: rooms, two MML songs, thirteen sound effects and a Canvas2D skin that draws it
at 16:9 (320x180, 6x is 1920x1080) on 0x72's CC0 DungeonTileset II (Engine 0.16 part C T3: the
pack's PNG plus two text sheets cut from it, walls and doors joined by neighbours, varied floors,
an animated knight, monsters with white hit flashes, particles, a framed HUD and restyled menus).
A thin scene runs the kit's world, hands the kit's presentation frames to the page display's
presenter (or its own `SkinnedCanvasPresenter`), shows the end banner and starts a new run on Z
or X. Its `CLAUDE.md` is a worked example of
building a top-down game on the engine.

## Public API entry points

- `game.json`: the game manifest (id `dungeon`, kit `topdown`, content globs by kind, start seed,
  the 320x180 screen, the menus, headless and view entries).
- `content/`: `rooms/*.json` + `*.map.txt` (five rooms), `songs/` (`crypt`, `daylight`), `sfx/`,
  `palettes/` and `sprites/` (`crypt-art`, `crypt-floor`: pieces cut from the CC0 pack),
  `fonts/`, `skins/canvas2d.json` (the pack's PNG as `images`; every kind, tile, event and HUD value
  the kit presents, a `background`, no per-kind fallback).
- `assets/`: 0x72's CC0 DungeonTileset II (Engine 0.16 part C, T2) in `dungeon-tileset-ii/`
  (`sheet.png` with every frame, `tile-list.txt` naming each frame's rectangle, three autotile
  atlases, 65 KB), credited in `assets/CREDITS.md`; checked by `assets.test.ts`. The skin draws
  from `sheet.png` (T3).
- `content.ts`: `loadDungeon(files)` (the kit hook's kinds), `dungeonRooms`, `dungeonSkin`
  (the engine's `mustSkinSet`), `mustLoad`, `DUNGEON_MUSIC`, `ESCAPE_MUSIC`; songs and sfx are the
  engine's `contentSongs` and `contentSfx`.
- `picture.ts`: `dungeonLook(content)`, `HUD_TOP`, `DungeonPicture` (`draw(world, events)`,
  `showHud`), `dungeonEnd(world)` (`escaped`, `fallen` or null), `endLines` and `endBanner`.
- `headless.ts`: `createWorld(content, seed?)` and `createGame(content, seed)` (the engine's
  `HeadlessGame` contract), the headless entry named in `game.json`.
- `view.ts`: `createView(content, seed, opts?)` (the engine's `ViewGame` contract), for
  `pnpm cli screenshot games/samples/dungeon/runs/escape.run.json --tick 950`.
- `scene.ts`: `DungeonScene` (with `headless()` for the page's step hook) and `END_HOLD`;
  `main.ts` decodes the PNG (`withContentImages`) and boots it with the shell's `bootBrowserGame`
  (audio, volume control, menus, `?debug=step`), the scene drawing through the display's presenter.
- `runs/`: `walk-east` (into the guard room; unchanged since the demo), `escape` (the path to the
  exit) and `lost-in-the-guard-room` (the fall), each with golden hashes in `<name>.hashes.json`,
  checked by `tests/runs/run-files.test.ts` and `tests/runs/backend-parity.test.ts`; together
  they guard every top-down kit rule (`tests/runs/dungeon-mutants.test.ts`).
- Any picture size: change only `screen` in `game.json`.

## Imports allowed

- Relative paths inside `games/samples/dungeon`, `@engine/*` (core and backends) and `@kits/*`.
- Never other games. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test` runs `assets.test.ts` (the CC0 pack's credits, sizes and tile list, the skin's frames inside the sheet), `dungeon.test.ts` (content, rooms, songs, sounds, every run file's ticks drawn
with no fallback box, the end states, the scene against the headless game, the 16:9 screen, the CC0 sheets, joins, hero states, hit flashes, the HUD hidden and the end banner), the run files and
`tests/runs/dungeon-mutants.test.ts`; `tests/browser/dungeon.test.ts` opens it from the built
games index and plays it (headless Chromium, skipped without one). `pnpm -s cli validate
games/samples/dungeon --json` checks every data file. `pnpm dev` and open
`/games/samples/dungeon/` to play it.
