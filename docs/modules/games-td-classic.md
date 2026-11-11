# games/td-classic

Folder: `games/td-classic`. Detailed rules: [`games/td-classic/CLAUDE.md`](../../games/td-classic/CLAUDE.md).

## Purpose

**TD classic**, a test game (Engine 0.16 part E, E2): the 0.15 Winding Road, the tower-defense
sample of `games/samples/tower-defense` (one winding road on a 16 x 15 map, arrow and cannon
towers and three waves, on `kits/towerdefense` with no `engine/sim`), copied here unchanged with
its five run files and golden hashes, so the sample can become the ten-wave map of 0.16 (E8)
without moving any existing hash. Like `games/rts-classic` it is a test game, not a sample: its
run files guard the tower-defense kit's 0.15 rules (the kit is strict) and its `won` run is the
tower-defense case of the PixiJS parity test. Its run files must never move: a hash change here
is a rule change to list, never a re-record to make a feature fit.

## Public API entry points

- `game.json`: id `td-classic`, kit `towerdefense`, 256x240, seed 12, `headless.ts`, `view.ts`,
  the title and menus of The Winding Road.
- `content/`: the sample's content as it stood: `maps/road.json` + `maps/road.map.txt`,
  `towers/towers.json`, `waves/road.json`, `sprites/`, `palettes/`, `skins/canvas2d.json`,
  `sfx/`, `songs/road.json`, `fonts/`.
- `content.ts` (`loadTowerDefense`, root `games/td-classic/`; `sampleRound`), `headless.ts`
  (`createGame`), `picture.ts`, `view.ts` (`createView`), `play.ts` (`TdPlay`), `main.ts` +
  `index.html` (the page, `games/td-classic/` in the games index, PixiJS by default with the
  Canvas2D fallback).
- `runs/`: `build` (`c0f414299bc01881`), `won` (`9bbdc8413bc8a0e2`), `target`
  (`c007de2189d310be`), `leaked` (`48e726691354fd14`), `tapped` (`9bbdc8413bc8a0e2`), each with
  its golden `.hashes.json` (only the `run` path differs from the sample's).

## Imports allowed

- Relative paths inside the folder, `@engine/core/*`, `@engine/backends/*` and
  `@kits/towerdefense`. Tests may also use `@engine/backends/null`.
- Never `engine/sim`, other games (the sample it was copied from included) or other kits. Nothing
  in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/td-classic`, `pnpm -s cli validate games/td-classic --json`,
`pnpm -s cli run games/td-classic/runs/won.run.json --json` (any of the five),
`pnpm -s cli mutants games/td-classic --json` (strict; held to no unguarded rule but those listed
in `tests/runs/td-classic-mutants.test.ts`, and no weak run), `pnpm test tests/runs` (golden
hashes, backend parity, presentation invariance), `tests/build/pages.test.ts` (its games index
link), `tests/browser/pixi-parity.test.ts` (its `won` on Canvas2D and PixiJS) and
`tests/browser/pixi-pages.test.ts` (its page's backends).
