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
`facingOfDir`; from Engine 0.13 the captured and the dead are never units of the view, by their
`Fate`, and `view.named` lists every named person with their fate and hp, `RtsNamedView`), `sides` (`sidesOf`, `SideSummary`: every side at a glance), `selection`
(`Selection`), `commands` (`commandAt`, `buildCommand`,
`trainCommand`, `stopCommand`, `trainButtons`, `OrderDraft`, `stampOrder`; missions:
`missionRequest`, `missionButtons`, `launchMission`, `MissionLauncher`), `enemy`
(`enemyPlanSchema`, `ScriptedEnemy`, `conditionHolds`), `knowledge` (`RtsKnowledge`), `end`
(`rtsEndSchema`, `matchResult`), `names` (Engine 0.16 polish Q, D2: `rtsNamesSchema`, the
`rts-names` kind, a game's display names by unit type and building kind; `unitName`,
`buildingName`, each falling back to the id), `decor` (Engine 0.16 polish Q, Q5:
`rtsDecorSchema`, the `rts-decor` kind, a map's presentation-only decoration grid, usually
`maps/<id>.decor.txt` beside `maps/<id>.world.json`, one `RTS_DECOR` character per terrain cell:
trees, pines, stumps, bushes, rocks, boulders, pebbles, flowers, mushrooms, grass tufts, dirt,
darker and lighter grass and bank reeds, `.` for nothing; `unknown_char`, `ragged_row`, and
across files `size_mismatch` against its map and `missing_ref` with no map of its name;
`presentWorld`'s `decor` option adds it as the map layer `decor`, which both 2D backends draw over
the terrain and under the entities and fog, through the skin's `tiles`; never in the world, so no
hash moves), `present` (`presentWorld`, `RtsPresentState`, `RTS_DEPTH`;
from Engine 0.16 F7 the status also names the one selected thing, `selectedName`, `selectedType`,
`selectedRole`, gives each scenario key's health, progress, fate and life, `keyStatus`:
`key.<key>.hp`, `.maxHp`, `.progress`, `.fate`, `.name`, `.alive`, and how near the enemy is to
the player's buildings, `threatStatus`: `enemyNear`, for a 3D page's HUD objectives and music;
from polish Q, D2, with the `names` option `selectedName` is the display name and `trainingName`
the training unit's, presentation only, and without it the status is as before),
`controls` (`RtsControls`: pointer gestures through `RtsCamera` into selection and orders; from
Engine 0.16 F2 through a ground-view `RtsCamera` too, a box then selecting what is drawn inside
the picture rectangle, `Selection.boxWhere`),
`game` (`rtsGame`, `RtsGame`, a `HeadlessGame` with `order`, `issue`, `recorded`, `log` and
`refresh`;
`RtsWorldPort`, filled by `engine/sim`'s `rtsWorldPort(world)`; and from Engine 0.15 T6, gap M18,
`rtsMissionHooks(game)`, the `canOpen` (`not_offered`) and `onChange` (`refresh()`) a
`MissionHost` over the game takes, so no glue wraps the two), `rules` (`RTS_RULES`) and `schema` (the `rts-map`, `rts-types`, `rts-enemy` and (Engine 0.16 part D)
`rts-end` content kinds, and from polish Q `rts-names` and `rts-decor`; from Engine 0.15 T15 `rtsScenario(map, types, seed)`: the map with the types table spawned first, the
scenario a game builds its world from). `kit.ts` exports `kit`, the hook the tools find by the name `rts`.

- Engine 0.15 T7 (gap M25): `RtsMissionInfo.marker` may be a scenario key (a mission file's
  `marker`), resolved through `presentWorld`'s `keys` option; `rtsMissionInfo(def)`.
- Engine 0.15 T14: `events` (`RtsEventTracker(faction, tileSize?)`, `rtsEvents(before, after,
faction)`): what changed between two views as presentation events, each with its `side`
  (`own`, `enemy`, `neutral`) for a skin's `type:side=own` keys: `unit-ready`, `unit-down`,
  `unit-hit`, `site-placed`, `building-done`, `building-down`, `building-hit`, `stock-up`. The
  world snapshot carries no events, so this is how a game on the kit gets battle sounds (the RTS
  skirmish passes them to `presentWorld`'s `events`). It reads views only: no world rule.

- Engine 0.16 F6: `presentWorld`'s `mapId` option names the map (default `RTS_MAP_ID`, `rts`),
  so a 3D skin's per-map `decor` and `places` dress each scenario; a unit or building whose
  health bar shows also carries `hp:<hp>/<max>`, the numbers a 3D skin's bar label reads.

- Engine 0.16 part D (D5): `fog` (`visibility(view, faction)`, `fogView`, `RtsFogMemory`,
  `unitSight`, `buildingSight`): fog of war as presentation and AI knowledge only (a building
  type's optional `sight` in `engine/core/rts-types.ts`, no default, so no hash moves);
  `presentWorld`'s `fog: true` fills the frame's `fog`, hides other sides' units out of sight and
  shows other buildings and nodes as last seen (`last-seen`), the memory in `RtsPresentState`.
  `feedback` (`orderMarker`, `RtsOrderFeedback`) and `barkEvent` (`events`): `RtsControls.feedback`
  gives an accepted order's marker and `bark`, which `RtsPresentState.accept` carries into frames
  (`order-marker`, fading); a selected own unit shows `path-dot`s from its task's `goal`/`path`
  (new optional `RtsUnitView` fields with `sight`); an own building training shows a `train`
  `progress-bar` tagged with its queue count (`queue:<n>`). `tests/runs/rts-fog.test.ts` proves the same hashes with fog
  on and off over every rts-classic and rts-skirmish run.

- Engine 0.16 part D (D6): the scripted enemy as a skirmish opponent, all optional so older plans
  give the same orders and kit snapshot: `knowledge: "fog"` (targets and enemy-side conditions read
  only what its side sees and the buildings it remembers, `RtsKnowledge` in `knowledge.ts`; rule
  `enemy-knows-only-what-it-saw`; the memory in the kit snapshot as `seen` only for a plan that
  keeps one), a `scout` order, attack targets `enemy-base` and `last-seen-building`, a selector's
  `min` (waves), `build` at the first free of `cells`, `train` `upTo` a count, and
  `conditionHolds`. `end` (`rtsEndSchema`, `matchResult(view, end, knowledge?)`, the `rts-end`
  content kind): a game's win and loss as data, `won` and `lost` in the plan's conditions.

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
frozen presentation over the siege fixture with a `MissionHost`; `tests/kits/rts-ai.test.ts` plays
the fog opponent over a small sim field (it builds a barracks, scouts, attacks in a wave and the
end rule decides the match).
