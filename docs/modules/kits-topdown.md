# kits/topdown

Folder: `kits/topdown`. Detailed rules: [`kits/topdown/CLAUDE.md`](../../kits/topdown/CLAUDE.md).

## Purpose

Gameplay rules for a room-based action game seen from above: rooms from text grids, a world with
tile collision, doors, room slides and conditions, a sword hero with an item slot, enemies, objects,
items, walking townsfolk and a scripted test bot. It never knows about a particular game: the game
supplies rooms, extra spawn kinds and its own scene, and a backend draws the kit's presentation
frames through the game's skin. It reports what happened through `world.events`.

## Public API entry points

`index.ts`, imported as `@kits/topdown`, re-exports `geometry`, `room` (rooms and the `LEGEND` text
format), `entity`, `enemies`, `items`, `hero`, `world`, `frames` (tile-sheet text transforms), `walker`,
`person`, `snapshot` (`snapshotWorld`, `topdownGame`: the world as the engine's `HeadlessGame`,
for `pnpm cli run` and `dump`), `present` (`presentWorld(world, events, opts)`: the world as an
engine `PresentFrame` (room map with a version that changes with its tiles, the hero and every
other entity in draw order with `TD_DEPTH` depths, HUD status values, events with positions and a
camera hint; the kit's `CLAUDE.md` maps old frame names to presented kinds and animations) without drawing and without changing any state;
`TdPresentState` keeps the `MapTracker` and stable entity ids), `rules` (`TOPDOWN_RULES`: the named rules a run can switch off
with `disabledRules`, for `pnpm cli mutants`; a first few in Engine 0.3, full adoption in 0.5)
`schema` (`roomSchema`, `roomKind`: the room file schema, with the map in a
`.map.txt` text grid) and `challenge` (`roomChallenge(opts)`: a one-room challenge as the engine's
`MiniGameDef`, for a host from another kit such as a platformer level's door; the game gives the
room (its title from the room file's `title`, Engine 0.7 T9), the trigger's params give `goal` (`defeat-all` or `reach`), `ticks` and `hp`; a round passes
on its goal, fails on the hero's death or time-out and quits on select; `snapshot()` is
`snapshotWorld` plus `round`, `present()` the kit's `presentWorld` frame, and from Engine 0.10
`report()` the round's structured report as plain JSON, `ChallengeReport`: result, ticks, the
hero's `hp`/`lost`/`dead`, every starting enemy by its room cell and which were `defeated` or
`hurt`, which a mission's adapter maps to a declared outcome; reading it changes no hash). `bot.ts` (the scripted test bot) is imported directly by tests.
`kit.ts` exports `kit`, the kit's hook for the tools (`defineKit` from `engine/core/kit.ts`: the
name `topdown`, `kinds()` with the room kind, and `TOPDOWN_RULES`); `engine/tools/kits.ts` finds it
by the `kit` name in `game.json`.

## Imports allowed

- `@engine/core/*` except its drawing and output side (`FORBIDDEN_CORE` in `config/layers.js`:
  the `Renderer`, sprite sheets, `assets/`, audio output, scenes, the loop), and relative paths
  inside the kit.
- The kit never draws: no drawing call in any non-test file (`tests/architecture/no-drawing.test.ts`).
- Tests may also use `@engine/backends/null`.
- Never other backends, `engine/sim`, `engine/tools`, other kits or games.
- No `Math.random`, wall-clock time or DOM globals (lint-enforced). No content outside tiny test
  fixtures.

## How to test

`*.test.ts` next to the code (`topdown.test.ts`, `town-kit.test.ts`, `items.test.ts`,
`beam.test.ts`, `schema.test.ts`, `snapshot.test.ts`, `rules.test.ts`, `present.test.ts`, `present-entities.test.ts`, `challenge.test.ts`) run in Node with `pnpm test`, driving the world with `ScriptedInput` and a fixed
seed. `tests/kits/mission-adapter.test.ts` plays an `engine/sim` mission (the siege fixture's
`raid`) through `roomChallenge` with the core's `playMissionRound`, outside every layer, since the
kit never imports the sim.
