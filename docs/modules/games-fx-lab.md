# games/fx-lab

Folder: `games/fx-lab`. Detailed rules: [`games/fx-lab/CLAUDE.md`](../../games/fx-lab/CLAUDE.md).

## Purpose

The presentation lab of Engine 0.16 part A (from T2): a small game on the platformer kit that
shows every presentation feature as it lands. Three short original levels with stomps, coins, a
door and (in `fx-3`) torches, Pip (an original courier) with a full animation set (idle with a landing settle and a
breathing loop, walk, run, skid, jump, fall, hurt, dead) using per-frame timing, one-shots with
`then` and frame events (footsteps), a Canvas2D skin and a low-poly 3D skin whose `poses` swap
meshes by frame, from T3 six particle presets (land dust, run dust, stomp sparks, torch smoke,
a coin pickup burst, a magic aura on the door) with additive blending and glow, from T4 camera
effects (a shake and a 4-frame hit-pause on stomps, a red flash on hurt, a zoom punch on the door,
look-ahead) and a four-layer parallax sky (a gradient, clouds, mountains and hills from
`content/sprites/fx-sky.txt`) in 2D and 3D, original sfx, run
files with golden hashes and a browser page. Not a sample: a
test game, content and glue only.

## Public API entry points

- `game.json`, `content/` (levels `fx-1`, `fx-2`, `fx-3`, the campaign, the `pip` profile, the `fx`
  palette and sprites, the HUD font, sfx, `skins/canvas2d.json` and `skins/three.json`).
- `content.ts`: `loadFxLab`, `mustLoadFxLab`, `fxStages`, `fxSkin`.
- `headless.ts`: `createGame` (the kit's `LevelSequence`), `starts`.
- `picture.ts`: `fxLook`, `fxFrames`, `fxPicture`, `fxCanvasPicture(r, look, onSound?)`;
  `picture3d.ts`: `fxLook3d`; `view.ts`: `createView` (for `pnpm cli screenshot`).
- `main.ts` and `index.html`: the page (2D, or 3D with `?backend=three`); the sounds it plays are
  kept in `window.wwFxLab.sounds` for tests.
- `runs/level-1.run.json`, `runs/level-2.run.json`, `runs/level-3.run.json` with golden hashes.

## Imports allowed

- Relative paths inside `games/fx-lab`, `@engine/*` (core and backends) and `@kits/platformer`.
- Never other games or kits. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/fx-lab` (`fx-lab.test.ts`: level order, both skins' animation sets, frame-event
sounds through both presenters, the particle presets, the camera effects and parallax in both
skins, hit-pause requests on stomps and the 3D zoom on the door); `pnpm -s cli validate games/fx-lab --json`;
`pnpm -s cli run games/fx-lab/runs/level-1.run.json --json` (and `level-2`, `level-3`); `pnpm test tests/runs`
(golden hashes, presentation invariance); `pnpm test tests/browser/fx-lab.test.ts` (the page
replays `level-1` in 2D and 3D with the golden hashes and plays the frame events' sounds; skipped
without Chromium). `pnpm dev` and open `/games/fx-lab/`.
