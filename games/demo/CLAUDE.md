# games/demo

The current demo: a proof-of-life game built on the top-down kit. It is content, not engine, and its
content lives in data files, not TypeScript. It grows into `games/samples/dungeon` at Engine 0.15.

## Files

- `game.json`: the game manifest (schema: `engine/core/content/manifest.ts`). It names the kit, the
  content files by kind (globs), the start seed, the headless entry (`headless.ts`) and the view entry (`view.ts`).
- `content/rooms/<id>.json` + `<id>.map.txt`: a room (schema: `kits/topdown/schema.ts`). The JSON
  holds `id` (must match the file name), `at`, `music`, `chests` and the other `RoomDef` fields;
  the `.map.txt` file is the 11x16 map grid in the kit's `LEGEND` (`kits/topdown/room.ts`).
- `content/songs/<id>.json`: an MML song (schema: `engine/core/audio/song-schema.ts`).
- `content/palettes/<id>.json`: a palette (schema: `engine/core/gfx/palette-schema.ts`).
- `content/sprites/<sheet>.txt`: text-grid pixel art (format: top of
  `engine/core/gfx/sprite-schema.ts`). The file name is the sheet id: `demo-hero.txt` is the hero
  sheet (`down-0`, `side-1`, `attack-up`..., and `poof` for the puff he leaves);
  `demo-placeholders.txt` (palette `demo-placeholders.json`) holds flat frames in exactly the
  colours and places the kit drew before Engine 0.4 when a game had no art: every tile, every
  other kind and three HUD icons. Real art replaces a frame by drawing it under the same name.
- `content/sfx/<id>.json`: an MML sound effect (schema: `engine/core/audio/song-schema.ts`):
  `door`, `spit`, `hurt`, played for the skin's events.
- `content/skins/canvas2d.json`: the skin the Canvas2D backend draws the demo with (format:
  `engine/core/present/skin.ts`, `engine/core/present/CLAUDE.md`). `kinds` maps every kind the
  top-down kit presents (`hero`, `bat`, `pickup:heart`, ...; the table in `kits/topdown/CLAUDE.md`)
  and its animation states to frames, with the kit's old flat colours as `fallbackColor`;
  `tiles` maps every `PRESENT_TILES` character; `events` maps `room`/`unlock` -> `door`,
  `spit` -> `spit`, `hurt` -> `hurt`, `kill` -> particles and `blast` -> a shake; `hud` shows
  `hp` (one half-heart pip per half heart), `keys` (one key each) and `item` (an icon when one is
  selected) along the bottom of the HUD band. Townsfolk (`person:*`) are not listed: they fall
  back to `sheets.fallbackColor`.
- TypeScript is glue only: `content.ts` (the content kinds, `loadDemo`, and `demoDungeon`,
  `demoSongs`, `demoSfx`, `demoSkin` over the loaded bundle; sheets are the engine's `contentSheets`), `files.ts` (the browser's file pairs through
  Vite's `import.meta.glob` with `?raw`), `headless.ts` (`createWorld(content, seed?)`, and `createGame(content, seed)`: the
  engine's headless contract, which `pnpm cli run` imports by the path in `game.json`),
  `picture.ts` (`demoLook(content)`: the skin, sheets and picture size; `DemoPicture`: each
  `draw(world, events)` calls the kit's `presentWorld`, freezes the frame, hands it to the
  backend's `SkinnedCanvasPresenter` (the skin's `camera.clamp: false` keeps the room under the HUD band) and
  writes the three status lines, `drawStatusLines`, from the frame's `status`), `view.ts`
  (`createView(content, seed, opts?)`: the headless game plus `DemoPicture`, for `pnpm cli screenshot`),
  `scene.ts` (`DemoScene`: the world, its events since the last draw, `DemoPicture` with
  `onSound` -> `AudioManager.sfx`) and `main.ts` (boots the Canvas2D backend, input, audio with
  songs and sfx, and the look).
- The demo never calls a kit drawing function (`renderWorld`, `drawTdHud`, an entity's `render`):
  `demo.test.ts` fails if its code names one.

## Adding or changing content

- Edit the data files; never put rooms, MML or pixel rows in `.ts` files
  (`tests/architecture/no-content.test.ts` fails on them).
- A new file must be claimed by a kind in `game.json` (otherwise it is an `unclaimed_file` error).
- Node code reads the folder with `readGameFiles` (`engine/core/node/game-files.ts`) and checks it
  with `loadDemo`; every error names the file (`games/demo/content/...`) and the field.
- After any content change run `pnpm -s cli validate games/demo --json`: exit 0 means every file
  passes; exit 3 lists each error with its file and field.

## Run files

- `runs/<name>.run.json`: a seeded, scripted headless run with tick assertions and invariants
  (schema: `engine/tools/run-file.ts`; format in `engine/tools/CLAUDE.md`). `runs/walk-east.run.json`
  walks the hero east into the guard room and checks his hearts never go below 0.
- `runs/<name>.hashes.json`: the run's committed golden state hashes. `tests/runs/run-files.test.ts`
  runs every run file twice and compares both to it, so CI checks them.
- Run one: `pnpm -s cli run games/demo/runs/walk-east.run.json --json` (exit 0 passed, 4 a failed
  check). See the state at a tick: `pnpm -s cli dump games/demo/runs/walk-east.run.json --tick 100 --json`.
- `tests/runs/backend-parity.test.ts` plays every run here twice, presenting every tick through
  the null backend's `NullPresenter` and through `DemoPicture` (the Canvas2D backend's
  `SkinnedCanvasPresenter`) onto a recording renderer: both must give the golden hashes.
- After a change meant to change the game's state, regenerate the golden files with
  `WW_UPDATE_GOLDEN=1 pnpm test tests/runs` and commit them with the change.

## Picture size

`screen` in `game.json` is the only value to change for another picture size: the canvas, the
integer scaling, the touch layout, the kit's frames and screenshots follow it. The kit's camera
hint (`cameraHint`, `kits/topdown/present.ts`) keeps the HUD band (64 px) at the top and centres
the room across the picture and in the height under the band; a shorter picture cuts the room's
bottom, a narrower one both sides. The skin's HUD and the status lines stay at the top-left.
`tests/build/two-resolutions.test.ts` copies this folder with `screen` set to 320x240 and checks
`validate`, `run` (the same hashes), `screenshot` (a 320x240 PNG, the same bytes twice) and a
Vite build of the copy.

## How to run

- `pnpm dev` opens the index of games; pick `games/demo`, or open `/games/demo/` directly.
- `pnpm build` builds the demo (content included) into `dist/games/demo/`.
- `pnpm test` runs `demo.test.ts`: it loads the data files from disk, walks the hero east into the
  guard room drawn through the skin onto a counting renderer (hero and placeholder sprites drawn),
  compiles the song, checks the skin lists every tile, every kind and HUD value walk-east shows
  and that every sound it names is an sfx, that the walk's `room` (tick 89) and `spit` (tick 240)
  events call the skin's sound callback with `door` and `spit`, and that a broken field gives an
  error naming the file and the field.

## Screenshot against Engine 0.3 (build log)

`pnpm -s cli screenshot games/demo/runs/walk-east.run.json --tick 120` was
`303b20d7559004e80f01d68e53a54efdb060985419c1825070cfa617ee2a0579` at the end of 0.3 and is now
`385b61d4a1ff684c27a8d497775c05949d935fd387e19be34a3fbbd632ba7cdd`. The two PNGs differ in 90
pixels, all inside x 8..30, y 53..57 of the black HUD band: the six red half-heart pips of the new
skin HUD entry for `hp` (black before, `#f83800` now). Nothing else differs: with the skin's `hud`
removed the screenshot is byte-identical to 0.3's (sha `303b20d7...`), and so are ticks 60, 200
and 240 against the 0.3 code. Judged visual-only: the state hashes are unchanged
(`matchesHeadless: true`, walk-east's golden hashes pass).

Differences a skin cannot express yet, none of them visible in walk-east (all visual-only):

- A hurt hero or monster no longer blinks (the old code skipped drawing every other 2 frames
  while invulnerable; a skin has no "hidden" frame). The hero's hurt and dying poses are his
  first walk frame for his facing (the old code kept his walk frame).
- Stun stars are drawn in one pose (the old code turned them a little each frame).
- Within one depth layer the backend draws by `y` (the old code by list order), so two
  overlapping monsters may swap which is in front.
- The exit's two-frame glow and dark-room palettes were placeholder colours anyway; the skin has
  one flat frame each.
- Sounds and effects are new: the old demo played none for events.

## Imports

- Allowed: relative paths inside `games/demo`, `@engine/*` (core and backends) and `@kits/*`.
- Never: other games. Nothing in `engine/` or `kits/` may import from here, and no alias points into
  `games/`.
- Game rules belong in data (rooms, songs) wherever possible, not code.
