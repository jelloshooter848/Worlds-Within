# games/rts-classic

Folder: `games/rts-classic`. Detailed rules: [`games/rts-classic/CLAUDE.md`](../../games/rts-classic/CLAUDE.md).

## Purpose

**RTS classic**, a test game (Engine 0.16 part D, D2): the 0.15 River Ford, the small RTS
skirmish of `games/samples/rts-skirmish` (one 40x24 map, red's workers, town centre and hero
against a scripted raiding party of four soldiers, on `kits/rts` over an `engine/sim` world),
copied here unchanged with its five run files and golden hashes, so the sample can become the
full ten-minute match (D8) without moving any existing hash. Like `games/platformer-classic` it
is a test game, not a sample: its run files guard all five RTS kit rules and its `battle` run is
the RTS tile of the PixiJS parity test and sheet. Its run files must never move: a hash change
here is a rule change to list, never a re-record to make a feature fit.

## Public API entry points

- `game.json`: id `rts-classic`, kit `rts`, 320x240, seed 9, `headless.ts`, `view.ts`, the
  title and menus of The River Ford.
- `content/`: the sample's content as it stood: `maps/skirmish.world.json`,
  `types/skirmish.json`, `enemy/raiders.json`, `sprites/`, `palettes/`, `skins/canvas2d.json`,
  `sfx/`, `songs/ford.json`, `fonts/`.
- `content.ts` (`loadSkirmish`, root `games/rts-classic/`), `headless.ts` (`createGame`,
  `skirmishResult`), `actions.ts`, `picture.ts`, `view.ts` (`createView`), `play.ts`
  (`SkirmishPlay`), `recording.ts` (`BattleRecorder`), `main.ts` + `index.html` (the page,
  `games/rts-classic/` in the games index, PixiJS by default with the Canvas2D fallback).
- `runs/`: `battle` (`588fe33bb3ecfcfd`), `commands` (`9f8fc0dc11549b95`), `hold`
  (`dcf2c02f2cb6d266`), `economy` (`34bf04d6b067075d`), `lost` (`2cc7b6a08b67cdfd`), each with
  its golden `.hashes.json` (only the `run` path differs from the sample's).

## Imports allowed

- Relative paths inside the folder, `@engine/core/*`, `@engine/sim/*`, `@engine/backends/*` and
  `@kits/rts`.
- Never other games (the sample it was copied from included) or kits. Nothing in `engine/` or
  `kits/` imports from here.

## How to test

`pnpm test games/rts-classic`, `pnpm -s cli validate games/rts-classic --json`,
`pnpm -s cli run games/rts-classic/runs/battle.run.json --json` (any of the five),
`pnpm -s cli mutants games/rts-classic --json` (held to no unguarded rule and no weak run by
`tests/runs/rts-classic-mutants.test.ts`), `pnpm test tests/runs` (golden hashes, backend parity,
presentation invariance), `engine/tools/world-data.test.ts` (its events),
`tests/browser/pixi-parity.test.ts` (its `battle` on Canvas2D and PixiJS) and
`tests/browser/pixi-pages.test.ts` (its page's backends).
