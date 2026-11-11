# games/samples/rts-skirmish

Folder: `games/samples/rts-skirmish`. Detailed rules: [`games/samples/rts-skirmish/CLAUDE.md`](../../games/samples/rts-skirmish/CLAUDE.md).

## Purpose

The first RTS sample (Engine 0.9) and the first folder under `games/samples/`: one 40x24 map
written as a world scenario, one side (workers, a town centre, a hero) against a scripted raiding
party, on `kits/rts` over an `engine/sim` world. Build a barracks, train soldiers and beat the
raid, headless from recorded orders with the same state hashes every time. It holds only content
(map, unit and building types, the enemy's plan, text pixel art, a Canvas2D skin) and thin glue.
Since Engine 0.9 T12 it plays in the browser (mouse and touch), and a battle played there
exports as a run file that `pnpm -s cli run` replays to the same state hashes. Since Engine 0.15
T14 it is **finished** as **The River Ford** (docs/BUILD-LOG.md, Engine 0.15, decision 13): sfx
for the battle's events and an MML song, no placeholder look left, a win and a loss with an end
banner and an end screen, and a `lost` run file. Its `CLAUDE.md` is the worked example of an RTS
game on the kit. From Engine 0.16 part D (D7) it draws on a CC0 pack, Kenney's Medieval RTS
(`assets/kenney-medieval-rts/`, credited in `assets/CREDITS.md`), at 16:9 (480x270, 4x is
1920x1080), with team colours, team outlines, zoom-stable bars and a minimap; text sprites remain
only where the pack has nothing (ring, bars, box, path dots, order markers, HUD icons, banners).
Presentation only: no hash moved.

## Public API entry points

- `game.json`: kit `rts`, 480x270 (16:9, Engine 0.16 part D, D7; 320x240 before), seed 9,
  `headless.ts`, `view.ts`; the title's art is the pack's hero and soldiers.
- `assets/kenney-medieval-rts/` (D7): the pack's sheet `medieval-rts-sheet.png` and its atlas
  (`medieval-rts-sheet-atlas.txt`), `license.txt`, and `ford-tiles.png`, the ground, roads, river
  banks, rocks, trees, gold, sites and ghost cut and scaled from the pack for 16 px cells by
  `tools/ford-tiles.ts` (`fordTiles`, `FORD_FRAMES`); `assets/CREDITS.md`.
- `content/`: `maps/skirmish.world.json` (`rts-map`), `types/skirmish.json` (`rts-types`),
  `enemy/raiders.json` (`rts-enemy`), `sprites/skirmish.txt` (what the pack lacks: ring, bars,
  box, path dots, order markers, HUD icons, the end banners `banner-won` and `banner-lost`) and
  `skirmish-font.txt`, `palettes/skirmish.json`, `skins/canvas2d.json` (images `rts` and `ford`;
  every kind the kit presents with team colours and outlines; tiles with `join` roads and banks
  and `vary` ground; `fog` colours; its `events`: sounds and effects for the kit's
  `RtsEventTracker` events and `battle-end`; its HUD: the counters, a minimap and the banners),
  `sfx/*.json` (nine) and `songs/ford.json` (Engine 0.15 T14).
- `headless.ts`: `createGame(content, seed, opts?)` (a `SkirmishGame`: the kit's `rtsGame` on
  the sim's `rtsWorldPort(world)` (Engine 0.15 T6, gap M27), taking
  recorded orders and interface actions; snapshot `{ world, kit, sides, ui }`; Engine 0.14 T7:
  `worldEvents(sinceTick)` and `timeline()` over its world), `createWorld`,
  `sidesOf` (the kit's, re-exported), `skirmishResult(view)` (`won`, `lost` or null; the
  sample's end rule, kept out of the snapshot).
- `actions.ts`: interface actions (`click`, `box`, `command`, `build`, `train`, `stop`) through
  the kit's selection and command mapper.
- `index.html`, `main.ts` (the page: `bootBrowserGame` with the song `ford`, the skin's event
  sounds through the display's `onSound` and the shell's volume control (gap M1), the button bar,
  Export, the end screen `#end` with Play again, the `window.wwSkirmish` hook with `result()` and
  `clientAt` through the display's `toClient`), `play.ts` (`SkirmishPlay`, the page's scene:
  camera, controls, buttons, `result()`, `TICKS_PER_SECOND` 10), `recording.ts`
  (`BattleRecorder`: sync hashes every 20 ticks and the battle as a run file); the data files come
  from `virtual:game-files`.
- `content.ts` (`SKIRMISH_MUSIC`), `picture.ts` (`skirmishLook`, `sideKinds`,
  `SkirmishPresentState`, `skirmishFrames`, `skirmishCanvasPicture(r, look, ui?, onSound?)`: each
  frame carries the tick's events and, once over, `won` or `lost` in its status),
  `view.ts` (`createView`).
- `runs/battle.run.json` (barracks, soldiers, the raid beaten), `commands.run.json` (the same
  battle through interface actions), `hold.run.json`, `economy.run.json`, `lost.run.json` (Engine
  0.15 T14: every red unit sent at the raiders falls by tick 80), each with sync
  `hashes` and golden `<name>.hashes.json`; together they guard all five kit rules, with no run weak
  (`tests/runs/rts-skirmish-mutants.test.ts`; the kit is not strict, so `mutants` alone would not
  fail).
- Engine 0.15 T7: `SkirmishGame.worldKeys()`, so `commands` checks `world.key.worker-3.Gatherer.node`
  and, for entities made in play, `world.id.<n>...` (no positional component path).

## Imports allowed

- Relative paths inside the folder, `@engine/core/*`, `@engine/sim/*`, `@engine/backends/*` and
  `@kits/rts`.
- Never other games or kits. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/samples/rts-skirmish` (`assets.test.ts`: the credits, the made sheet against
its script, the frames against the pack's atlas), `pnpm -s cli validate games/samples/rts-skirmish --json`,
`pnpm -s cli run games/samples/rts-skirmish/runs/battle.run.json --json`,
`pnpm -s cli mutants games/samples/rts-skirmish --json` (exit 0), `pnpm test tests/runs` (golden
hashes and backend parity through null and Canvas2D), `pnpm -s cli screenshot
games/samples/rts-skirmish/runs/battle.run.json --tick 140 --json`,
`pnpm vitest run tests/browser/rts-skirmish.test.ts` (the page followed from the games index's
link in headless Chromium: the volume control, a battle by mouse and touch, the end screen on the
win, its export replayed with `pnpm -s cli run` to the same hashes), `pnpm vitest run
tests/browser/pixi-parity.test.ts` (the sample's battle on Canvas2D and PixiJS, strict bound).

## 2D backend choice

The page draws through the PixiJS (WebGL) backend by default (`default2d: 'pixi'` in `main.ts`,
Engine 0.16 T13b-8; `@engine/backends/pixi`, loaded with a dynamic `import()`, its own chunk) and
falls back to Canvas2D where WebGL is missing (`body[data-backend]` says which runs; software
WebGL, such as headless Chromium's SwiftShader, counts as WebGL). `?backend=canvas2d` forces
Canvas2D (exact Canvas2D output, a machine whose WebGL misbehaves); `?backend=pixi` names the
default. `pnpm cli screenshot` and the run files' backend parity still draw through Canvas2D
(`view.ts`). Tested in `tests/browser/pixi-pages.test.ts` (the default, the fallback with WebGL
taken away, `?backend=canvas2d`); the page and menus browser tests play on PixiJS.
