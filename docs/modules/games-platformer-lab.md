# games/platformer-lab

Folder: `games/platformer-lab`. Detailed rules: [`games/platformer-lab/CLAUDE.md`](../../games/platformer-lab/CLAUDE.md).

## Purpose

The platformer kit's test lab (Engine 0.5): the kit's fixture level (a byte-identical copy) played
from start to goal, then five small levels that each exercise one group of the kit's named rules,
played in turn by the headless game. Its run files guard every kit rule, so
`pnpm cli mutants games/platformer-lab` passes for the strict kit. It plays in the browser through
the Canvas2D backend and an original placeholder skin (or, with `?backend=three`, through the
Three.js backend and a low-poly `three` skin), with keyboard, gamepad and touch, and has
one original test mini game (`stop-bar`) pushed over the level as a scene when a trigger starts it.
It is a test game: content and glue, not engine.

## Public API entry points

- `game.json`: the manifest (kit `platformer`, 256x240, seed 1, headless and view entries).
- `content/`: `levels/*.json` + `*.map.txt` (the fixture `tiny` and `lab-1-moves` ...
  `lab-5-trigger`), `profiles/*.profile.json` (the fixture `runner`, and `lab-runner`),
  `palettes/`, `sprites/` (placeholder frames and the HUD font), `skins/canvas2d.json` (every
  kind, tile, event and HUD value the kit presents; camera follow, deadzone and lerp) and
  `skins/three.json` (Engine 0.6: a low-poly mesh per kind, a block per solid tile, the same
  camera, `camera3d` fov, tilt and layer depth).
- `content.ts`: `loadLab(files)`, `labStages(content)` (the levels in play order: the kit's
  `contentStages` with `tiny` first), `labSkin`, `labSkin3d`, `mustLoad` (the engine's).
- `headless.ts`: `createGame(content, seed, opts?)` (the `HeadlessGame` contract): the kit's
  `LevelSequence` over the levels with the lab's mini games (`LabGame`), `LEVEL_PAUSE` ticks
  between them; the kit's `SequenceSnapshot` (the world's plus `stage` and `pause`).
- `minigame.ts`: `STOP_BAR`, `LAB_MINI_GAMES` (the mini game hook's defs).
- `picture.ts`: `labLook(content)` (skin, sheets, size, sky), `labFrames(screen)` (the engine's
  `FrameStream` over the kit's `platformerFrames`: the one frozen frame stream), `labPicture(presenter,
screen)` (a `FramePicture`: those frames onto any presenter) and `labCanvasPicture(r, look)` (onto
  a `SkinnedCanvasPresenter`). `picture3d.ts`: `labLook3d` (the `three` skin, size and sky, as
  `threeDisplay` and `threeScenePresenter` take them). `view.ts`: `createView` (the `ViewGame`
  contract, for `screenshot`, with `render(r)` and the `frame()` hook; the engine's `frameView`).
- `scene.ts` (`labScene(content, stack, picture)`: the engine's `HostScene` over the lab's level
  sequence, which pushes the mini game's scene), `main.ts` (a dozen lines: the engine's
  `bootBrowserGame` with `canvasDisplay` and, only for `?backend=three`, a lazily imported
  `threeDisplay`), `index.html` (with the 2D/3D toggle and the launcher's `ww-alternate` 3D link),
  `files.ts`.
- `runs/*.run.json` with golden `*.hashes.json`: `start-to-goal`, `moves`, `objects`, `shells`,
  `walkers`, `mini-game`, each with `guards`.

## Imports allowed

- Relative paths inside `games/platformer-lab`, `@engine/*` (core and backends) and `@kits/platformer`.
- Never other games or kits. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/platformer-lab` (`lab.test.ts`: fixture copies, level order, the skin's coverage,
level changes, the mini game). `pnpm -s cli validate games/platformer-lab --json`,
`pnpm -s cli run games/platformer-lab/runs/start-to-goal.run.json --json`,
`pnpm -s cli mutants games/platformer-lab --json` (exit 0), `pnpm test tests/runs` (golden hashes
and backend parity through null, Canvas2D and the Three.js scene builder, plus the `three`
skin's coverage of every kind and tile shown). `pnpm dev` and open `/games/platformer-lab/` to play it, or
`/games/platformer-lab/?backend=three` to play it in 3D. `pnpm test tests/browser` runs the 3D
smoke test in headless Chromium (dev server and a sub-path build; skipped without Chromium).
