# games/platformer-classic

Folder: `games/platformer-classic`. Detailed rules: [`games/platformer-classic/CLAUDE.md`](../../games/platformer-classic/CLAUDE.md).

## Purpose

**Platformer classic**, a test game (Engine 0.16 part B, T5): the platformer sample's old content,
moved here with its run files and golden hashes unchanged when `games/samples/platformer` became
the flagship, Hopper's Way. Five short levels on `kits/platformer`, two of them with a door that
pushes a one-room top-down challenge (`kits/topdown`'s `roomChallenge`) over the level: two
separate challenge rooms, `vault` and `cellar` (gap G17: `kitOptions.topdown.rooms`
`"separate"`). It plays in 2D (Canvas2D) and 3D (Three.js, `?backend=three`) at the old 256x240
screen, with original text assets: NES-style pixel art and palettes, low-poly meshes, an MML song
(`meadow`) and MML sfx, a skin per backend and frame source, and the same HUD in both backends
(gap G33). Like the labs it is a test game, not a sample: it keeps the repo's only game on two
kits with mini-game doors and its eight run files guarding the stacking test's rules, and its
`CLAUDE.md` stays the worked example of a game on two kits with two skins and two challenge rooms.
It began as the Engine 0.7 stacking test (every gap it found is in
[`docs/reports/stacking-test.md`](../reports/stacking-test.md)), moved into the samples in Engine
0.15 T2, was finished there in T13 and moved here in 0.16 part B T5. It holds only content, skins
and thin glue.

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
  generated pages, `docs/reference/mini-games/platformer-classic-vault.md` and `platformer-classic-cellar.md`
  (gap M11).
- `content.ts`: `loadHopper(files)` (the kinds of its two kits by the engine's `kitContentKinds`),
  `classicStages(content)` (the kit's `contentStages`: the levels in the campaign file's order),
  `classicRooms(content)`, `classicSkins(content, backend)` (`{ level, rounds }`: the engine's
  `skinSet`, the skin named after the backend and one per mini game from `<backend>-<id>`). Art,
  sounds and `mustLoad` are the engine's (`@engine/core/content/game-content`).
- `picture3d.ts`: `classicLook3d(content)` (the `three` skins, the sprite sheets as decoded pixels
  for their HUD (`contentPixelSheets`) and the size, for `threeDisplay` and `threeScenePresenter`;
  no Three.js import).
- `PLATFORMER_MUSIC` (`content.ts`): the song the page plays (`meadow`).
- `picture.ts`: `classicLook(content)` (skins, the engine's `contentSheets`, size, sky),
  `classicFrames(screen)`, `classicPicture(presenter, screen)` and `classicCanvasPicture(r, look)` (the
  backend's `skinSetCanvasPresenter`: the level skin, or the round's, per frame; each skin's
  `camera.clamp` frames its map).
- `view.ts`: `createView` (the engine's `frameView`), for `pnpm cli screenshot`.
- `main.ts` and `index.html`: the page (`bootBrowserGame` with the engine's `HostScene` over
  `createGame` itself (no `scene.ts` since Engine 0.10, gap G37), `canvasDisplay`, and `threeDisplay` from a lazily
  imported chunk for `?backend=three`; the song and sfx through the shell's `audio` option, gap
  G27, with the shell's volume control, M1).
- `minigames.ts`: `classicMiniGames(content)`, one `roomChallenge` per room file (id = room id,
  title = the room's `title`).
- `headless.ts`: `createGame(content, seed, opts?)` (the `HeadlessGame` contract): the kit's
  `LevelSequence` over the levels (`ClassicGame`) with the mini games, `LEVEL_PAUSE` ticks between them; the kit's
  `SequenceSnapshot` (the world's plus `stage` and `pause`).
- `main.ts` gets the data files from `virtual:game-files` (`build/game-files.ts`; no `files.ts`).
- `runs/level-<n>.run.json` (one per level, each played from the first level on) with golden
  `level-<n>.hashes.json` and `guards`; together they guard every kit rule (`level-4` guards
  `mini-games`: a failed round, then a passed one). From Engine 0.14 (gap G9) `level-2-start`,
  `level-3-start` and `level-4-start` play the same levels from their own tick 0 (`start: {
"stage": n }`, 0-based; `headless.ts` exports `starts(content)`), and `level-5-start` (Engine
  0.15 T11) plays `level-5`, entering the second challenge room and passing it.

## Imports allowed

- Relative paths inside `games/platformer-classic`, `@engine/*` (core and backends), `@kits/platformer`
  and `@kits/topdown`.
- Never other games or kits it does not use. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/platformer-classic` (`classic.test.ts`: content, level order, the levels
cleared in order, the door's round failed then passed, determinism, level restart, the mini
games, the 2D and 3D skins covering everything every run shows, text-only content, the song, no
fallback look and no fallback box drawn on any tick of any run, the page scene pushing and popping
the round). `pnpm -s cli validate games/platformer-classic --json`,
`pnpm -s cli run games/platformer-classic/runs/level-3.run.json --json` (any run file),
`pnpm -s cli mutants games/platformer-classic/runs/<run>.run.json --json` (exit 0 for each run file; the whole folder guards every rule the kit had before Engine 0.16 part B, not `coyote-time`, `checkpoints` or the `boss-*` rules, which its levels do not use), `pnpm test tests/runs` (golden hashes,
and backend parity through null, Canvas2D and the Three.js scene builder), `pnpm -s cli screenshot
games/platformer-classic/runs/level-4.run.json --tick 3050 --json` (inside the round;
`matchesHeadless` true; `--backend three --allow-software-gl` for 3D without a GPU), `pnpm test
tests/browser` (follows the games index's 2D and 3D links and plays `level-4.run.json` in
headless Chromium, with the HUD and the volume control in both). Play it:
`pnpm dev`, open `/games/platformer-classic/` or `/games/platformer-classic/?backend=three` (arrows, Z
jumps, X runs and stabs in the round).
