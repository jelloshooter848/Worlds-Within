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
  event is frozen). Since Engine 0.13 (decision 3, item 222) it reads `Fate` (through
  `engine/core`'s `fateState`, as the other kits do) and `Member.name`: a captured or dead person
  is never in `units` or `buildings` (the sim takes them off the map; the kit also skips them by
  the data), so they vanish from the view, `thingAt` and `sidesOf`, and an injured one stays at
  their current hp; `view.named` lists every named person ascending by id as `RtsNamedView { id,
name, role, faction, fate (active, injured, captured, freed or dead), hp, maxHp, x, y }` (`x`/`y`
  null off the map) for a HUD. Since Engine 0.16 part D (D5) a unit also has, each only when the
  snapshot gives it, `sight` (`Unit.sight`), `goal` (its move task's `Task.goal`) and `path` (the
  cells still to enter, `Task.path`, when not empty), for fog of war and path dots. Drawing rules are unchanged. Helpers: `isFinished(building)`, `DIR_FACINGS` / `facingOfDir(dir)`
  (`Facing8.dir` 0 north ... 7 north-west to the eight presentation facings) and
  `thingAt(view, x, y, faction?)` (a unit, own first then lowest id; else a building whose
  footprint covers the cell; else a resource node). Engine 0.16 part D, D9 (speed, no hash
  moved): each component kind's rows are parsed by their own schema (`ROW_DATA`), and a value
  that comes frozen (a world's `peek()`, below) is parsed once and its parsed form, frozen too,
  kept in a `WeakMap` by identity, so the terrain, the types and every unit that did not change
  are not parsed again each tick; a bad snapshot still throws naming the field.
- `sides.ts` (Engine 0.11 T8, gap M15; it was the RTS skirmish's glue): `sidesOf(view,
factions?)`, every side at a glance (`SideSummary`: `units`, `unitTypes`, finished `buildings`
  by kind, `sites`, `stock`), `factions` always listed (empty once beaten), for run-file checks
  and a page's status line.
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
  off with rule `enemy-follows-plan`; `snapshot()` is each step's `{ fired, last }`. A selector
  never picks a unit whose event is frozen, and `train` skips a frozen building (the view's
  `frozen` flag; Engine 0.15 T9, gap M20), so no order goes to a unit an open mission holds. All
  randomness through the `Rng` it is given; nearest picks by squared distance, ties to the lowest id.
  **A skirmish opponent** (Engine 0.16 part D, D6; all optional, so older plans give the same
  orders and kit snapshot and every rts-classic and rts-skirmish hash stays): the plan's
  `knowledge` (`all`, the default, or `fog`: its targets and its `enemy`-side conditions read
  `RtsKnowledge.known(view)`, only the other units on cells its side sees now and the other
  buildings it sees or remembers; rule `enemy-knows-only-what-it-saw`, off: the whole view; a
  building only remembered is not attacked by id but walked to, its nearest footprint cell, since
  it may be gone); `scout` (`areas?`: the chosen units walk to the nearest unexplored passable cell,
  in the first listed area with one, else anywhere; none: it waits); attack targets `enemy-base`
  (the nearest known enemy drop-off, else building) and `last-seen-building` (seen most recently,
  then nearest); a selector's `min` (no order until that many match: a wave once N are idle);
  `build` with `cells` (the first where the footprint is on the map, passable and clear of known
  buildings and nodes; exactly one of `cell` and `cells`); `train` with `upTo` (only while own
  units of the type plus queued are fewer, at no more buildings than are missing). Workers are kept
  on gold with a repeating `gather` for `idle` workers. None of these draws from the RNG.
  `ScriptedEnemy.knowledge()` is its `RtsKnowledge` (null for a plan with `knowledge: "all"` and no
  `scout`, which keeps none); `memorySnapshot()` the memory as JSON or null. `conditionHolds(view,
faction, condition)` is the plan's condition check, shared with the end rule.
- `knowledge.ts` (Engine 0.16 part D, D6): `RtsKnowledge(faction)`, what one side knows, as kit
  state (hashed, unlike `RtsFogMemory`): `update(view)` takes in what it sees now (`visibility`) and
  returns it; explored cells (`isExplored`); other sides' buildings as last seen with the tick
  (`lastSeen(id)`, `outOfSight(id, vis)`), updated when seen again, forgotten when seen gone;
  `known(view, vis?)` the view as it knows it (own things, other units seen now, other buildings
  seen now or remembered and not seen gone; resource nodes and stock are the view's: the map's gold
  is common knowledge); `snapshot()` `{ explored: rows of "0"/"1", buildings: [{ id, kind,
faction, x, y, w, h, seen }] }`.
- `end.ts` (Engine 0.16 part D, D6): the end rule as data, `rtsEndSchema` (the `rts-end` kind):
  `{ faction, won: [condition], lost: [condition] }` in the plan's condition shape.
  `matchResult(view, end, knowledge?)`: `lost` when any `lost` condition holds (checked first),
  else `won` when any `won` holds, else null; with `knowledge` (kept up to date by its owner) the
  conditions read `knowledge.known(view)`, and an enemy-side `lte` condition on units or
  buildings holds only once the side has seen an enemy thing of that type (`knowledge.hasSeen`),
  so an unscouted enemy base is never a win.
- `names.ts` (Engine 0.16 polish Q, D2): display names as data, `rtsNamesSchema` (the `rts-names`
  kind): `{ units: { <type>: <name> }, buildings: { <kind>: <name> } }`, presentation only (never
  in the world, so no hash depends on it). `unitName(names, type)` and `buildingName(names, kind)`
  give the table's name, else the id itself.
- `present.ts`: `presentWorld(view, { faction, size, tileSize?, selection?, box?, placing?,
camera?, missions?, events?, state?, fog?, names? })`, below. `RtsPresentState` (map tracker, animation starts,
  fog memory, markers),
  `RTS_DEPTH`, `RTS_TILE_SIZE` (16), `presentMap`, `presentStatus`, `missionStatus`, `keyStatus`,
  `threatStatus` (Engine 0.16 F7), `offerTarget`, `unitAnim`, `rtsMissionInfo(def)`. `missions` is the game's `RtsMissionInfo` list
  (`{ id, title, event?, marker? }`; a `MissionDef` fits). `marker` is an entity id or (Engine
  0.15 T7, gap M25) a scenario key, the mission file's `marker`, resolved through the options'
  `keys` (the world's key table: `MissionHost.worldKeys()`); a key the table lacks is ignored.
- `fog.ts` (Engine 0.16 part D, D5): fog of war for one side, presentation and AI knowledge only
  (no hash moves). `visibility(view, faction)` gives the cells it sees now (`RtsVisibility {
width, height, cells }`, `isVisible`, `seesBox`): a unit sees `unitSight` cells (its `sight`,
  else its type's, else `RTS_UNIT_SIGHT` 4), a building `buildingSight` cells from its whole
  footprint (its type's optional `sight`, `rtsBuildingTypeSchema` in `engine/core/rts-types.ts`
  with no default so no types table or hash changes, else `max(w, h) + RTS_BUILDING_SIGHT_EXTRA`
  2), sites included; a cell is seen when `dx² + dy² < (sight + 1)²` (the sim's floored-distance
  range rule, integers). `RtsFogMemory` is a side's memory (explored cells, other sides' buildings
  and the resource nodes as last seen; a remembered one seen again is updated, or forgotten when
  gone; a view of another faction, map size or an earlier tick starts it afresh), kept in
  `RtsPresentState.fog`, never in a snapshot. `fogView(view, faction, memory?)` is what the side
  may be shown (`units`: own, and others on seen cells; `buildings` and `resources` as
  `{ thing, remembered }`; `fog`: the frame's `PresentFog`, `2` seen, `1` explored, `0` not).
- `feedback.ts` (Engine 0.16 part D, D5): `orderMarker(view, draft)` (`RtsOrderMarker { kind:
move | attack | gather | build, x, y, w, h, entity }` in cells: a move's cell, a build's
  footprint, an attack's target or a gather's node box with its entity; null for `stop`, `train`
  or a target not in the view), `entityBox`, `RtsOrderFeedback { marker, events }`,
  `RTS_MARKER_TICKS` (8) and `RTS_MARKER_MAX` (8).
- `events.ts` (Engine 0.15 T14): `RtsEventTracker(faction, tileSize?)`: `next(view)` gives the
  presentation events between the last view it saw and this one (none for the first view or
  another view of the same tick, as a page draws many frames a tick), `reset()`; `rtsEvents(before,
after, faction, tileSize?)` is the same for two views. Events, each with `side` (`own`, `enemy`,
  `neutral` for the player; a skin keys `unit-down:side=own`), `entity` and `x`/`y` (the box's
  centre, world px): `unit-ready` (`unitType`), `unit-down` (`unitType`), `unit-hit` (`damage`),
  `site-placed` (`kind`), `building-done`, `building-down`, `building-hit` (`damage`) and
  `stock-up` (`item`, `amount`; no `entity`), in that order, each ascending by id. It only reads
  views (the snapshot has no events; the sim's rules announce nothing), so it holds no world rule;
  a game hands them to `presentWorld`'s `events` (the RTS skirmish does). `events.test.ts`.
  `barkEvent(view, draft, faction, tileSize?)` (Engine 0.16 part D, D5): an accepted order's
  `bark` (`side`, `order` the order type, `unitType` the first unit's type or for `train` the type
  trained, `kind` the building for `train` and `build`, `entity`, `x`/`y`), null when no ordered
  unit or building is in the view.
- `controls.ts`: `RtsControls(faction, camera, tileSize, rules?)`, the pointer glue a page uses:
  `gesture(g, view, additive?)` takes `PointerGesture`s (`engine/core/input/pointer-logic.ts`):
  pan and zoom move the `RtsCamera`, a primary tap selects (or places the building being placed),
  a box drag selects on `end` (shown while `move`), a secondary tap commands (or cancels placing);
  it returns an `OrderDraft` or null. `startPlacing(kind)`, `cancelPlacing()`, `hover(point)`
  (the ghost's cell), `train`, `stop`, `selectHeroes`, `launchMission(view, id, launcher)` (the
  bar's mission button, `launchMission` above), `placing(view)` (sized from the world's
  types) and `presentOptions(view)` (`selection`, `box`, `placing`, `camera` for `presentWorld`).
  Through a ground-view camera (`RtsCamera` with `ground`, Engine 0.16 F2: the 3D backend's
  `camera3d.view: "ground"`) taps and right taps pick the cell under the pointer's ray on the
  ground (`camera.screenToWorld`), and a box selects the units whose cell centres are drawn inside
  the dragged picture rectangle (`Selection.boxWhere(view, inside, tileSize, additive?)` with
  `camera.inScreenBox`), not a world box; the box shown is the bounds of the ground under it.
  `feedback(draft, view)` (Engine 0.16 part D, D5) is an accepted order's `RtsOrderFeedback`
  (`orderMarker` and `barkEvent` with side `own`); the page hands it to
  `RtsPresentState.accept(feedback, view.tick)` once `RtsGame.issue` accepted the draft.
- `game.ts`: the headless adapter. `RtsWorldPort { snapshot(), applyOrder(order), step() }` is
  what the game's glue fills with an `engine/sim` world (the kit never imports the sim): since
  Engine 0.15 T6 (gap M27) with `engine/sim`'s `rtsWorldPort(world)`, the one bridge, typed by
  shape on the sim's side (`tests/kits/rts-sim.test.ts` checks the two fit).
  The port's optional `peek()` (Engine 0.16 part D, D9; `rtsWorldPort` gives the sim's
  `World.peek()`) is the snapshot without copies, which `view()` reads when there is one.
  `rtsMissionHooks(game)` (Engine 0.15 T6, gap M18) gives a `MissionHost`'s options `canOpen`
  (`missionRequest`: `not_offered` while no opportunity offers the mission) and `onChange`
  (`refresh()`), so a host over an `RtsGame` needs no wrapper (the mini siege spreads them into
  its host's options).
  `rtsGame({ world, enemy?, seed, disabledRules? })` gives an `RtsGame`, a `HeadlessGame`:
  `order(json)` (a recorded order, applied at once), `issue(draft)` (the player's command, stamped
  with the next id), `step()` (the enemy thinks and its orders are applied, then the world
  steps), `snapshot()` `{ world, kit: { nextOrder, rng, enemy, seen? } }` (`seen`, Engine 0.16
  part D, D6: the enemy's memory, only for a plan that keeps one), `scriptedEnemy()`, `view()`, `tick`,
  `nextOrderId`, `recorded()` (the player's orders as `{ tick, ...order }`, refused ones too,
  ready for a run file's `orders`) and `log()` (every order of both sides with tick, source and
  refusal). Ids count up across both sides in the order applied; a recorded order keeps its id
  and moves the counter past it, so replaying the player's orders gives the enemy the same ids.
  The view is cached until the next order or step: after a `MissionHost` launch (or any change
  made outside the port between steps) `refresh()` is called before reading `view()` again (by
  the host's `onChange`, through `rtsMissionHooks`).
- `schema.ts`: the content kinds (below) and `rtsScenario(map, types, seed)` (Engine 0.15 T15,
  the API review: both RTS samples wrote it): the map with the run's seed and the types table
  spawned first as the entity keyed `types`, the scenario a game hands `worldFromScenario`.
  `rules.ts`: `RTS_RULES`. `kit.ts`: the hook.

## Kit hook (`kit.ts`)

`kit` (`defineKit`): name `rts`, kinds `rts-map`, `rts-types`, `rts-enemy`, `rts-end`, `rts-names`, rules `RTS_RULES`, no
strict mutants. `engine/tools` finds it through the generated `engine/tools/kit-list.ts` (`pnpm
docs:gen` after changing it). `index.ts` does not re-export it.

## Content kinds (`schema.ts`)

- `rts-map`: the map, a world scenario (`*.world.json`, the `engine/sim` format) with
  `"systems": "rts"`. The kit checks the shape and the grids (rows of legend characters, elevation
  digits of the same size); components are `z.json()` here and are checked by the sim when the
  glue builds the world (`worldFromScenario`). Its optional `opportunities` (Engine 0.11 T8,
  gap M14) are the scenario's mission windows, likewise checked by the sim. Its optional `from`
  (Engine 0.13 T6) is a follow-up map's carry spec, checked here with `carryFromSchema` from
  `engine/core/carried.ts` and against the map by the sim; a campaign's `scenario` entries name
  `rts-map` files.
- `rts-types`: `rtsTypesSchema` from `engine/core/rts-types.ts`, for a game that keeps its unit
  and building types in their own file.
- `rts-enemy`: `enemyPlanSchema`. `checkAll` reports a unit or building type a plan names that no
  `rts-types` file or map `RtsTypes` has, as `unknown_type` at the field (only when the game has
  types to check against).
- `rts-end` (Engine 0.16 part D, D6): `rtsEndSchema` (`end.ts`). `checkAll` reports a unit or
  building type its conditions name that the game's types lack (`unknown_type` at `won.<i>.type`).
- `rts-names` (Engine 0.16 polish Q, D2): `rtsNamesSchema` (`names.ts`), string ids to non-empty
  display names, both tables optional. `checkAll` reports a unit type or building kind it names
  that the game's types lack (`unknown_type` at `units.<id>` / `buildings.<id>`; an error, as for
  plans, since the loader has no warnings).
- Examples in `docs/reference/examples/` (`rts-map.json`, `rts-types.json`, `rts-enemy.json`, `rts-end.json`,
  `rts-names.json`);
  every field has a `.describe(...)`. After a schema change: `pnpm docs:gen`.

## Presentation frames (`present.ts`)

`presentWorld` only reads the view; positions are world pixels (cell x, y is the box `x *
tileSize, y * tileSize`). Without `state` the full map goes in every frame and `anim.t` is the tick.
`RtsPresentState` also keeps (Engine 0.16 part D, D5) the fog memory (`fog`), the order markers
(`mark(marker, tick)`, `accept(feedback, tick)`, `markers(tick)`) and the barks waiting for the
next frame (`takeEvents()`; `presentWorld` appends them to the frame's events once).

- **Fog** (`fog: true`, default off; Engine 0.16 part D, D5): the frame's `fog` is the player's
  grid (`fogView`; with `state` explored cells and last-seen things are remembered, without it
  explored means seen now); other sides' units show only on cells seen now; other sides'
  buildings and resource nodes show when seen now, else as last seen with the tag `last-seen` and
  no bars or ring; the status's `enemyUnits`, `enemyNear` and selection values read only what is
  seen now (`keyStatus` and the offer markers read the whole view: missions are the game's own
  knowledge). The minimap (D3) draws the frame's entities and fog, so it shows the same
  knowledge. Fog off, the frame is exactly what it was.

- **Map**: `id` `rts` (or the options' `mapId`, Engine 0.16 F6: a game with several scenarios
  names each, so a 3D skin's `decor` and `places` dress each one; `RTS_MAP_ID`), the terrain as a grid of type indexes, `tags` `type:<i>:<name>` (plus
  `:blocked` when impassable), `version` a 32-bit hash of the cells and type names.
- **Entities** (`layer` from `RTS_DEPTH`): `resource-<id>` (`resource:<item>`, `idle` or
  `empty`, tag `amount:<n>`, 5); `building-<id>` (`building:<kind>`, `site` while under
  construction, `train` while it has a queue, else `idle`; tags `own`/`enemy`/`neutral`,
  `faction:<f>`, `site`, `progress:<0-100>`, `training:<unit>`, `selected`, `damaged` (finished and
  below its full hp), `frozen`; 8);
  `<id>/ring` (`selection-ring` for each selected unit or building, tags its side and `hero` or
  `building`; 9); `unit-<id>` (`unit:<type>`, facing from `Facing8` in eight directions, `down`
  before any move; `anim.state` `walk` (stepping with a task, or on a move), `attack` (has a target), `build`,
  `gather`, `idle`; tags side, `faction:<f>`, `hero`/`captain`, `carrying`, `selected`, `damaged`
  (below its full hp, Engine 0.11 T9: a skin's `byTag` look, the mini siege's burnt engines),
  `frozen` (a member of a frozen event: the battle is held while a mission is open), and
  `hp:<hp>/<max>` whenever its health bar shows (hurt or selected; Engine 0.16 F6: the bar's
  numbers for a 3D skin's label, `{ from: { tag: "hp:" }, as: "bar" }`; a finished building gets
  it too); 10);
  `<id>/hp` (`health-bar`, `hp-0`..`hp-8` eighths, for the hurt and the selected; 20) and
  `building-<id>/progress` (`progress-bar`, `p-0`..`p-8`, for a site, frozen or not: the sim
  keeps building it; 20); `offer-<opportunity>` (`mission-offer`, `idle`, tags `mission:<id>`,
  `opportunity:<id>`, `target:<entity>`, over its target's box: the mission info's `marker`
  entity, else the lowest-id enemy unit in its event, else its lowest-id member; only for an
  offered mission the game's `missions` names; 25); `placing`
  (`ghost:<kind>`, tag `ghost`; 30); `select-box` (`selection-box`, the dragged box normalised; 40).
- **Feedback** (Engine 0.16 part D, D5; skin kinds a game maps): `building-<id>/train`
  (`progress-bar`, `p-0`..`p-8` of the first queued unit's ticks, tags `train`,
  `training:<unit>` and the queue count `queue:<n>` (a 3D skin's label reads it with
  `{ from: { tag: "queue:" } }`), a 2 px bar just under the footprint, for an own finished
  building with a queue; it is a `progress-bar`, so every skin that draws construction draws it; 20);
  `unit-<id>/path-<i>` (`path-dot`, `idle` or `goal` for the last, tags `own` and `goal`, a
  `max(2, tileSize / 4)` px box centred in each cell of a selected own unit's `path`, else its
  `goal`, at most 32, its own cell skipped; `RTS_DEPTH.path` 6); `marker-<n>` (`order-marker`,
  `anim.state` the order kind `move`, `attack`, `gather` or `build`, `anim.t` its age in ticks,
  tags the kind and `fade:<8..1>` (eighths left of `RTS_MARKER_TICKS`), over the target's box,
  an attack's or gather's following its entity while shown; `RTS_DEPTH.marker` 24). Events:
  `bark` (`barkEvent`) for a skin's `events` (`bark:order=attack`, `bark:unitType=worker`) to a
  voice-like sfx and a short text.
- **Status**: `faction`, `tick`, `stock.<item>`, `units`, `enemyUnits`, `heroes`, `captives`
  (Engine 0.13 T8: the player's named people captured, from `view.named`), `selected`,
  `selection` (the one type or kind, `mixed`, ''), `selectedHp`/`selectedMaxHp` (one selected),
  `queue`, `training`, `trainingProgress` (0-100), `trainButtons` (space separated), `placing`;
  and, each only while it applies (so a world without missions gives the same status as
  before): `offers` (how many offered) and `offer` (the first one's title, else its mission id),
  `mission` (the first open mission's title), `missionCommit` (its commit tick) and `missionLeft`
  (world ticks to it), and `captive` (Engine 0.13 T8: the first captured person's name, for a
  captive marker in the HUD; `snapshot.test.ts` checks both). Engine 0.16 F7 (a 3D page's HUD
  objectives and selected-unit panel; presentation only, no hash moved): with one thing
  selected, `selectedName` (a named person's name, else its type or building kind),
  `selectedType` and `selectedRole` (a named person's role, else ''); for every key of the
  options' `keys` (`keyStatus`), `key.<key>.alive` (1 while its entity is in the world and, for a
  named person, not dead), `key.<key>.hp` / `.maxHp` while it is on the map, `.progress`
  (0-100) for a building with a construction, `.fate` and `.name` for a named person; and
  `enemyNear` (`threatStatus`: the fewest cells, Chebyshev, from an enemy unit to one of the
  player's buildings; left out when either side has none), for a danger music layer. Engine 0.16
  polish Q (D2; presentation only, no hash moved): with the options' `names` (an `rts-names`
  table), `selectedName` is the type's or kind's display name when no named person is selected
  (`selectedType` and `selection` keep the ids, for `when` conditions) and `trainingName` is
  `training`'s display name (or ''); an id the table lacks shows as itself. Without `names` the
  status is exactly as before (no `trainingName`). Tested in `present.test.ts`.
- **Camera**: the given hint (`RtsCamera.hint()`, from `RtsControls.presentOptions`), else the
  map's centre.
- **Events**: passed through (the world snapshot carries none; `RtsEventTracker` reads them off
  two views, Engine 0.15 T14).

## Named rules (`rules.ts`)

`RTS_RULES`: `enemy-follows-plan`, `enemy-waits-for-trigger`, `enemy-knows-only-what-it-saw`
(Engine 0.16 part D, D6), `box-selects-own-units`, `command-attacks-enemies`,
`command-gathers-resources`. Each is one `isOn` check where it is
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

`pnpm test kits/rts`: `snapshot.test.ts`, `sides.test.ts`, `selection.test.ts` (click, box, hero alone, the rule
off), `commands.test.ts` (each command to its order, checked by `parseOrder`), `enemy.test.ts`
(same seed and snapshots give the same orders, ticks, repeats, triggers, the rules off; Engine 0.16
part D, D6: fog knowledge never targeting an unseen enemy, remembered buildings walked to, scouting,
waves with `min`, `upTo`, `cells`, gathering idle workers, determinism, and
`enemy-knows-only-what-it-saw` off),
`present.test.ts` (frames pass `presentFrameSchema`; Engine 0.16 part D: the train bar and queue
count, path dots, markers fading and following, barks sent once), `fog.test.ts` (sight radius and
fallbacks, explored memory, last-seen buildings and nodes, enemies hidden, the fog frame),
`controls.test.ts` (and `feedback`), `game.test.ts` (ids
across sides, a replay of the recorded orders gives the same snapshots) and `kit.test.ts` (the
kinds through `loadContent`), on the tiny fixture `__fixtures__/world.ts` (`battleSnapshot`, and
`siegeSnapshot` with an offered or open mission and its frozen event, for the mission tests in
`snapshot`, `commands`, `controls`, `present` and `game`; `snapshot.test.ts` adds fates to the
battle: the captured and the dead left out, the injured at their hp, `named`).
`tests/kits/hero-mission.test.ts` (Engine 0.13) reads a real world after a capture: the captain
gone from `units` and listed in `named` as captured.
`tests/kits/rts-sim.test.ts` drives the kit over a real `engine/sim` world (the battle fixture),
as a game's glue would, and checks a replay of the recorded player orders gives the same hashes;
its mission tests use the siege fixture (`engine/sim/__fixtures__/siege.world.json`) with a
`MissionHost`: the offer read and marked, a launch through the host, the frozen event tagged while
the site keeps going up, the HUD's commit tick, refusals as results, and the thaw at the commit.
The first game on the kit is `games/samples/rts-skirmish` (Engine 0.9 T11): its run files guard
every rule (`mutants games/samples/rts-skirmish`; the interface rules through its interface
actions; since Engine 0.16 part D, D8, its fog AI's `scout` step guards
`enemy-knows-only-what-it-saw` too), with no run weak; the kit is not strict, so
`tests/runs/rts-skirmish-mutants.test.ts` holds the sample to that. From Engine 0.16 part D (D2) the same battle is kept unchanged as the
test game `games/rts-classic`, whose run files never move, held the same way by
`tests/runs/rts-classic-mutants.test.ts`, so the sample can become the full match.
`tests/kits/rts-ai.test.ts` (Engine 0.16 part D, D6) plays a fog opponent over a small sim field
(`tests/kits/__fixtures__/skirmish-ai.world.json`): it gathers, builds a barracks, trains, scouts,
sends a wave at red's base, attacks only what its side sees, and the data end rule decides the
match (red `lost`, blue reading its own knowledge `won`), the same hashes every run.
`tests/runs/rts-classic-mutants.test.ts` lists `enemy-knows-only-what-it-saw` as the one rule the
0.15 battle's run files cannot guard (its raiders know all); the skirmish's (D8) guard it.
`tests/runs/rts-fog.test.ts` (Engine 0.16 part D, D5) plays every rts-classic and rts-skirmish run
through the game's view with the kit's frames made with fog off and on: the same golden hashes and
final state each way, the fogged frames passing the schema and hiding enemies out of sight.
