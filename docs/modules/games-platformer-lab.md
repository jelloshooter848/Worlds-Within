# games/platformer-lab

Folder: `games/platformer-lab`. Detailed rules: [`games/platformer-lab/CLAUDE.md`](../../games/platformer-lab/CLAUDE.md).

## Purpose

The platformer kit's test lab (Engine 0.5): the kit's fixture level (a byte-identical copy) played
from start to goal, then five small levels that each exercise one group of the kit's named rules,
played in turn by the headless game. Its run files guard every kit rule, so
`pnpm cli mutants games/platformer-lab` passes for the strict kit. It plays in the browser through
the Canvas2D backend and an original placeholder skin, with keyboard, gamepad and touch, and has
one original test mini game (`stop-bar`) pushed over the level as a scene when a trigger starts it.
It is a test game: content and glue, not engine.

## Public API entry points

- `game.json`: the manifest (kit `platformer`, 256x240, seed 1, headless and view entries).
- `content/`: `levels/*.json` + `*.map.txt` (the fixture `tiny` and `lab-1-moves` ...
  `lab-5-trigger`), `profiles/*.profile.json` (the fixture `runner`, and `lab-runner`),
  `palettes/`, `sprites/` (placeholder frames and the HUD font) and `skins/canvas2d.json` (every
  kind, tile, event and HUD value the kit presents; camera follow, deadzone and lerp).
- `content.ts`: `loadLab(files)`, `labStages(content)` (the levels in play order), `labSkin`,
  `labArt`, `mustLoad`.
- `headless.ts`: `LabGame` and `createGame(content, seed, opts?)` (the `HeadlessGame` contract):
  the levels in turn, `LEVEL_PAUSE` ticks between them; the kit's snapshot plus `stage` and `pause`.
- `minigame.ts`: `STOP_BAR`, `LAB_MINI_GAMES` (the mini game hook's defs).
- `picture.ts`: `labLook(content)`, `LabPicture` (`draw(world, events)`: the kit's frame through
  `SkinnedCanvasPresenter`). `view.ts`: `createView` (the `ViewGame` contract, for `screenshot`).
- `scene.ts` (`LabScene`, with the `miniGameScene` glue), `main.ts`, `index.html`, `files.ts`.
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
and backend parity). `pnpm dev` and open `/games/platformer-lab/` to play it.
