# games/samples/tower-defense

Folder: `games/samples/tower-defense`. Detailed rules: [`games/samples/tower-defense/CLAUDE.md`](../../games/samples/tower-defense/CLAUDE.md).

## Purpose

The standalone tower-defense sample (Engine 0.12, the platform test), since Engine 0.16 E8 the
part E map: one winding road on a 16:9 map (30 x 16 cells on a 480x270 picture, 4x is 1920x1080),
three tower types with two upgrades each (arrow; cannon, which splashes; frost, which slows), ten
waves and a star rating, on `kits/towerdefense` with no `engine/sim` (the 0.15 round lives on as
`games/td-classic`). It holds
only content (the map and its grid, the tower types, the waves) and thin glue; every rule of the
round is the kit's. Its run files are short guard runs on the map (placing and refusals, upgrades,
splash, slow, targeting, the timer, a leak, a loss) and a ten-wave win, and guard every kit rule
(the kit is strict). Since T5 it has original NES-style art,
MML sound and a Canvas2D skin (all text), a view for `pnpm cli screenshot` and a playable page
(keys, the touch pad, taps to build, the bar's Wave, Tower and Sell buttons), listed by the root
launcher. Since Engine 0.15 T14 it is finished as **The Winding Road**: its assets audited (no
look with its own fallback colour, every tick of every run drawn from the art, an sfx for every
sound), its page on the shell's tick rate and frame taps, its tests tapping through the kit's
`screenAtCell`, and its browser test following the games index's link; no run file or hash
changed. Since Engine 0.16 E7 it is drawn from Kenney's CC0 Tower Defense pack
(`assets/kenney-tower-defense/`, credited in `assets/CREDITS.md`): the pack's sheets scaled to 16
and 24 px and a sheet cut from them by `tools/road-art.ts` (checked byte for byte), with a new
skin: three tower types (arrow, cannon, frost) at levels 1-3 turned to their targets,
walking enemies with hit flashes, slowed looks and health bars, range rings on the ghost and the
selected tower, projectiles with impacts, and a sound for every event. Its `CLAUDE.md` is the
worked example of a tower-defense game.

## Public API entry points

- `game.json`: kit `towerdefense`, 480x270, seed 12, `headless.ts`, `view.ts`, the menus (title,
  pause, settings, controls with upgrade and speed) and `menus.speeds` `[1, 2, 3]`.
- `content/`: `maps/road.json` + `maps/road.map.txt` (`td-map`), `towers/towers.json`
  (`td-towers`), `waves/road.json` (`td-waves`), `sprites/td.txt` (the cursor and HUD icons, the
  only text art left) and `sprites/td-font.txt`, `palettes/td.json`, `skins/canvas2d.json` (the
  pack's art keyed on the kit's kinds and tags: `level:`, `blocked`, `selected`, `range:`, `hit`,
  `slow`, `hp:`/`maxhp:`; Engine 0.16 E7), `sfx/` (one per kit event) and `songs/road.json`.
- `assets/kenney-tower-defense/` (`tilesheet-16.png`, `tilesheet-24.png`, `road-art.png`,
  `license.txt`) and `assets/CREDITS.md`; `tools/road-art.ts` (`roadArt`, `ROAD_FRAMES`: the cut
  sheet from the pack's); `assets.test.ts`.
- `picture.ts`: `tdLook`, `tdFrameStream`, `tdPicture`, `tdCanvasPicture`; `view.ts`:
  `createView` (the engine's `frameView`).
- `play.ts`: `TdPlay` (the page's scene: one game tick per update at its `tickRate` of 30, paced
  and merged by the shell since Engine 0.15, gap D2; keys and taps are frame input the kit reads,
  gap D1); `main.ts` + `index.html`: the page over `bootBrowserGame` (the shell's volume control,
  gap M1; the bar's buttons through `InputManager.press`; the status's hint from the kit's
  `TD_CONTROLS` with the player's keys, lesson D14; `window.wwTd` for scripts).
- `headless.ts`: `createGame(content, seed, opts?)`, the kit's `TdGame` (snapshot
  `{ round, controls, kit }`).
- `content.ts`: `loadTowerDefense(files)`, `sampleRound(content)`; the page's data
  files come from `virtual:game-files`.
- `runs/` (Engine 0.16 E8): `build` (placing, refusals, selling), `upgrade` (two upgrades, a
  refused third), `splash` (the cannon's splash kill), `slow` (the frost tower), `target` (the
  runner furthest along shot first), `timer` (the first wave by the timer), `leak` (lives lost to
  a thin defence), `lost` (no defence, the round lost) and `won` (all ten waves held, three
  stars), each with sync `hashes` and golden `<name>.hashes.json`.

## Imports allowed

- Relative paths inside the folder, `@engine/core/*`, `@engine/backends/canvas2d` and
  `@kits/towerdefense`. Tests may also use `@engine/backends/null`.
- Never `engine/sim`, other games or other kits. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/samples/tower-defense` (with `assets.test.ts`: the credits, the files kept, the cut
sheet byte for byte), `pnpm -s cli validate games/samples/tower-defense --json`,
`pnpm -s cli run games/samples/tower-defense/runs/won.run.json --json` (and the other eight),
`pnpm -s cli mutants games/samples/tower-defense --json` (exit 0, `strict: true`, every rule
guarded; `tests/runs/tower-defense-mutants.test.ts`), `pnpm test tests/runs` (golden hashes,
backend parity). How to play: arrows move, Z or a second tap builds, X picks the tower, C or a
right click sells, Z or a tap on a selected tower upgrades it, Enter or the Wave button sends a
wave, F or the speed button speeds the game up. The page and the art:
`pnpm -s cli screenshot games/samples/tower-defense/runs/won.run.json --tick 1300 --json`
(deterministic PNG), `tests/browser/tower-defense-page.test.ts` (the built page opened from the
games index's link, the volume control, played by taps and by keys, no page errors) and `tests/browser/tower-defense-shots.test.ts`
(headless Chromium; skipped where none is installed), `tests/browser/pixi-parity.test.ts` (the
`won` run on Canvas2D and PixiJS within the strict bound), `tests/build/pages.test.ts` (the
launcher).

## 2D backend choice

The page draws through the PixiJS (WebGL) backend by default (`default2d: 'pixi'` in `main.ts`,
Engine 0.16 T13b-8; `@engine/backends/pixi`, loaded with a dynamic `import()`, its own chunk) and
falls back to Canvas2D where WebGL is missing (`body[data-backend]` says which runs; software
WebGL, such as headless Chromium's SwiftShader, counts as WebGL). `?backend=canvas2d` forces
Canvas2D (exact Canvas2D output, a machine whose WebGL misbehaves); `?backend=pixi` names the
default. `pnpm cli screenshot` and the run files' backend parity still draw through Canvas2D
(`view.ts`). Tested in `tests/browser/pixi-pages.test.ts` (the default, the fallback with WebGL
taken away, `?backend=canvas2d`); the page and menus browser tests play on PixiJS.
