# kits/rts

Folder: `kits/rts`. Detailed rules: [`kits/rts/CLAUDE.md`](../../kits/rts/CLAUDE.md).

## Purpose

The real-time strategy kit (Engine 0.9). It holds no world rules: movement, combat and the
economy are `engine/sim` systems. The kit reads a plain world snapshot (`readWorld`), turns the
player's selection (click, box, heroes alone) and commands (move, attack, gather, build, train,
stop) into orders as plain data (`engine/core/orders.ts`), runs a scripted enemy written as data
(orders at ticks or on triggers, seeded RNG) that also only issues orders, and describes each frame
(`presentWorld`: terrain map, units with eight-way facing and animation states, buildings with
construction progress, selection rings and box, a placing ghost, HUD values, the RTS camera hint).
Since Engine 0.11 it also reads the world's offered opportunities, open missions and frozen
events, turns the player's click on an offered mission into a launch request that the game's
`MissionHost` carries out (a refusal is a result, never thrown), and presents frozen units
(`frozen`), an offered-mission marker over its target and the open mission's HUD values.
It never draws and never imports the sim: a game's glue fills its `RtsWorldPort` with a sim world.

## Public API entry points

`index.ts`, imported as `@kits/rts`: `snapshot` (`readWorld`, `RtsView`, `thingAt`,
`facingOfDir`), `sides` (`sidesOf`, `SideSummary`: every side at a glance), `selection`
(`Selection`), `commands` (`commandAt`, `buildCommand`,
`trainCommand`, `stopCommand`, `trainButtons`, `OrderDraft`, `stampOrder`; missions:
`missionRequest`, `missionButtons`, `launchMission`, `MissionLauncher`), `enemy`
(`enemyPlanSchema`, `ScriptedEnemy`), `present` (`presentWorld`, `RtsPresentState`, `RTS_DEPTH`),
`controls` (`RtsControls`: pointer gestures through `RtsCamera` into selection and orders),
`game` (`rtsGame`, `RtsGame`, a `HeadlessGame` with `order`, `issue`, `recorded`, `log` and
`refresh`;
`RtsWorldPort`), `rules` (`RTS_RULES`) and `schema` (the `rts-map`, `rts-types` and `rts-enemy`
content kinds). `kit.ts` exports `kit`, the hook the tools find by the name `rts`.

## Imports allowed

- `@engine/core/*` except its drawing and output side (`FORBIDDEN_CORE` in `config/layers.js`),
  and relative paths inside the kit. Tests may also use `@engine/backends/null`.
- Never `engine/sim`, other backends, `engine/tools`, other kits or games.
- No `Math.random`, wall-clock time or DOM globals (lint-enforced). No drawing calls. No content
  outside tiny test fixtures.

## How to test

`pnpm test kits/rts` runs the kit's tests in Node on the tiny snapshot fixture
(`__fixtures__/world.ts`); `pnpm test tests/kits` drives the kit over a real `engine/sim` battle
world and replays it from the recorded player orders, and drives its mission offers, launch and
frozen presentation over the siege fixture with a `MissionHost`.
