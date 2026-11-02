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
format), `entity`, `enemies`, `items`, `hero`, `world`, `view`, `render`, `hud`, `frames`, `walker`,
`person`, `snapshot` (`snapshotWorld`, `topdownGame`: the world as the engine's `HeadlessGame`,
for `pnpm cli run` and `dump`), `present` (`presentWorld(world, events, opts)`: the world as an
engine `PresentFrame` (room map with a version that changes with its tiles, the hero and every
other entity in draw order with `TD_DEPTH` depths, HUD status values, events with positions and a
camera hint; the kit's `CLAUDE.md` maps old frame names to presented kinds and animations) without drawing and without changing any state;
`TdPresentState` keeps the `MapTracker` and stable entity ids), `rules` (`TOPDOWN_RULES`: the named rules a run can switch off
with `disabledRules`, for `pnpm cli mutants`; a first few in Engine 0.3, full adoption in 0.5)
and `schema` (`roomSchema`, `roomKind`: the room file schema, with the map in a
`.map.txt` text grid). `bot.ts` (the scripted test bot) is imported directly by tests.

## Imports allowed

- `@engine/core/*` and relative paths inside the kit.
- Tests may also use `@engine/backends/null`.
- Never other backends, `engine/sim`, `engine/tools`, other kits or games.
- No `Math.random`, wall-clock time or DOM globals (lint-enforced). No content outside tiny test
  fixtures.

## How to test

`*.test.ts` next to the code (`topdown.test.ts`, `town-kit.test.ts`, `items.test.ts`,
`beam.test.ts`, `schema.test.ts`, `snapshot.test.ts`, `rules.test.ts`, `present.test.ts`, `present-entities.test.ts`) run in Node with `pnpm test`, driving the world with `ScriptedInput` and a fixed
seed.
