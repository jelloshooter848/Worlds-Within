# games/samples/rts-skirmish

Folder: `games/samples/rts-skirmish`. Detailed rules: [`games/samples/rts-skirmish/CLAUDE.md`](../../games/samples/rts-skirmish/CLAUDE.md).

## Purpose

The first RTS sample (Engine 0.9) and the first folder under `games/samples/`: one 40x24 map
written as a world scenario, one side (workers, a town centre, a hero) against a scripted raiding
party, on `kits/rts` over an `engine/sim` world. Build a barracks, train soldiers and beat the
raid, headless from recorded orders with the same state hashes every time. It holds only content
(map, unit and building types, the enemy's plan, text pixel art, a Canvas2D skin) and thin glue.
Since Engine 0.9 T12 it plays in the browser (mouse and touch), and a battle played there
exports as a run file that `pnpm -s cli run` replays to the same state hashes.

## Public API entry points

- `game.json`: kit `rts`, 320x240, seed 9, `headless.ts`, `view.ts`.
- `content/`: `maps/skirmish.world.json` (`rts-map`), `types/skirmish.json` (`rts-types`),
  `enemy/raiders.json` (`rts-enemy`), `sprites/skirmish.txt` and `skirmish-font.txt`,
  `palettes/skirmish.json` and `skirmish-blue.json`, `skins/canvas2d.json`.
- `headless.ts`: `createGame(content, seed, opts?)` (a `SkirmishGame`: the kit's `rtsGame`, taking
  recorded orders and interface actions; snapshot `{ world, kit, sides, ui }`; Engine 0.14 T7:
  `worldEvents(sinceTick)` and `timeline()` over its world), `createWorld`,
  `sidesOf` (the kit's, re-exported).
- `actions.ts`: interface actions (`click`, `box`, `command`, `build`, `train`, `stop`) through
  the kit's selection and command mapper.
- `index.html`, `main.ts` (the page: `bootBrowserGame`, the button bar, Export, the
  `window.wwSkirmish` hook), `play.ts` (`SkirmishPlay`, the page's scene: camera, controls,
  buttons, `TICKS_PER_SECOND` 10), `recording.ts` (`BattleRecorder`: sync hashes every 20 ticks
  and the battle as a run file); the data files come from `virtual:game-files`.
- `content.ts`, `picture.ts` (`skirmishLook`, `sideKinds`, `skirmishFrames`,
  `skirmishCanvasPicture`), `view.ts` (`createView`).
- `runs/battle.run.json` (barracks, soldiers, the raid beaten), `commands.run.json` (the same
  battle through interface actions), `hold.run.json`, `economy.run.json`, each with sync
  `hashes` and golden `<name>.hashes.json`; together they guard all five kit rules, with no run weak
  (`tests/runs/rts-skirmish-mutants.test.ts`; the kit is not strict, so `mutants` alone would not
  fail).

## Imports allowed

- Relative paths inside the folder, `@engine/core/*`, `@engine/sim/*`, `@engine/backends/*` and
  `@kits/rts`.
- Never other games or kits. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/samples/rts-skirmish`, `pnpm -s cli validate games/samples/rts-skirmish --json`,
`pnpm -s cli run games/samples/rts-skirmish/runs/battle.run.json --json`,
`pnpm -s cli mutants games/samples/rts-skirmish --json` (exit 0), `pnpm test tests/runs` (golden
hashes and backend parity through null and Canvas2D), `pnpm -s cli screenshot
games/samples/rts-skirmish/runs/battle.run.json --tick 140 --json`,
`pnpm vitest run tests/browser/rts-skirmish.test.ts` (the page in headless Chromium: a battle by
mouse and touch, its export replayed with `pnpm -s cli run` to the same hashes).
