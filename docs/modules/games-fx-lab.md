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
`content/sprites/fx-sky.txt`) in 2D and 3D, from T5 screen transitions in `game.json` (an iris
closing on Pip at the door and opening on him in the next level; fades for scenes and on demand),
from T6 a HUD through the UI kit (a nine-slice panel, a health bar, a rolling coin counter, a
lives counter, a minimap, and text in two original fonts, `content/fonts/fx-small.txt` and the
larger `fx-title.txt`), from T7 a pause menu and a dialog box as text (`content/ui/lab.json`: a
slider, a toggle, a disabled item, a dialog with Pip's portrait, typed pages and a choice), run by
the shell's `UiScene` with keyboard, gamepad, mouse and touch (2D), original sfx, run
files with golden hashes and a browser page. Not a sample: a
test game, content and glue only.

## Public API entry points

- `game.json`, `content/` (levels `fx-1`, `fx-2`, `fx-3`, the campaign, the `pip` profile, the `fx`
  palette and sprites, the fonts `fonts/fx-small.txt` and `fonts/fx-title.txt`, sfx, `skins/canvas2d.json` and `skins/three.json`,
  and from T7 the UI screen `ui/lab.json`).
- `content.ts`: `loadFxLab`, `mustLoadFxLab`, `fxStages`, `fxSkin`.
- `headless.ts`: `createGame` (the kit's `LevelSequence`), `starts`.
- `picture.ts`: `fxLook`, `fxFrames`, `fxPicture`, `fxCanvasPicture(r, look, onSound?)`;
  `picture3d.ts`: `fxLook3d`; `view.ts`: `createView` (for `pnpm cli screenshot`).
- `ui.ts` (T7): `fxUiFile`, `sheetFrameSize`, `fxUiScreen(content, { sheets, fonts, onSound?, open? })`.
- `main.ts` and `index.html`: the page (2D, or 3D with `?backend=three`); the sounds it plays are
  kept in `window.wwFxLab.sounds` for tests; in 2D Enter opens the pause menu, `?ui=menu` or
  `?ui=dialog` opens one at load, and `window.wwFxLab.ui` opens them and reads the screen.
- `content/songs/` (T8): `lab-calm` and `lab-danger`, the two layers of the 2D skin's layered
  song `lab` (`music`), danger mixed in while the kit's `nearestActor` status is under 72 px;
  footsteps and jumps vary in pitch and volume (footsteps rest 4 frames), stomps and hurts duck
  the music, and so does the dialog box.
- `assets/fx-lab-png/torch.png` and `assets/CREDITS.md` (T10): the lab's PNG sprite sheet, an
  original torch made by `tools/torch-sheet.ts` (`pnpm exec tsx games/fx-lab/tools/torch-sheet.ts`;
  own work, CC0), named in the 2D skin's `images` as `lab-torch` (a 4-cell grid with margin 1 and
  spacing 2, plus the named frame `torch-unlit`, anchored `bottom`) and drawn for the `torch` kind.
- `runs/level-1.run.json`, `runs/level-2.run.json`, `runs/level-3.run.json` with golden hashes.

## Imports allowed

- Relative paths inside `games/fx-lab`, `@engine/*` (core and backends) and `@kits/platformer`.
- Never other games or kits. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/fx-lab` (`fx-lab.test.ts`: the committed PNG equals its script's output (T10), level order, both skins' animation sets, frame-event
sounds through both presenters, the particle presets, the camera effects and parallax in both
skins, hit-pause requests on stomps and the 3D zoom on the door); `pnpm -s cli validate games/fx-lab --json`;
`pnpm -s cli run games/fx-lab/runs/level-1.run.json --json` (and `level-2`, `level-3`); `pnpm test tests/runs`
(golden hashes, presentation invariance); `pnpm test tests/browser/fx-lab.test.ts` (the page
replays `level-1` in 2D and 3D with the golden hashes and plays the frame events' sounds; skipped
without Chromium); `pnpm test tests/browser/fx-lab-ui.test.ts` (T7: the menu and the dialog by
keyboard, mouse and touch; `WW_SHOTS_DIR=<folder>` keeps the shots); `pnpm test
tests/browser/fx-lab-mix.test.ts` (T8: the mixer's gains recorded over `level-1`, the same on
every load, and the dialog's duck). `pnpm dev` and open `/games/fx-lab/`.
