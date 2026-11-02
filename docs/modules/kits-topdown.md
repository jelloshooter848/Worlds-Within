# kits/topdown

Folder: `kits/topdown`. Detailed rules: [`kits/topdown/CLAUDE.md`](../../kits/topdown/CLAUDE.md).

## Purpose

Gameplay rules for a room-based action game seen from above: rooms from text grids, a world with
tile collision, doors, room slides and conditions, a sword hero with an item slot, enemies, objects,
items, walking townsfolk and a scripted test bot. It never knows about a particular game: the game
supplies rooms, extra spawn kinds, sheets and its own scene. It reports what happened through
`world.events`.

## Public API entry points

`index.ts`, imported as `@kits/topdown`, re-exports `geometry`, `room` (rooms and the `LEGEND` text
format), `entity`, `enemies`, `items`, `hero`, `world`, `view`, `render`, `hud`, `frames`, `walker`
and `person`. `bot.ts` (the scripted test bot) is imported directly by tests.

## Imports allowed

- `@engine/core/*` and relative paths inside the kit.
- Tests may also use `@engine/backends/null`.
- Never other backends, `engine/sim`, `engine/tools`, other kits or games.
- No `Math.random`, wall-clock time or DOM globals (lint-enforced). No content outside tiny test
  fixtures.

## How to test

`*.test.ts` next to the code (`topdown.test.ts`, `town-kit.test.ts`, `items.test.ts`,
`beam.test.ts`) run in Node with `pnpm test`, driving the world with `ScriptedInput` and a fixed
seed.
