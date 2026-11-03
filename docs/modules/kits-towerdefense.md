# kits/towerdefense

Folder: `kits/towerdefense`. Detailed rules: [`kits/towerdefense/CLAUDE.md`](../../kits/towerdefense/CLAUDE.md).

## Purpose

The tower-defense kit (Engine 0.12, the platform test: a new genre with no change to `engine/sim`).
It reads three content kinds, `td-map` (a JSON header plus a `.map.txt` grid: one path from an
entry to an exit, build cells and blocked ground; the starting gold and lives, the tower types and
the wave list), `td-towers` (cost, range, damage, cooldown, sell value) and `td-waves` (waves of
enemy groups with spacing, hp, speed and bounty, and an optional timer), and plays a round headless
and deterministically: towers placed on free build cells and paid for, sold for a refund, waves
started by a button or the timer, enemies walking the path in whole sub-cell units, towers firing
at the enemy furthest along within range on their cooldowns, bounties on kills, a life lost on a
leak, and the round won when every wave is cleared or lost at 0 lives. Every rule is named, so a
run can switch it off. Over a world (Engine 0.12 T6) it plays a mission as the `td-defence` mini
game, configured only by the mission's params: walls from the world on the build cells, the gold
from a faction's stockpile, the wave from the world's units, and ordered rules from the round's
report to a declared outcome. It holds no world rules, never draws and never imports the sim.

## Public API entry points

`index.ts`, imported as `@kits/towerdefense`: `map` (`LEGEND`, `cellKinds`, `tracePath`),
`schema` (`tdMapSchema`, `tdTowersSchema`, `tdWavesSchema`, the `td-map`, `td-towers` and
`td-waves` kinds, `towerTable`, `CELL_SUB`), `rules` (`TOWERDEFENSE_RULES`) and `world`
(`TdWorld` with `command`/`place`/`sell`/`startWave`, `step()`, `placeRefusal`, `targetOf` and
`snapshot()`; `TdEvent`, `TdSnapshot`), `present` (`presentWorld`, `describeWorld`, `tdFrames`,
`TdPresentState`, `presentStatus`, `TD_EVENT_TYPES`: frames with the map, towers, enemies, shots,
the cursor and a placement ghost tagged `ok` or `blocked`, the HUD and `td-*` events for skin
sounds), `controls` (`TdControls`: the shared actions as a cursor, place, cycle, sell and start
wave, and pointer taps through the frame's camera, `cellAtScreen`, and its inverse
`screenAtCell`, Engine 0.15 gap D13), `game` (`tdGame`, a `HeadlessGame` stepped with frame input,
taps included since Engine 0.15 (gap D1: `InputFrame.taps` in game screen pixels of its `size`),
whose snapshot is `{ round, controls, kit }`; `tdRound`
reads a round from a game's content), `bot` (`TdBot`, a deterministic player for tests) and
`mission-defence` (`tdDefence`, the `td-defence` `MiniGameDef` with `paramsSchema`, `checkUse`
and a `report()` of towers by type, gold spent, leaks, raiders killed and walls lost by world
name; `towerdefenseMissionAdapter`, the stateless `MissionAdapter` for `MissionHost`; from
Engine 0.13 its wall and wave selectors never pick someone captured or dead, by their `Fate`, and an
injured raider comes at its current hp).
`kit.ts` exports `kit`, the hook the tools find by the
name `towerdefense` (from Engine 0.14 T9 with `roundBots()`: `TdBot` for a `td-defence` round, for
`pnpm cli record --bot`); it opts in to strict mutant checks (since Engine 0.12 T4, when the run files of
`games/samples/tower-defense` came to guard every rule).

## Imports allowed

- `@engine/core/*` except its drawing and output side (`FORBIDDEN_CORE` in `config/layers.js`),
  and relative paths inside the kit. Tests may also use `@engine/backends/null`.
- Never `engine/sim`, backends, `engine/tools`, other kits or games.
- No `Math.random`, wall-clock time or DOM globals (lint-enforced). No drawing calls. No content
  outside tiny test fixtures.

## How to test

`pnpm test kits/towerdefense` runs the round and content tests in Node (placement and payment,
waves, targeting, kills, leaks, the end of the round, each rule switched off, the same hashes from
the same seed), the presentation tests (schema-valid frozen frames, events), the controls tests
(actions and taps), the headless game tests (a bot's round giving the same hashes twice) and the
`td-defence` tests over a hand-written snapshot; `tests/kits/td-mission.test.ts` plays the mission
over a real sim world (played, delegated, quit, live through `MissionHost`, golden hashes), and
`tests/kits/hero-mission.test.ts` a wave over a world with a dead and a captured raider. `pnpm cli validate kits/towerdefense/__fixtures__/game` checks the fixture game;
`tests/kits/towerdefense-validate.test.ts` also checks that the broken fixture is rejected by file
and field. `pnpm -s cli mutants games/samples/tower-defense` (exit 0) checks that the sample's run
files guard every kit rule.
