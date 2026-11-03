# games/platformer-test

Folder: `games/platformer-test`. Detailed rules: [`games/platformer-test/CLAUDE.md`](../../games/platformer-test/CLAUDE.md).

## Purpose

The stacking test's game (Engine 0.7): a small original platformer on `kits/platformer`, built
with the engine as it is to find what is missing; every gap goes into
[`docs/reports/stacking-test.md`](../reports/stacking-test.md). It holds only content, skins and
thin glue, and doubles as a worked example and an integration test. Today it plays four short
levels headless, in order; the fourth is the door level, whose door pushes a one-room top-down
challenge (`kits/topdown`'s `roomChallenge`) over the level. Since 0.7 T7 it plays in the browser
in 2D (Canvas2D) from the root launcher, with text assets (pixel art, palettes, MML sounds) and a
skin per frame source (the levels' and the vault round's), and since 0.7 T8 in 3D (Three.js,
`?backend=three`, the launcher's `3D` link) with low-poly `three` skins written as text (the
vault room laid flat facing the camera). 0.7 T9 reviewed its glue against DESIGN.md's rule of
thumb and moved what another game would write too into the engine and kits (gaps G2, G4, G15,
G29, G34, G35). Since 0.10 T8 its headless entry also exports `miniGames(content)`, so `validate`
checks the door's params with the content (gap G16). At 0.15 it becomes `games/samples/platformer/`.

## Public API entry points

- `game.json`: the manifest (kit `platformer`, `uses: ["topdown"]`, 256x240, seed 1, `headless.ts`,
  `view.ts`).
- `content/`: `levels/level-<n>.json` + `level-<n>.map.txt` (`level-1` to `level-4`, the door level),
  `campaigns/main.campaign.json` (the play order, `level-1` to `level-4`, Engine 0.10),
  `profiles/hopper.profile.json`, `rooms/vault.json` + `vault.map.txt` (the door's top-down room),
  `sprites/hopper.txt`, `hopper-font.txt`, `vault.txt` (pixel art) with `palettes/hopper.json` and
  `vault.json`, `sfx/*.json` (MML), `skins/canvas2d.json` (the levels),
  `skins/canvas2d-vault.json` (the vault round), `skins/three.json` and `skins/three-vault.json`
  (the same in 3D).
- `content.ts`: `loadTest(files)` (the kinds of its two kits by the engine's `kitContentKinds`),
  `testStages(content)` (the kit's `contentStages`: the levels in the campaign file's order),
  `testRooms(content)`, `testSkins(content, backend)` (`{ level, rounds }`: the engine's
  `skinSet`, the skin named after the backend and one per mini game from `<backend>-<id>`). Art,
  sounds and `mustLoad` are the engine's (`@engine/core/content/game-content`).
- `picture3d.ts`: `testLook3d(content)` (the `three` skins, size and sky for `threeDisplay` and
  `threeScenePresenter`; no Three.js import).
- `picture.ts`: `testLook(content)` (skins, the engine's `contentSheets`, size, sky),
  `testFrames(screen)`, `testPicture(presenter, screen)` and `testCanvasPicture(r, look)` (the
  backend's `skinSetCanvasPresenter`: the level skin, or the round's, per frame; each skin's
  `camera.clamp` frames its map).
- `view.ts`: `createView` (the engine's `frameView`), for `pnpm cli screenshot`.
- `main.ts` and `index.html`: the page (`bootBrowserGame` with the engine's `HostScene` over
  `createGame` itself (no `scene.ts` since Engine 0.10, gap G37), `canvasDisplay`, and `threeDisplay` from a lazily
  imported chunk for `?backend=three`; sound through the shell's `audio` option, gap G27).
- `minigames.ts`: `testMiniGames(content)`, one `roomChallenge` per room file (id = room id,
  title = the room's `title`).
- `headless.ts`: `createGame(content, seed, opts?)` (the `HeadlessGame` contract): the kit's
  `LevelSequence` over the levels (`TestGame`) with the mini games, `LEVEL_PAUSE` ticks between them; the kit's
  `SequenceSnapshot` (the world's plus `stage` and `pause`).
- `main.ts` gets the data files from `virtual:game-files` (`build/game-files.ts`; no `files.ts`).
- `runs/level-<n>.run.json` (one per level, each played from the first level on) with golden
  `level-<n>.hashes.json` and `guards`; together they guard every kit rule (`level-4` guards
  `mini-games`: a failed round, then a passed one). From Engine 0.14 (gap G9) `level-2-start`,
  `level-3-start` and `level-4-start` play the same levels from their own tick 0 (`start: {
"stage": n }`, 0-based; `headless.ts` exports `starts(content)`).

## Imports allowed

- Relative paths inside `games/platformer-test`, `@engine/*` (core and backends), `@kits/platformer`
  and `@kits/topdown`.
- Never other games or kits it does not use. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/platformer-test` (`platformer-test.test.ts`: content, level order, the four
levels cleared in order, the door's round failed then passed, determinism, level restart, the mini
games, the 2D and 3D skins covering everything every run shows, text-only assets, the page scene
pushing and popping the round). `pnpm -s cli validate games/platformer-test --json`,
`pnpm -s cli run games/platformer-test/runs/level-3.run.json --json` (any run file),
`pnpm -s cli mutants games/platformer-test --json` (exit 0: every kit rule guarded), `pnpm test tests/runs` (golden hashes,
and backend parity through null, Canvas2D and the Three.js scene builder), `pnpm -s cli screenshot
games/platformer-test/runs/level-4.run.json --tick 3050 --json` (inside the round;
`matchesHeadless` true; `--backend three --allow-software-gl` for 3D without a GPU), `pnpm test
tests/browser` (the page plays `level-4.run.json` in headless Chromium, in 2D and in 3D). Play it:
`pnpm dev`, open `/games/platformer-test/` or `/games/platformer-test/?backend=three` (arrows, Z
jumps, X runs and stabs in the round).
