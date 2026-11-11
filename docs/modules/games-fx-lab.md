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
the shell's `UiScene` with keyboard, gamepad, mouse and touch (2D), from T8 layered music, from
T9 the title, pause, settings and controls screens (from part B also the level select, the
level-clear banner, the end screen and a respawn iris), from T10-T12 a PNG sprite sheet, a glTF
model and the 3D scene look, original sfx, run
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
- `assets/fx-lab-glb/brazier.glb` (T11): the lab's glTF model, an original low-poly brazier
  with a `flicker` clip, made by `tools/brazier-model.ts` (`pnpm exec tsx
games/fx-lab/tools/brazier-model.ts`; own work, CC0, credited), shown for the `torch` kind in
  the 3D skin (`scale` 18, anchored `bottom`, turned 30 degrees, `idle` playing `flicker`) with
  its low-poly text mesh as the stand-in while it loads.
- `content/skins/ground.json`, `ground.ts` and the page `ground/` (Engine 0.16 F2): the 3D
  backend's ground view on a hand-made meadow (not the platformer's levels): `groundSkin`,
  `groundCamera` (an `RtsCamera` with the skin's ground camera) and `groundFrame(n, camera,
screen)`; `ground.test.ts` and `tests/browser/fx-lab-ground.test.ts`. From Engine 0.16 F3 the
  meadow is dressed by a decor grid (`content/decor/meadow.txt`, the skin's `decor` legend:
  pines, bushes and flowers instanced, stones one copy each, from `assets/fx-lab-decor/*.gltf`,
  made by `tools/decor-models.ts`) and names its places (`THE POND`, `THE PATH`, `OLD WALL`);
  the page takes `?scale=<n>` for the render scale. From Engine 0.16 F4 the ground skin has a
  `scene3d.timeOfDay` (night, dawn, day, late afternoon, dusk and night keys) and a `clock` HUD
  item (`Day 1 20:30 evening` over a day bar); `groundClock(hour, n, jump?)` gives a frame the
  world clock, and the page's `?hour=<h>&jump=<n>` shows an hour and a two-hour jump eased.
- `runs/level-1.run.json`, `runs/level-2.run.json`, `runs/level-3.run.json` with golden hashes.
- The effects sheet (T14): `docs/reports/0.16a-effects-sheet.png`, 24 labelled tiles of these
  run files in 2D and 3D made with `pnpm cli sheet` (every part A feature: particles, flashes and
  shake, transitions, the UI kit, the title, pause, settings and controls screens, the PNG torch
  and glTF brazier, 3D lighting, shadows, fog and labels); the command is in
  `docs/BUILD-LOG.md` (Engine 0.16 part A).

Lighting (Engine 0.16 part C T4): the 2D skin's `lighting` makes `fx-3` ("torchlight") a night
level (`maps.fx-3`, darkness 0.82 in deep blue) lit by each torch (radius 72, flickering), Pip's
small cyan light, the door and the coins, with a flash of light on `stomp` and `coin`, a vignette
on every level and drifting embers (`night-embers`, `particles` on `fx-3` only).

## Imports allowed

- Relative paths inside `games/fx-lab`, `@engine/*` (core and backends) and `@kits/platformer`.
- Never other games or kits. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/fx-lab` (`fx-lab.test.ts`: the committed PNG equals its script's output (T10), and the GLB its script's (T11), every torch shown as the brazier model in the 3D scene over level-3, level order, both skins' animation sets, frame-event
sounds through both presenters, the particle presets, the camera effects and parallax in both
skins, hit-pause requests on stomps and the 3D zoom on the door); `pnpm -s cli validate games/fx-lab --json`;
`pnpm -s cli run games/fx-lab/runs/level-1.run.json --json` (and `level-2`, `level-3`); `pnpm test tests/runs`
(golden hashes, presentation invariance); `pnpm test tests/browser/fx-lab.test.ts` (the page
replays `level-1` in 2D and 3D with the golden hashes and plays the frame events' sounds; skipped
without Chromium); `pnpm test tests/browser/fx-lab-ui.test.ts` (T7: the menu and the dialog by
keyboard, mouse and touch; `WW_SHOTS_DIR=<folder>` keeps the shots); `pnpm test
tests/browser/fx-lab-mix.test.ts` (T8: the mixer's gains recorded over `level-1`, the same on
every load, and the dialog's duck). `pnpm dev` and open `/games/fx-lab/`.

## 2D backend choice

`?backend=pixi` draws the page through the PixiJS (WebGL) backend (`@engine/backends/pixi`, loaded
with a dynamic `import()`, its own chunk) and falls back to Canvas2D where WebGL is missing;
`?backend=canvas2d` or no query keeps Canvas2D, the default (Engine 0.16 T13b-4).
