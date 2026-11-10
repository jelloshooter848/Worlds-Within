# games/samples/platformer

Folder: `games/samples/platformer`. Detailed rules: [`games/samples/platformer/CLAUDE.md`](../../games/samples/platformer/CLAUDE.md).

## Purpose

The platformer kit's sample, **Hopper's Way**: five short levels on `kits/platformer`, two of them
with a door that pushes a one-room top-down challenge (`kits/topdown`'s `roomChallenge`) over the
level: two separate challenge rooms, `vault` and `cellar` (gap G17: `kitOptions.topdown.rooms`
`"separate"`). It plays in 2D (Canvas2D) and 3D (Three.js, `?backend=three`) from the games index,
with original text assets: NES-style pixel art and palettes, low-poly meshes, an MML song
(`meadow`) and MML sfx, a skin per backend and frame source, and the same HUD in both backends
(gap G33). Its `CLAUDE.md` is the worked example of a game on two kits with two skins and two
challenge rooms. It began as the Engine 0.7 stacking test (every gap it found is in
[`docs/reports/stacking-test.md`](../reports/stacking-test.md)), moved into the samples in Engine
0.15 T2 and was finished in T13. It holds only content, skins and thin glue.

## Public API entry points

- `game.json`: the manifest (kit `platformer`, `uses: ["topdown"]`, `kitOptions: { "topdown": {
"rooms": "separate" } }` (each room file its own challenge room, gap G17), 256x240, seed 1, `headless.ts`,
  `view.ts`; from Engine 0.16 T5 `transitions`: a fade between levels and an iris on the doors'
  rooms, played by the shell's `bootBrowserGame`).
- `content/`: `levels/level-<n>.json` + `level-<n>.map.txt` (`level-1` to `level-5`; `level-4`
  and `level-5` the door levels), `campaigns/main.campaign.json` (the play order, `level-1` to
  `level-5`, Engine 0.10), `profiles/hopper.profile.json`, `rooms/vault.json` + `vault.map.txt` and
  `rooms/cellar.json` + `cellar.map.txt` (the doors' top-down rooms),
  `sprites/hopper.txt`, `hopper-font.txt`, `vault.txt` (pixel art) with `palettes/hopper.json` and
  `vault.json`, `sfx/*.json` (MML), `skins/canvas2d.json` (the levels),
  `skins/canvas2d-vault.json` and `canvas2d-cellar.json` (the rounds), `skins/three.json`,
  `three-vault.json` and `three-cellar.json` (the same in 3D, with the same HUD and particles,
  gap G33), `songs/meadow.json` (the page's MML song). The rounds' params are listed on
  generated pages, `docs/reference/mini-games/platformer-vault.md` and `platformer-cellar.md`
  (gap M11).
- `assets/` (Engine 0.16 part B, T4): four CC0 packs as binary files, each credited in
  `assets/CREDITS.md` (source URL, author, licence, files kept; checked by `validate`), about
  1.8 MB in all: `pixel-adventure-1` (Pixel Frog: terrain, backgrounds, the Ninja Frog player,
  items, checkpoints, traps, effects; PNG), `kenney-pixel-platformer` (Kenney: 2D enemies and a
  second tile set; PNG), `kenney-platformer-kit` (Kenney, version 1.1: 2.5D terrain blocks,
  platforms, props, coins, flag; GLB) and `quaternius-platformer` (Quaternius: the 2.5D player
  stand-in and enemies, animated; GLB). No skin uses them yet (T6 and T10 will);
  `assets.test.ts` checks the credits and that every PNG and GLB reads (feedback items 364, 365).
- `content.ts`: `loadHopper(files)` (the kinds of its two kits by the engine's `kitContentKinds`),
  `hopperStages(content)` (the kit's `contentStages`: the levels in the campaign file's order),
  `hopperRooms(content)`, `hopperSkins(content, backend)` (`{ level, rounds }`: the engine's
  `skinSet`, the skin named after the backend and one per mini game from `<backend>-<id>`). Art,
  sounds and `mustLoad` are the engine's (`@engine/core/content/game-content`).
- `picture3d.ts`: `hopperLook3d(content)` (the `three` skins, the sprite sheets as decoded pixels
  for their HUD (`contentPixelSheets`) and the size, for `threeDisplay` and `threeScenePresenter`;
  no Three.js import).
- `PLATFORMER_MUSIC` (`content.ts`): the song the page plays (`meadow`).
- `picture.ts`: `hopperLook(content)` (skins, the engine's `contentSheets`, size, sky),
  `hopperFrames(screen)`, `hopperPicture(presenter, screen)` and `hopperCanvasPicture(r, look)` (the
  backend's `skinSetCanvasPresenter`: the level skin, or the round's, per frame; each skin's
  `camera.clamp` frames its map).
- `view.ts`: `createView` (the engine's `frameView`), for `pnpm cli screenshot`.
- `main.ts` and `index.html`: the page (`bootBrowserGame` with the engine's `HostScene` over
  `createGame` itself (no `scene.ts` since Engine 0.10, gap G37), `canvasDisplay`, and `threeDisplay` from a lazily
  imported chunk for `?backend=three`; the song and sfx through the shell's `audio` option, gap
  G27, with the shell's volume control, M1).
- `minigames.ts`: `hopperMiniGames(content)`, one `roomChallenge` per room file (id = room id,
  title = the room's `title`).
- `headless.ts`: `createGame(content, seed, opts?)` (the `HeadlessGame` contract): the kit's
  `LevelSequence` over the levels (`HopperGame`) with the mini games, `LEVEL_PAUSE` ticks between them; the kit's
  `SequenceSnapshot` (the world's plus `stage` and `pause`).
- `main.ts` gets the data files from `virtual:game-files` (`build/game-files.ts`; no `files.ts`).
- `runs/level-<n>.run.json` (one per level, each played from the first level on) with golden
  `level-<n>.hashes.json` and `guards`; together they guard every kit rule (`level-4` guards
  `mini-games`: a failed round, then a passed one). From Engine 0.14 (gap G9) `level-2-start`,
  `level-3-start` and `level-4-start` play the same levels from their own tick 0 (`start: {
"stage": n }`, 0-based; `headless.ts` exports `starts(content)`), and `level-5-start` (Engine
  0.15 T11) plays `level-5`, entering the second challenge room and passing it.

## Imports allowed

- Relative paths inside `games/samples/platformer`, `@engine/*` (core and backends), `@kits/platformer`
  and `@kits/topdown`.
- Never other games or kits it does not use. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/samples/platformer` (`platformer.test.ts`: content, level order, the levels
cleared in order, the door's round failed then passed, determinism, level restart, the mini
games, the 2D and 3D skins covering everything every run shows, text-only content, the song, no
fallback look and no fallback box drawn on any tick of any run, the page scene pushing and popping
the round; `assets.test.ts`: the CC0 packs credited, every PNG and GLB readable). `pnpm -s cli validate games/samples/platformer --json`,
`pnpm -s cli run games/samples/platformer/runs/level-3.run.json --json` (any run file),
`pnpm -s cli mutants games/samples/platformer --json` (exit 0: every kit rule guarded), `pnpm test tests/runs` (golden hashes,
and backend parity through null, Canvas2D and the Three.js scene builder), `pnpm -s cli screenshot
games/samples/platformer/runs/level-4.run.json --tick 3050 --json` (inside the round;
`matchesHeadless` true; `--backend three --allow-software-gl` for 3D without a GPU), `pnpm test
tests/browser` (follows the games index's 2D and 3D links and plays `level-4.run.json` in
headless Chromium, with the HUD and the volume control in both). Play it:
`pnpm dev`, open `/games/samples/platformer/` or `/games/samples/platformer/?backend=three` (arrows, Z
jumps, X runs and stabs in the round).
