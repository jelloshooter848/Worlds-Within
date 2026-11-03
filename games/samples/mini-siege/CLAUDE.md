# games/samples/mini-siege

The mini siege (Engine 0.11, `docs/ROADMAP.md`, "0.11 The mini siege (multi-genre sample)"): an
RTS map with a village under attack and a watchtower going up, and one top-down mission,
**sabotaging the raiders' siege engines** (owner answer 23), that the player can play or delegate.
It joins the world simulation (`engine/sim`), the RTS kit (`kits/rts`), the top-down kit
(`kits/topdown`, its data-driven `mission-room`) and the mission contract (`engine/core`'s
`MissionHost`). The shape is decision 11 and the checks decision 12 of `docs/BUILD-LOG.md`,
Engine 0.11. Since T8 it plays headless (`pnpm cli run`); the art, music, skins and the page are
T9. Every gap found is logged in `docs/reports/mini-siege.md` (ids `M1`, `M2`, ...).

## The rule

Content, skins and thin glue only (DESIGN.md: if two games could use it, it is engine; if it is
content, it is the game). The battle is the sim's, the raiders' plan and the mission are data, the
round and the mapping from its report to an outcome are the top-down kit's (`missionRoom`,
`topdownMissionAdapter`), the hosting is `MissionHost`. Never put map rows, stats, plan steps,
room rows, outcome rules or pixel rows in `.ts` files (`tests/architecture/no-content.test.ts`).
Anything the glue would write the same way in another game goes to the engine or a kit, or into
the gap report with a named release.

## Files

- `game.json`: kit `rts`, `uses` `topdown` (the mission's room), seed 11, 256x240,
  `headless.ts`; content kinds `rts-map`, `rts-types`, `rts-enemy`, `mission`, `room`. No `view`
  yet (T9), so the backend parity test skips it.
- `content/maps/village.world.json` (`rts-map`): 48x32 cells of 16 px: grass (`.`), a road (`,`)
  down rows 15-16 from the village to the raiders' camp, a few rocks (`#`). Terrain types in
  sorted character order: 0 rock, 1 road, 2 grass. The village (faction `village`) on the west:
  the `hall` (3x3 at 6,13, the stockpile, 150 gold), two gold nodes, the `watchtower` site (2x2
  at 2,13, 480 work, outside the event) and three workers building it (2 work a tick each: done
  80 ticks in, during the freeze); four soldiers (13,14-17) and, in the squad `defenders`, the
  `captain` (Captain Hale, role `captain`, 12,15). The raiders on the east: four raiders, the
  `ram` (36,15) and the `catapult` (36,17), and the squad `escort` with the guards `guard-1` and
  `guard-2` (role `regular`). Every defender and attacker is an `EventMember` of `siege`; the
  workers are not. One opportunity, `sabotage-window`, offers `sabotage` from tick 20 to 200.
- `content/types/siege.json` (`rts-types`): `worker`, `soldier` (50 hp, hits 6), `captain`
  (120 hp, hits 10), `raider` (30 hp, hits 4), `ram` (120 hp, hits 12, slow), `catapult` (100 hp,
  hits 10 at range 3, slow); `hall` (400 hp) and `watchtower` (200 hp, 480 work). Every unit in
  the map carries its type's numbers (`mini-siege.test.ts` checks it).
- `content/enemy/raiders.json` (`rts-enemy`): every 20 ticks from tick 0, `batter` (the ram) and
  `bombard` (the catapult) attack the nearest building, `charge` (the raiders) the nearest
  village unit.
- `content/missions/sabotage.mission.json` (`mission`): "Burn the siege engines", event
  `siege`, `worldTimeCost` 120, `play` `mission-room`, `onQuit` `driven-off`. Outcomes (weight,
  effects): `both-burnt` (1: destroy `ram` and `catapult`), `ram-burnt` (2: destroy `ram`,
  damage `catapult` 40), `catapult-burnt` (1: destroy `catapult`, damage `ram` 40),
  `driven-off` (2: damage `captain` 30). Its `params` (checked by `validate` through the kit's
  schema and `checkUse`): room `engine-camp`, goal `defeat-all`, 1500 ticks, 6 half hearts; the
  engines (raiders of type `ram` or `catapult`) as knights in the `E` cells with one room hp per
  40 world hp, the guards (raiders with squad role `regular`) as knights in the `n` cells; rules
  in order: both destroyed, the ram, the catapult, else driven off.
- `content/rooms/engine-camp.json` + `.map.txt` (`room`): the raiders' camp at night, one 16x11
  room with the hero's `@`, two `E` and two `n` slots.
- TypeScript is glue:
  - `content.ts`: `loadMiniSiege(files)`, `siegeMap`, `siegeTypes`, `siegeEnemy`,
    `siegeMissions`, `siegeRooms`, `siegeScenario(content, seed)` (the types table spawned first,
    entity 2), `PLAYER` (`village`).
  - `headless.ts`: `createWorld`, `miniGames(content)` (the kit's `missionRoom` over the rooms;
    `validate` checks the mission's params with it), `createGame(content, seed, opts?)`: the
    sim world, the kit's `rtsGame` (the plan, the switched-off rules), and a `MissionHost` with
    `missionPort(world, { refs: scenarioKeys })`, the missions and `{ 'mission-room':
topdownMissionAdapter }`, wrapped in `MiniSiegeGame`. Its `mission(step)` sends `open`
    through the kit's `launchMission` (refused `not_offered` while no opportunity offers it) and
    the rest to the host, then calls `RtsGame.refresh()` (gap M7); `order`, `step`,
    `miniGame()` and `missionExperience()` are the host's. Its snapshot is the host's (`{ world,
kit, missions? }`) plus `sides` (the kit's `sidesOf`) and `named` (every scenario key:
    `{ alive, x, y, hp }`).
- `mini-siege.test.ts`: the content, the units against their types, the params checks
  (`bad_mini_game_use` at `params.room` and `params.outcomes.0.outcome`), the launch refusals,
  orders refused while the round is hosted, and over whole runs: the battle frozen at every
  world tick of the cost and the same in all three runs before the commit, the commit at 160
  whatever the round took, the hall at the end (400 played, less delegated, least driven off),
  the played world equal to a fresh one given the same result at the open tick (decision 3), and
  the same hashes twice.

## Entity ids

1 terrain, 2 types, 3 hall, 4-5 gold (north, south), 6 watchtower, 7-9 workers, 10-13 soldiers,
14-17 raiders, 18 ram, 19 catapult, 20 squad `defenders`, 21 the captain, 22 squad `escort`, 23-24
the guards, 25 the world-level entity (`WorldTime`, `Opportunities`, `Missions`).

## Run files

All with seed 11, the mission opened at tick 40 (the opportunity is offered from 20), committed at
world tick 160 (40 + 120), and checked until world tick 260.

| run         | ticks | what happens                                                                                                                                           | final hash         |
| ----------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `played`    | 666   | played: a recorded 406-tick round (the kit's bot fighting) burns both engines (`both-burnt`); the world resumes at game tick 446; the hall ends at 400 | `25d3a40b93c9b076` |
| `delegated` | 260   | delegated at once: seed 11 draws `ram-burnt`; the catapult (60 hp) reaches the hall, which ends at 280                                                 | `0576a976323b2882` |
| `quit`      | 261   | played and quit on the round's first tick (select): `driven-off`, the captain down 30; both engines reach the hall, which ends at 112                  | `28863925b7cb91d1` |

- Game ticks are not world ticks once a round is played: during the round the world does not
  move, so in `played` world tick `w` after 40 is game tick `w + 406` (`quit`: `w + 1`).
- Each asserts (at the game tick of each world tick): the plan's first orders at tick 1; the
  mission open with commit tick 160 and `siege` frozen; the ram, catapult, a raider, the captain
  and a soldier keeping their cell and hp at world ticks 41, 80, 120 and 159; the watchtower's hp
  rising by world tick 60 and the site finished (`sides.village.sites` 0,
  `sides.village.buildings.watchtower` 1) by 159; at 160 the record (`outcome`, `resolution`
  `played` / `delegated` / `quit`, `openTick` 40, `commitTick` 160), nothing frozen and that
  outcome's effects (`named.ram.alive`, `named.catapult.hp`, `named.captain.hp`; the played
  record's `report.stats.destroyed`); and the hall's hp at 260. `played` also checks the round in
  the snapshot (`missions.round`: its ticks, `pass`, `both-burnt`) and the world tick standing
  still through it.
- Paths: `named.<key>.*`, `sides.<faction>.*`, `kit.enemy.<step>.fired`,
  `world.components.Missions.0.1.(open|committed).<i>.*` and
  `world.components.WorldTime.0.1.frozen` (one world-level entity, so index 0).
- Every run file has sync `hashes` (every 20 ticks) and a golden `<name>.hashes.json`; each
  guards `enemy-follows-plan` (`pnpm -s cli mutants games/samples/mini-siege --json`).
- **Recording the played round:** in a throwaway script, `createGame`, step to tick 40, `open`
  and `play` without input, then each tick give the host a `ScriptedInput` holding what
  `TopDownBot({ 'engine-camp': [{ do: 'fight' }] })` holds for the round's world
  (`(game.miniGame() as RoomChallenge).world`), recording each change as `{ frame, hold }` (frame
  0 the round's first tick), until `miniGame()` is null; that list is the `play` step's `input`.
  Changing the map, the types, the room or the mission's params changes the round: re-record,
  read the new values off `dump`, copy the hashes in and run `WW_UPDATE_GOLDEN=1 pnpm test
tests/runs`.

## How to test

`pnpm test games/samples/mini-siege`, `pnpm -s cli validate games/samples/mini-siege --json`,
`pnpm -s cli run games/samples/mini-siege/runs/played.run.json --json` (any run file),
`pnpm -s cli dump games/samples/mini-siege/runs/played.run.json --tick 566 --json` (the commit),
`pnpm -s cli mutants games/samples/mini-siege --json`, `pnpm test tests/runs` (golden hashes).

## Imports

- Allowed: relative paths inside this folder, `@engine/core/*`, `@engine/sim/*` (the glue
  builds the world and its mission port), `@engine/backends/*`, `@kits/rts` and `@kits/topdown`.
- Never: other games or kits it does not use. Nothing in `engine/` or `kits/` imports from here.
