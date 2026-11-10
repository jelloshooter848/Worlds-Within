# games/samples/tower-defense

Folder: `games/samples/tower-defense`. Detailed rules: [`games/samples/tower-defense/CLAUDE.md`](../../games/samples/tower-defense/CLAUDE.md).

## Purpose

The standalone tower-defense sample (Engine 0.12, the platform test): one winding road on a 16 x 15
map, arrow and cannon towers and three waves, on `kits/towerdefense` with no `engine/sim`. It holds
only content (the map and its grid, the tower types, the waves) and thin glue; every rule of the
round is the kit's. Its run files place towers with the cursor, hold every wave or lose to a thin
defence, and guard every kit rule (the kit is strict). Since T5 it has original NES-style art,
MML sound and a Canvas2D skin (all text), a view for `pnpm cli screenshot` and a playable page
(keys, the touch pad, taps to build, the bar's Wave, Tower and Sell buttons), listed by the root
launcher. Since Engine 0.15 T14 it is finished as **The Winding Road**: its assets audited (no
look with its own fallback colour, every tick of every run drawn from the art, an sfx for every
sound), its page on the shell's tick rate and frame taps, its tests tapping through the kit's
`screenAtCell`, and its browser test following the games index's link; no run file or hash
changed. Its `CLAUDE.md` is the worked example of a tower-defense game.

## Public API entry points

- `game.json`: kit `towerdefense`, 256x240, seed 12, `headless.ts`, `view.ts`.
- `content/`: `maps/road.json` + `maps/road.map.txt` (`td-map`), `towers/towers.json`
  (`td-towers`), `waves/road.json` (`td-waves`), `sprites/td.txt` and `sprites/td-font.txt`,
  `palettes/` (`td` and the recolours `td-ok`, `td-blocked`, `td-hit`), `skins/canvas2d.json`
  (keyed on the kit's kinds; `byTag` for the ghost's `ok`/`blocked` and a struck enemy's `hit`),
  `sfx/` (one per kit event) and `songs/road.json`.
- `picture.ts`: `tdLook`, `tdFrameStream`, `tdPicture`, `tdCanvasPicture`; `view.ts`:
  `createView` (the engine's `frameView`).
- `play.ts`: `TdPlay` (the page's scene: one game tick per update at its `tickRate` of 30, paced
  and merged by the shell since Engine 0.15, gap D2; keys and taps are frame input the kit reads,
  gap D1); `main.ts` + `index.html`: the page over `bootBrowserGame` (the shell's volume control,
  gap M1; the bar's buttons through `InputManager.press`; the status's hint from the kit's
  `TD_CONTROLS` with the player's keys, lesson D14; `window.wwTd` for scripts).
- `runs/tapped.run.json` (Engine 0.15): a round won by pointer taps (`input.taps`).
- `headless.ts`: `createGame(content, seed, opts?)`, the kit's `TdGame` (snapshot
  `{ round, controls, kit }`).
- `content.ts`: `loadTowerDefense(files)`, `sampleRound(content)`; the page's data
  files come from `virtual:game-files`.
- `runs/build.run.json` (placing, refusals, selling), `won.run.json` (every wave held),
  `target.run.json` (the tower shoots the runner furthest along), `leaked.run.json` (waves by the
  timer, lives lost, the round lost), each with sync `hashes` and golden `<name>.hashes.json`.

## Imports allowed

- Relative paths inside the folder, `@engine/core/*`, `@engine/backends/canvas2d` and
  `@kits/towerdefense`. Tests may also use `@engine/backends/null`.
- Never `engine/sim`, other games or other kits. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/samples/tower-defense`, `pnpm -s cli validate games/samples/tower-defense --json`,
`pnpm -s cli run games/samples/tower-defense/runs/won.run.json --json` (and `tapped`),
`pnpm -s cli mutants games/samples/tower-defense --json` (exit 0, `strict: true`, every rule
guarded; `tests/runs/tower-defense-mutants.test.ts`), `pnpm test tests/runs` (golden hashes,
backend parity). How to play: arrows move, Z or a second tap builds, X picks the tower, C or a
right click sells, Enter or the Wave button sends a wave. The page and the art:
`pnpm -s cli screenshot games/samples/tower-defense/runs/won.run.json --tick 300 --json`
(deterministic PNG), `tests/browser/tower-defense-page.test.ts` (the built page opened from the
games index's link, the volume control, played by taps and by keys, no page errors) and `tests/browser/tower-defense-shots.test.ts`
(headless Chromium; skipped where none is installed), `tests/build/pages.test.ts` (the launcher).

## 2D backend choice

The page draws through the PixiJS (WebGL) backend by default (`default2d: 'pixi'` in `main.ts`,
Engine 0.16 T13b-8; `@engine/backends/pixi`, loaded with a dynamic `import()`, its own chunk) and
falls back to Canvas2D where WebGL is missing (`body[data-backend]` says which runs; software
WebGL, such as headless Chromium's SwiftShader, counts as WebGL). `?backend=canvas2d` forces
Canvas2D (exact Canvas2D output, a machine whose WebGL misbehaves); `?backend=pixi` names the
default. `pnpm cli screenshot` and the run files' backend parity still draw through Canvas2D
(`view.ts`). Tested in `tests/browser/pixi-pages.test.ts` (the default, the fallback with WebGL
taken away, `?backend=canvas2d`); the page and menus browser tests play on PixiJS.
