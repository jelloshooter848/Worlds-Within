# kits/rts

The RTS kit (Engine 0.9): the player's side of a real-time strategy game over an `engine/sim`
world. It holds **no world rules**: movement, combat, construction, training and gathering are
`engine/sim` systems driven by component data (docs/BUILD-LOG.md, Engine 0.9, decision 2, items
122-123). The kit reads a plain world snapshot, turns the player's selection and commands into
orders (`engine/core/orders.ts`), runs a scripted enemy that also only issues orders, and
presents frames. `index.ts` re-exports the public surface; games import it as `@kits/rts`.

- `snapshot.ts`: `readWorld(json)` reads `World.snapshot()` (`{ tick, components: { <Name>:
[[id, data]] } }`) into an `RtsView` (`tick`, `terrain`, `units`, `buildings`, `resources`,
  `stock` by faction, `types`: the world's `RtsTypes` or null, `missions`), with its own loose Zod schemas
  for the components it reads (extra fields allowed), and no `engine/sim` import. A bad snapshot
  throws naming the field. Since Engine 0.11 (decision 4, item 175) it also reads the mission
  state when the snapshot has it (all optional, so a 0.9 or 0.10 snapshot reads as before):
  `view.missions` is `{ offered: [{ opportunity, mission, closes }], open: [{ id, title, event,
openTick, commitTick, resolved }], committed: [id], gated: [mission ids some opportunity names],
frozen: [event ids] }` (from `Opportunities`, `Missions` and `WorldTime.frozen`, lists sorted by
  id), and each unit and building has `event` (`EventMember.event` or null) and `frozen` (its
  event is frozen). Helpers: `isFinished(building)`, `DIR_FACINGS` / `facingOfDir(dir)`
  (`Facing8.dir` 0 north ... 7 north-west to the eight presentation facings) and
  `thingAt(view, x, y, faction?)` (a unit, own first then lowest id; else a building whose
  footprint covers the cell; else a resource node).
- `selection.ts`: `Selection(faction, rules?)`: ids kept ascending. `click(view, point, tileSize,
additive?)` selects one thing (own unit first, else any unit, else a building; empty ground
  clears); a hero is selected alone like any unit (item 121). `box(view, worldBox, tileSize,
additive?)` selects the own units whose cell centres are inside (rule `box-selects-own-units`),
  never buildings. `heroes(view)` selects the faction's heroes. `prune(view)` drops the gone.
  Points and boxes are world pixels (`cellOf(p, tileSize)`).
- `commands.ts`: the command mapper. `OrderDraft` is an order without its `id`; `stampOrder(draft,
id)` adds it. `commandAt(view, selection, point, tileSize, rules?)`: on an enemy unit or
  building `attack` (rule `command-attacks-enemies`), on a resource node the selected gatherers
  `gather` (rule `command-gathers-resources`; with none, `move`), else `move` to the cell.
  `buildCommand` (selected builders, units with `Worker`), `trainCommand` (selected finished own
  buildings whose `trains` lists the unit), `stopCommand`, `trainButtons`. Each returns null when
  nothing selected can take it. Whether an order can be carried out is the sim's answer.
  **The launch command** (Engine 0.11): `missionRequest(view, id)` gives a `MissionRequest {
mission, opportunity }` through the opportunity offered now, `{ mission, opportunity: null }`
  for a mission no opportunity names, or null when its opportunities are none of them offered;
  `missionButtons(view)` lists the offered missions; `launchMission(view, id, launcher)` carries
  the request out through a `MissionLauncher { launch(id) }` (the game's `MissionHost` from
  `engine/core/mission-host.ts`) and returns a `LaunchResult`: `{ ok: true, request }`, or `{ ok:
false, request, code, error }` with `not_offered` (the kit's, without asking the launcher) or
  the host's or sim's code (`unknown_mission`, `mission_open`, `round_hosted`, ...). A request is
  not an order and the kit opens nothing; a refusal is a result, never thrown.
- `enemy.ts`: the scripted enemy. `enemyPlanSchema` (the `rts-enemy` kind): `{ faction, steps:
[{ id, at?, when?, repeat?: { every, times }, order }] }`; orders `move` (`cell` or `area`,
  drawn with the RNG), `attack` (`nearest-enemy`, `nearest-building`, `random-enemy`), `stop`,
  `gather` (`resource`: the nearest node), `build` (`building`, `cell`), `train` (`building`,
  `unit`, `queueMax`), each with a unit selector `{ type?, idle?, heroes?, max? }`; conditions
  `{ count: units | buildings, side: self | enemy, type?, op: gte | lte, value }` or
  `{ count: stock, item, op, value }`. `ScriptedEnemy(plan, rng, rules?)`: `think(view)` gives
  the tick's orders (steps in file order; a step fires at or after `at`, once its `when` holds,
  rule `enemy-waits-for-trigger`, and when its order can be made, else it waits), the whole plan
  off with rule `enemy-follows-plan`; `snapshot()` is each step's `{ fired, last }`. All
  randomness through the `Rng` it is given; nearest picks by squared distance, ties to the lowest id.
- `present.ts`: `presentWorld(view, { faction, size, tileSize?, selection?, box?, placing?,
camera?, missions?, events?, state? })`, below. `RtsPresentState` (map tracker, animation starts),
  `RTS_DEPTH`, `RTS_TILE_SIZE` (16), `presentMap`, `presentStatus`, `missionStatus`,
  `offerTarget`, `unitAnim`. `missions` is the game's `RtsMissionInfo` list (`{ id, title,
event?, marker? }`; a `MissionDef` fits).
- `controls.ts`: `RtsControls(faction, camera, tileSize, rules?)`, the pointer glue a page uses:
  `gesture(g, view, additive?)` takes `PointerGesture`s (`engine/core/input/pointer-logic.ts`):
  pan and zoom move the `RtsCamera`, a primary tap selects (or places the building being placed),
  a box drag selects on `end` (shown while `move`), a secondary tap commands (or cancels placing);
  it returns an `OrderDraft` or null. `startPlacing(kind)`, `cancelPlacing()`, `hover(point)`
  (the ghost's cell), `train`, `stop`, `selectHeroes`, `launchMission(view, id, launcher)` (the
  bar's mission button, `launchMission` above), `placing(view)` (sized from the world's
  types) and `presentOptions(view)` (`selection`, `box`, `placing`, `camera` for `presentWorld`).
- `game.ts`: the headless adapter. `RtsWorldPort { snapshot(), applyOrder(order), step() }` is
  what the game's glue fills with an `engine/sim` world (the kit never imports the sim).
  `rtsGame({ world, enemy?, seed, disabledRules? })` gives an `RtsGame`, a `HeadlessGame`:
  `order(json)` (a recorded order, applied at once), `issue(draft)` (the player's command, stamped
  with the next id), `step()` (the enemy thinks and its orders are applied, then the world
  steps), `snapshot()` `{ world, kit: { nextOrder, rng, enemy } }`, `view()`, `tick`,
  `nextOrderId`, `recorded()` (the player's orders as `{ tick, ...order }`, refused ones too,
  ready for a run file's `orders`) and `log()` (every order of both sides with tick, source and
  refusal). Ids count up across both sides in the order applied; a recorded order keeps its id
  and moves the counter past it, so replaying the player's orders gives the enemy the same ids.
  The view is cached until the next order or step: after a `MissionHost` launch (or any change
  made outside the port between steps) the glue calls `refresh()` before reading `view()` again.
- `schema.ts`: the content kinds (below). `rules.ts`: `RTS_RULES`. `kit.ts`: the hook.

## Kit hook (`kit.ts`)

`kit` (`defineKit`): name `rts`, kinds `rts-map`, `rts-types`, `rts-enemy`, rules `RTS_RULES`, no
strict mutants. `engine/tools` finds it through the generated `engine/tools/kit-list.ts` (`pnpm
docs:gen` after changing it). `index.ts` does not re-export it.

## Content kinds (`schema.ts`)

- `rts-map`: the map, a world scenario (`*.world.json`, the `engine/sim` format) with
  `"systems": "rts"`. The kit checks the shape and the grids (rows of legend characters, elevation
  digits of the same size); components are `z.json()` here and are checked by the sim when the
  glue builds the world (`worldFromScenario`).
- `rts-types`: `rtsTypesSchema` from `engine/core/rts-types.ts`, for a game that keeps its unit
  and building types in their own file.
- `rts-enemy`: `enemyPlanSchema`. `checkAll` reports a unit or building type a plan names that no
  `rts-types` file or map `RtsTypes` has, as `unknown_type` at the field (only when the game has
  types to check against).
- Examples in `docs/reference/examples/` (`rts-map.json`, `rts-types.json`, `rts-enemy.json`);
  every field has a `.describe(...)`. After a schema change: `pnpm docs:gen`.

## Presentation frames (`present.ts`)

`presentWorld` only reads the view; positions are world pixels (cell x, y is the box `x *
tileSize, y * tileSize`). Without `state` the full map goes in every frame and `anim.t` is the tick.

- **Map**: `id` `rts`, the terrain as a grid of type indexes, `tags` `type:<i>:<name>` (plus
  `:blocked` when impassable), `version` a 32-bit hash of the cells and type names.
- **Entities** (`layer` from `RTS_DEPTH`): `resource-<id>` (`resource:<item>`, `idle` or
  `empty`, tag `amount:<n>`, 5); `building-<id>` (`building:<kind>`, `site` while under
  construction, `train` while it has a queue, else `idle`; tags `own`/`enemy`/`neutral`,
  `faction:<f>`, `site`, `progress:<0-100>`, `training:<unit>`, `selected`, `frozen`; 8);
  `<id>/ring` (`selection-ring` for each selected unit or building, tags its side and `hero` or
  `building`; 9); `unit-<id>` (`unit:<type>`, facing from `Facing8` in eight directions, `down`
  before any move; `anim.state` `walk` (stepping with a task, or on a move), `attack` (has a target), `build`,
  `gather`, `idle`; tags side, `faction:<f>`, `hero`/`captain`, `carrying`, `selected`, `frozen`
  (a member of a frozen event: the battle is held while a mission is open); 10);
  `<id>/hp` (`health-bar`, `hp-0`..`hp-8` eighths, for the hurt and the selected; 20) and
  `building-<id>/progress` (`progress-bar`, `p-0`..`p-8`, for a site, frozen or not: the sim
  keeps building it; 20); `offer-<opportunity>` (`mission-offer`, `idle`, tags `mission:<id>`,
  `opportunity:<id>`, `target:<entity>`, over its target's box: the mission info's `marker`
  entity, else the lowest-id enemy unit in its event, else its lowest-id member; only for an
  offered mission the game's `missions` names; 25); `placing`
  (`ghost:<kind>`, tag `ghost`; 30); `select-box` (`selection-box`, the dragged box normalised; 40).
- **Status**: `faction`, `tick`, `stock.<item>`, `units`, `enemyUnits`, `heroes`, `selected`,
  `selection` (the one type or kind, `mixed`, ''), `selectedHp`/`selectedMaxHp` (one selected),
  `queue`, `training`, `trainingProgress` (0-100), `trainButtons` (space separated), `placing`;
  and, each only while it applies (so a world without missions gives the same status as
  before): `offers` (how many offered) and `offer` (the first one's title, else its mission id),
  `mission` (the first open mission's title), `missionCommit` (its commit tick) and `missionLeft`
  (world ticks to it).
- **Camera**: the given hint (`RtsCamera.hint()`, from `RtsControls.presentOptions`), else the
  map's centre.
- **Events**: passed through (the world snapshot carries none).

## Named rules (`rules.ts`)

`RTS_RULES`: `enemy-follows-plan`, `enemy-waits-for-trigger`, `box-selects-own-units`,
`command-attacks-enemies`, `command-gathers-resources`. Each is one `isOn` check where it is
decided; tests switch each off. The launch command has no rule (Engine 0.11 T6, a change from
item 175's `launch-needs-offer`): the sim already refuses a mission whose opportunity is not
offered, so switching the kit's check off would change only the refusal's code, never the world,
and no run file could guard it. A game's headless `createGame` passes `opts.disabledRules` to
`rtsGame`, whose `rules` switch the controls should share.

## Rules

- Imports only `@engine/core/*` (not its drawing and output side, `FORBIDDEN_CORE`) and its own
  files; never `engine/sim`, backends, `engine/tools`, other kits or games
  (`tests/architecture/dependency-rule.test.ts`). Tests may also use `@engine/backends/null`.
- Pure (lint-enforced): no `Math.random`, `Date.now`, `performance.now` or DOM; randomness only
  through the `Rng` the adapter seeds. Core files it imports at run time must be on `PURE_CORE`.
- Never draws (`tests/architecture/no-drawing.test.ts`): it describes frames; a backend draws them
  through the game's skin. No content outside `__fixtures__/` and tests
  (`tests/architecture/no-content.test.ts`): maps, types and plans belong in `games/`.

## Testing

`pnpm test kits/rts`: `snapshot.test.ts`, `selection.test.ts` (click, box, hero alone, the rule
off), `commands.test.ts` (each command to its order, checked by `parseOrder`), `enemy.test.ts`
(same seed and snapshots give the same orders, ticks, repeats, triggers, the rules off),
`present.test.ts` (frames pass `presentFrameSchema`), `controls.test.ts`, `game.test.ts` (ids
across sides, a replay of the recorded orders gives the same snapshots) and `kit.test.ts` (the
kinds through `loadContent`), on the tiny fixture `__fixtures__/world.ts` (`battleSnapshot`, and
`siegeSnapshot` with an offered or open mission and its frozen event, for the mission tests in
`snapshot`, `commands`, `controls`, `present` and `game`).
`tests/kits/rts-sim.test.ts` drives the kit over a real `engine/sim` world (the battle fixture),
as a game's glue would, and checks a replay of the recorded player orders gives the same hashes;
its mission tests use the siege fixture (`engine/sim/__fixtures__/siege.world.json`) with a
`MissionHost`: the offer read and marked, a launch through the host, the frozen event tagged while
the site keeps going up, the HUD's commit tick, refusals as results, and the thaw at the commit.
The first game on the kit is `games/samples/rts-skirmish` (Engine 0.9 T11): its run files guard
all five rules (`mutants games/samples/rts-skirmish`; the interface rules through its interface
actions), with no run weak; the kit is not strict, so `tests/runs/rts-skirmish-mutants.test.ts`
holds the sample to that.
