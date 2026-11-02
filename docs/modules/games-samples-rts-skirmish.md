# games/samples/rts-skirmish

Folder: `games/samples/rts-skirmish`. Detailed rules: [`games/samples/rts-skirmish/CLAUDE.md`](../../games/samples/rts-skirmish/CLAUDE.md).

## Purpose

The first RTS sample (Engine 0.9) and the first folder under `games/samples/`: one 40x24 map
written as a world scenario, one side (workers, a town centre, a hero) against a scripted raiding
party, on `kits/rts` over an `engine/sim` world. Build a barracks, train soldiers and beat the
raid, headless from recorded orders with the same state hashes every time. It holds only content
(map, unit and building types, the enemy's plan, text pixel art, a Canvas2D skin) and thin glue.
The browser page comes in Engine 0.9 T12.

## Public API entry points

- `game.json`: kit `rts`, 320x240, seed 9, `headless.ts`, `view.ts`.
- `content/`: `maps/skirmish.world.json` (`rts-map`), `types/skirmish.json` (`rts-types`),
  `enemy/raiders.json` (`rts-enemy`), `sprites/skirmish.txt` and `skirmish-font.txt`,
  `palettes/skirmish.json` and `skirmish-blue.json`, `skins/canvas2d.json`.
- `headless.ts`: `createGame(content, seed, opts?)` (a `SkirmishGame`: the kit's `rtsGame`, taking
  recorded orders and interface actions; snapshot `{ world, kit, sides, ui }`), `createWorld`,
  `sidesOf`.
- `actions.ts`: interface actions (`click`, `box`, `command`, `build`, `train`, `stop`) through
  the kit's selection and command mapper.
- `content.ts`, `picture.ts` (`skirmishLook`, `sideKinds`, `skirmishFrames`,
  `skirmishCanvasPicture`), `view.ts` (`createView`).
- `runs/battle.run.json` (barracks, soldiers, the raid beaten), `commands.run.json` (the same
  battle through interface actions), `hold.run.json`, `economy.run.json`, each with sync
  `hashes` and golden `<name>.hashes.json`; together they guard all five kit rules.

## Imports allowed

- Relative paths inside the folder, `@engine/core/*`, `@engine/sim/*`, `@engine/backends/*` and
  `@kits/rts`.
- Never other games or kits. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/samples/rts-skirmish`, `pnpm -s cli validate games/samples/rts-skirmish --json`,
`pnpm -s cli run games/samples/rts-skirmish/runs/battle.run.json --json`,
`pnpm -s cli mutants games/samples/rts-skirmish --json` (exit 0), `pnpm test tests/runs` (golden
hashes and backend parity through null and Canvas2D), `pnpm -s cli screenshot
games/samples/rts-skirmish/runs/battle.run.json --tick 140 --json`.
