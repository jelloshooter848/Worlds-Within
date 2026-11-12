# kits/towerdefense

Folder: `kits/towerdefense`. Detailed rules: [`kits/towerdefense/CLAUDE.md`](../../kits/towerdefense/CLAUDE.md).

## Purpose

The tower-defense kit (Engine 0.12, the platform test: a new genre with no change to `engine/sim`).
It reads three content kinds, `td-map` (a JSON header plus a `.map.txt` grid: one path from an
entry to an exit, build cells and blocked ground; the starting gold and lives, the tower types and
the wave list, and from Engine 0.16 E4 an optional star rating), `td-towers` (cost, range, damage,
cooldown, sell value and, from Engine 0.16 E3, upgrade `levels`, from E4 `splash` and `slow`) and `td-waves` (waves of
enemy groups with spacing, hp, speed and bounty, and an optional timer), and plays a round headless
and deterministically: towers placed on free build cells and paid for, upgraded a level at a time for gold, sold for a
refund that counts the upgrades, waves
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
(`TdWorld` with `command`/`place`/`sell`/`upgrade`/`startWave`, `step()`, `placeRefusal`,
`upgradeRefusal`, `statsOf`, `targetOf`, `speedOf`, `stars`, `nextWave` and `snapshot()`; `TdEvent`, `TdSnapshot`, `towerStats`,
`sellValue`, `upgradeCost`, `maxLevel`), `present` (`presentWorld`, `describeWorld`, `tdFrames`,
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

- Engine 0.16 E4 (splash and slow towers, the wave preview, health-bar and range data, stars): a
  `td-towers` type's (or level's) optional `splash` (`{ radius, damage }`: the other enemies
  within `radius` cells of the target's cell take `damage`, in id order) and `slow`
  (`{ factor, ticks }`: a target hit and not killed walks at `factor` percent of its speed for
  `ticks` ticks; the lower factor wins), the rules `splash-damage` and `slow-enemies`, the events
  `splash` and `slowed` (presented as `td-splash` and `td-slow`; `td-shot` gains `splash`, the
  hits), an enemy's `slow`/`slowFactor` in the snapshot only while slowed, a `td-map`'s optional
  `stars` (`{ three, two }`, lives left at least; `bad_stars`) read by `TdWorld.stars()`,
  `kit.stars` and the status `stars` only on a map with a rating, `TdWorld.nextWave()` and the
  status `nextWaveKinds`/`nextWaveGroups`, enemy tags `maxhp:<n>` and `slow`, ghost tags
  `range:<cells>`. No existing hash moved; the sample's cannon gained a splash (level 2) and a
  slow (level 3), guarded by `runs/shells.run.json`.
- Engine 0.16 E7 (presentation only, no hash moved): with the cursor on a tower the ghost is
  tagged `selected` and carries that tower's `range:` now (not the chosen type's), so a skin
  rings the selected tower.
- Engine 0.16 E3 (tower upgrades): a `td-towers` type's optional `levels` (`{ cost, range?,
damage?, cooldown?, sell? }`, level 2 on, each over the level below), the `upgrade` command
  (refusals `no_tower`, `max_level`, `too_poor`, `round_over`), a tower's `level` in the snapshot
  only once above 1 (so no earlier hash moved), the rules `upgrade-costs-gold` and
  `upgrade-improves`, `jump` or a second tap on a selected tower to upgrade (`TD_UPGRADE_CONTROL`
  in `TD_CONTROLS`), tower tags `level:<n>` and `range:<cells>`, the status `selected`,
  `upgradeCost` and `sellValue`, the event `td-upgrade` and the bot step `upgrade`. A `td-defence`
  round plays without levels unless its params say `upgrades: true`.
- Engine 0.15 T7 (lessons D6, D7, D8, D10): the adapter takes the world's key table (`keys`
  selectors, `build.cells` and `killed` may name any keyed entity), `build.cells` puts a named wall
  on a named build cell, `checkUse` checks the selectors against the world scenarios that offer
  the mission, and a `td-map`'s `waves` is optional for a map only `td-defence` missions play
  (`no_waves` for one no mission names; `tdRound` refuses it).

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
files guard every kit rule (the upgrade rules by `runs/upgrade.run.json`);
`tests/runs/td-classic-mutants.test.ts` lists the rules the frozen classic road cannot reach.
