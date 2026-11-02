# engine/sim

The optional world simulation (from Engine 0.8): the world as data, with no graphics. Games that
need a living world use it; simple games never touch it. The ECS is our own small one (decision in
`docs/BUILD-LOG.md`, Engine 0.8, item 99); one tick is one world minute (item 100).

## Files

- `component.ts`: `defineComponent(name, schema)` -> `ComponentDef<T>`, a component kind with the
  Zod schema its data must match.
- `world.ts`: `createWorld(seed, { components?, systems?, log? })` -> `World`.
- `events.ts`: the event log's types (`Change`, `ChangeOp`, `Cause`, `LogOptions`) and
  `EXTERNAL_CAUSE` (see "Event log" below).
- `save.ts`: `saveWorld(world)` and `loadWorld(json, { components, systems? })`, the save file
  schema `worldSaveSchema` and `SaveError` (see "Save and load" below).
- `math.ts`: deterministic integer and fixed-point maths (see "Maths" below).
- `components.ts`: the standard components (see "Standard components" below), `STANDARD_COMPONENTS`
  and `inventoryAdd`.
- `squad.ts`: squad helpers (see "Squads" below).
- `terrain.ts`: the `Terrain` component and its helpers (see "Terrain" below).
- `scenario.ts`: `worldFromScenario(json, { components?, systems?, log? })`, the world-start file
  schema `scenarioSchema` and `ScenarioError` (see "Scenarios" below).
- `path.ts`: integer walking on the terrain grid, `distanceField` and `nextStep` (see "Walking").
- `astar.ts`: RTS pathfinding, `findPath` (A*) for one unit and `flowField`/`flowStep` for a
  group, 4-way or 8-way (see "Walking").
- `systems.ts`: the `Walk` and `Hauler` components (`SYSTEM_COMPONENTS`), `walkToward`, `addWork`
  and the systems `haulSystem`, `buildSystem` and `patrolSystem` (see "Systems").
- `rts.ts`: RTS units (Engine 0.9): the components `Unit`, `Facing8`, `Task`, `Target` and
  `Cooldown` (`UNIT_COMPONENTS`), the unit order checks and writes, and the systems `moveSystem`,
  `attackSystem` and `deathSystem` (see "RTS units").
- `economy.ts`: the RTS economy (Engine 0.9 T8): the components `RtsTypes`, `Stockpile`,
  `Resource`, `Producer` and `Gatherer` (`ECONOMY_COMPONENTS`, with `Building`), `spawnUnit`,
  `placeBuilding`, the economy order checks and writes, and the systems `gatherSystem`,
  `constructSystem` and `trainSystem` (see "RTS economy").
- `footprint.ts`: the `Building` component and footprint helpers (`footprintOf`, `inReach`,
  `inRect`, `rectsOverlap`, `ringAround`), shared by the two above.
- `rts-orders.ts`: `applyOrder` for every order type, `RTS_COMPONENTS` and `RTS_SYSTEMS` (the
  economy's systems, then the units', in that order).
- `system-sets.ts`: named system sets (Engine 0.9 T9, items 118 and 132): `SYSTEM_SETS`
  (`village`: `[...STANDARD_COMPONENTS, Terrain, ...SYSTEM_COMPONENTS]` with `haulSystem`,
  `buildSystem`, `patrolSystem`; `rts`: `[...STANDARD_COMPONENTS, Terrain, ...RTS_COMPONENTS]` with
  `RTS_SYSTEMS`), `SYSTEM_SET_NAMES` and `DEFAULT_SYSTEM_SET` (`village`). A scenario names one in
  `systems` (Scenarios, below).
- `__fixtures__/village.world.json`: the sample world (see "The sample world"), with its golden
  hashes `village.hashes.json`, and `village-build.run.json`, a CLI run file on it (`pnpm cli run`;
  `engine/tools/CLAUDE.md`, World runs) with its golden `village-build.hashes.json`; and
  `battle.world.json`, a tiny `rts` battle, with `battle.run.json`, its recorded orders and sync
  hashes (`engine/tools/CLAUDE.md`, Recorded orders), and the golden `battle.hashes.json`. Fixtures
  only: no game content anywhere else in the folder.
- `index.ts`: the public entry point; import from here outside this folder.

## The world

- **Entities** are positive integer ids from `spawn()`, handed out in order (`nextId`) and never
  reused. `destroy(id)` removes the entity and all its components.
- **Components** are registered by kind (`registerComponent` or the `components` option) and set
  with `add(id, def | name, data)` (or `update(id, def, fn)`, which adds `fn(current)`), read with
  `get`, checked with `has` and dropped with `remove`. `add` checks the data against the schema
  and that it is JSON-safe, and stores a deep-frozen copy. **Never change stored data in place**
  (it throws): every change goes through `add`/`update`/`remove` so it reaches the event log.
- **Queries** (`query(...components)`, `entities()`, and the component lists in a snapshot) always
  run in ascending entity id order, never in Map/Set insertion order. Code that iterates the world
  must go through them.
- **Systems** are `{ name, run(world) }`, run by `step()` in the order they were added; after the
  last one the tick is committed (`tick` + 1). `tick` is an integer, 0 for a new world. A system may
  not call `step()`.
- **RNG**: `world.rng` is an `Rng` from `engine/core/rng.ts` seeded from the world seed. Its state
  is in every snapshot (`rng`).
- **Snapshots**: `snapshot()` is the whole world as JSON-safe data (`seed`, `tick`, `nextId`,
  `rng`, `entities`, and per component kind a list of `[id, data]` in id order), copied from the
  live state. `canonical()` is that snapshot as canonical JSON (`canonicalJson` from
  `engine/core/headless.ts`). Hashing stays in the tools (`node:crypto`); the sim never hashes.

## Event log

Every change made through the World API is one `Change` (`events.ts`), JSON-safe and frozen:
`{ tick, cause, op, entity, component?, before?, value? }`. Ops: `spawn`, `destroy`, `add` (a
component the entity lacked: `value`), `set` (replaced: `before` and `value`) and `remove`
(`before`; a `remove` of a missing component logs nothing). `destroy` first logs a `remove` for
each component the entity had, by component name, then the `destroy`. Terrain changes are `set`s
of the `Terrain` component. RNG draws are not logged themselves; what they decide is, as the
changes they lead to (the RNG state is in every snapshot).

- **Cause.** During `step()` the cause is always the running system's name (system names must be
  valid causes). Between ticks it is the one given by `world.withCause(cause, fn)`, such as
  `order:<id>`, `scenario` or `load`, or `'external'` (`EXTERNAL_CAUSE`) when none is given.
  `withCause` inside a system throws. `world.cause` is the cause a change made now would get.
- **Tick.** A change carries the tick the world was at when it was made: a system's change during
  the step from tick t carries t, and a change between ticks carries the current tick (the tick it
  applies to), so within one tick the external changes come first, then the systems' in run order.
- **Commit.** A step's changes are staged and join the log only when the tick commits; a system
  reading `events()` never sees the running step's changes. A change between ticks joins at once.
  If a system throws, the tick is not committed and its staged changes are dropped (the world
  state is not rolled back: a world whose step threw is broken).
- **Reading.** `events(sinceTick?)`: the kept changes with `tick >= sinceTick`, oldest first, in
  the order they were made. The order is deterministic: the same seed, setup and systems give the
  same log (`canonicalJson(world.events())` is equal across runs).
- **Retention.** Default: keep every change (fine for tests and the sample world). For long runs
  pass `log: { ticks: n }` to keep only the changes of the last `n` committed ticks (trimmed at
  each commit: after reaching tick T, changes with `tick < T - n` go), or `log: { enabled: false }`
  to record nothing. The log is not part of `snapshot()`, so it never changes a state hash.

## Save and load

`saveWorld(world)` returns the whole world as JSON-safe data; write it as text with
`canonicalJson`. `loadWorld(json, { components, systems })` checks it and rebuilds the world:
same snapshot, RNG state, `nextId`, tick and event log, and it steps on exactly as the saved world
would. `canonicalJson(saveWorld(loadWorld(save)))` is the same text as the save (tested).

```text
{ format: "worlds-within/world", version: 1, seed, tick, nextId, rng,
  components: ["Health", ...],          // registered kinds, sorted
  systems: ["move", ...],               // names in run order
  entities: [{ id, components: { Position: {...}, ... } }],   // ascending id
  log: { enabled, ticks /* or null */, events: [Change, ...] } }
```

- **Systems are code**, never saved. `loadWorld` takes the same list in the same order and refuses
  a save whose `systems` names differ. Systems keep no state of their own: what a system must
  remember between ticks is component data, so it is saved like the rest. (There is no system
  state in the format.)
- **Components**: every kind the save lists must be in `components` (extra kinds start empty);
  each entity's data is checked by its component's schema. Terrain is the `Terrain` component of
  one entity, so it is saved with it (pass `Terrain` in `components`).
- **RNG**: the save holds `Rng.state()`; load uses `Rng.fromState` (`engine/core/rng.ts`).
- **Ids**: `nextId` is saved, so an id is never reused after a load, even when the newest
  entities were destroyed.
- **Event log**: the kept changes and the retention (`enabled`, `ticks`) are saved and restored as
  they were; loading logs nothing itself.
- **Errors**: a bad save throws `SaveError` (`issues: { path, message }[]`), its message one line
  per bad field: `entities.1.components.Health.hp: ...`, `log.events.0.op: ...`, `systems: ...`.
- `saveWorld` throws during a step (a step's changes are not committed yet): save between ticks.
- The format is in `docs/reference/schemas.md` ("World save", from `worldSaveSchema`, with the
  example `docs/reference/examples/world-save.json`). A change to the format bumps
  `SAVE_VERSION`.

## Standard components

All in `components.ts`, each a `defineComponent` with a Zod schema; `STANDARD_COMPONENTS` lists
them for `createWorld(seed, { components: STANDARD_COMPONENTS })`. Ids in data (factions, items,
building kinds) are a letter then letters, digits, `_` or `-`; entity ids are positive integers.

- `Position` `{ x, y, z }`: integer cell coordinates; `z` (the level stood on) defaults to 0.
- `Health` `{ hp, max }`: integers, `0 <= hp <= max`, `max >= 1`.
- `Owner` `{ faction }`: a faction id.
- `Inventory` `{ [item]: count }`: integer counts `>= 0`, stored with keys sorted (the schema
  re-sorts them). `inventoryAdd(world, id, item, delta)` changes a count, drops zeros, refuses to
  go below 0.
- `Construction` `{ kind, progress, work, done }`: `0 <= progress <= work`, `work >= 1`, `done`
  true exactly when `progress === work`.
- `Worker` `{ job, rate }`: the entity being worked on (or null) and work per tick (`>= 1`).
- `Patrol` `{ waypoints, index }`: at least one `{ x, y, z }` waypoint; `index` points at one.
- `Squad` `{ strength, captain, members }` and `Member` `{ name, squad, role }`: see "Squads".

## Squads

A squad is one number for the RTS view and still names its people. `Squad.strength` counts
everyone; `Squad.members` are the named people (entities with `Member`), unique and ascending,
never more than the strength; `captain` is one of them or null. The rest are unnamed rank and file.
`Member.role` is `regular`, `hero` or `captain` (`ROLES`).

- `squadStrength(world, squad)`: the one number.
- `squadMembers(world, squad)`: `{ id, name, role }[]`, ascending by id.
- `pickMembers(world, squad, n, rng)`: `n` named people drawn with `rng` (use `world.rng` in a
  system) from the id-ordered list, returned ascending by id; same RNG state, same people.
- `joinSquad(world, squad, person)`: adds a named person, strength + 1; a new captain demotes the
  old one to hero.
- `applyLosses(world, squad, n)`: strength - n (not below 0). **Loss order:** unnamed people go
  first; named people leave only when strength drops below their number, regulars first, then
  heroes, the captain last, and within a role the highest id (newest) first (`lossOrder`). No
  randomness. People who leave stay in the world with `squad: null`; their fate is the caller's
  rule. Returns their ids in leaving order.

## Terrain

`Terrain` (in `terrain.ts`) is a component held by exactly one entity of the world, so it is in
every snapshot and save. `{ width, height, types, elevation, cells }`: `types` is a list of
`{ name, cost, passable }` (integer cost `>= 1`); `elevation` (integers) and `cells` (indexes into
`types`) list every cell row by row (`index = y * width + x`). `flatTerrain(w, h, type?)` builds
flat ground. Helpers: `terrainOf(world)` / `terrainEntity(world)`, `heightAt(t, x, y)`,
`typeAt`, `moveCost(t, x, y)` (the type's cost, or null when impassable or off the grid),
`passable`, `inBounds`, `cellIndex`, `cellAt`. Height is data only (item 101; still so after 0.9): it
changes no cost and there is no line of sight. Line-of-sight and height rules come later, in
integer maths, here in `engine/sim`.

## Scenarios

A scenario is a world written as data (`scenario.ts`). `worldFromScenario(json, options)` checks it
and returns the world at tick 0; every change it makes is logged with the cause `scenario`.
`options.components` defaults to `STANDARD_COMPONENTS` plus `Terrain` and must include `Terrain`
(and `Squad` and `Member` when there are squads); pass the systems and log retention the world
should run with. A scenario may name an engine system set, `"systems": "village" | "rts"`
(`system-sets.ts`): with no `components` or `systems` option, the world gets that set's (the
caller's own always win). Left out, nothing changes; the tools' world runs then use `village`, so
the 0.8 sample world and its hashes are unchanged. Adding the optional field kept the format at
version 1 (every version 1 file reads as before).

```text
{ format: "worlds-within/scenario", version: 1, seed, systems?,  // "village" | "rts"
  terrain: { legend: { ".": { name, cost, passable }, ... },  // one ground type per character
             rows: ["..~~..", ...],                           // the grid, north first
             elevation: ["110011", ...] },                    // one digit (0-9) per cell
  entities: [{ key?, components: { Position: {...}, ... } }],
  squads: [{ key?, strength?, components: {...},              // not Squad: it is built
             members: [{ key?, name, role, components? }] }] }  // not Member: it is built
```

- **Terrain**: types are numbered in sorted legend character order (`#` before `.` before `a`);
  `rows` and `elevation` must be the same size, every character in the legend.
- **Ids** are handed out in file order: the terrain entity is 1, then `entities`, then each squad
  followed by its members. `key` names an entity so component data can point at it:
  `{ "$ref": "<key>" }` anywhere in component data becomes that entity's id
  (`"job": { "$ref": "hall" }`). Keys are unique across the file.
- **Squads**: `Squad` is built from the entry (`strength` defaults to the number of named members,
  `captain` is the member whose role is `captain`, at most one) and each member gets
  `Member { name, squad, role }`.
- **Errors**: a bad file throws `ScenarioError` (`issues: { path, message }[]`), one line per bad
  field: `terrain.rows.1: character "x" at x 1 is not in the legend`,
  `entities.0.components.Position.x: ...`,
  `entities.1.components.Worker.job: $ref "zed" names no entity of the scenario`.
- The format is in `docs/reference/schemas.md` ("World scenario", from `scenarioSchema`, with the
  example `docs/reference/examples/world-scenario.json`). A change to the format bumps
  `SCENARIO_VERSION`.

## Walking

`path.ts`: 4-way movement on the terrain grid. Entering a cell costs its type's `cost`; impassable
cells and cells off the grid are never entered. `distanceField(t, goal, near)` is the cheapest
total cost from every cell to the goal (`UNREACHABLE` = -1 where there is no way); with `near` the
goal is the cell or any cell next to it (for reaching something on a cell no one can enter).
`nextStep(t, field, from)` is the neighbour to step into, ties going north, east, south, west
(`STEPS`), or null at the goal or with no way. Fields are cached per terrain object and goal (a
`WeakMap`; the terrain is replaced, never changed, so the cache never changes a result). Height
changes no cost (item 101); a walker stands at the elevation of the cell it enters (`z`).

`astar.ts` (Engine 0.9, items 126-127) adds A* and group flow fields, all integer. Each takes a
`neighbourhood`: 4 (the default; the same moves and costs as `distanceField`, so the 0.8 sample
world and its golden hashes are untouched) or 8. In 8-way a straight step costs the entered cell's
cost times `STRAIGHT_COST` (10) and a diagonal times `DIAGONAL_COST` (14), and a diagonal is only
allowed when both straight cells beside it are passable (no corner cutting); ties go N, NE, E, SE,
S, SW, W, NW (`STEPS_8`). `stepCost(t, x, y, step, n)` is the cost of one move or null.

- `findPath(t, from, goal, { neighbourhood?, maxExpanded? })`: A* for one unit. It returns
  `{ cells, cost, expanded }` (cells entered in order, not the start) or null when the start or
  goal is impassable or off the grid, there is no way, or none was found within `maxExpanded`
  expanded cells (default `ASTAR_MAX_EXPANDED`, 65,536). Heuristic: Manhattan (4-way) or octile
  (8-way) distance times the cheapest passable cost, so the path is always a cheapest one.
  **Ties:** the open cell with the lowest estimate goes first, then the lowest heuristic, then the
  lowest cell index; a cell's way in changes only for a strictly cheaper one, so among equal ways
  the first neighbour in step order keeps it. Results are cached per terrain object and arguments (at most 4,096 per
  terrain; the cache is emptied when full, never changing a result).
- `flowField(t, goal, { neighbourhood?, near? })` -> `FlowField`
  `{ neighbourhood, goal, near, dist }`: the cheapest cost from every cell to the goal, shared by
  a group. 4-way `dist` is exactly `distanceField(t, goal, near)`; 8-way it is a Dijkstra with
  the 8-way costs. Cached per terrain object and goal. `flowStep(t, field, from)` is the next cell (ties in step order), or
  null at the goal or with no way; 4-way it is `nextStep`.
- **When to use which** (measured in `astar.test.ts`): on a 256x256 map with forest and walls, one
  8-way field expands every reachable cell (59,173) in about 55 ms, one A* across the map about
  11,000 cells in about 12 ms, and 300 units running A* expand 3.35 million cells. A group of
  `FLOW_GROUP_SIZE` (4) or more units sharing a goal reads one flow field; fewer units, or a near
  goal (about 0.13 ms for 8 cells), use A*.

## Systems

`systems.ts` holds the world's first systems. They are machinery, not game rules: every number
they use is component data. All integer, all randomness through `world.rng`, all state in
components, entities visited in id order.

- `Walk` `{ wait }`: a walker. Entering a cell of cost c takes c ticks (the step, then c - 1
  waits). `walkToward(world, id, t, field)` takes one tick of that (an entity without `Walk` steps
  every tick); it returns true when already at the goal.
- `Hauler` `{ item, source, capacity, carry, rest, restOdds, restTicks }`: a worker that fetches
  `item` from `source` (an entity with `Inventory`) and carries it to its `Worker.job`.
- `haulSystem` (`haul`): a worker (`Worker`, `Hauler`, `Position`) whose job is missing or done
  takes the nearest unfinished `Construction` (Manhattan, ties to the lowest id; none: it idles).
  If resting it counts `rest` down; else with odds one in `restOdds` (an RNG draw) it rests 1 to
  `restTicks` ticks; else it walks next to its source and takes up to `capacity`, or, carrying,
  walks next to its job and adds `carry * rate` work (capped; `done` when complete).
- `addWork(world, site, amount)`: adds work to a `Construction` (capped; `done` when complete) and
  returns the progress before and after. The haulers' delivery and the RTS `constructSystem` both
  use it.
- `buildSystem` (`build`): a building's `Health.hp` follows its `Construction`:
  `max * progress / work` rounded down (at least 1), `max` once done. (The RTS does not run it:
  there `constructSystem` raises health as work is added, so damage stays.)
- `patrolSystem` (`patrol`): an entity with `Patrol` walks to its current waypoint (standing on
  it) and on arriving turns to the next one, looping.

## RTS units

`rts.ts` (Engine 0.9 T7; docs/BUILD-LOG.md, Engine 0.9, items 121-127) runs units from orders. It
is machinery like the other systems: every number is component data (copied from the game's unit
type data when a unit is made), all integer, no randomness, entities in id order, all state in
components. Run it with `components: [...STANDARD_COMPONENTS, Terrain, ...RTS_COMPONENTS]` and
`systems: RTS_SYSTEMS` (`gatherSystem`, `constructSystem`, `trainSystem`, then `moveSystem`,
`attackSystem`, `deathSystem`, in that order; the economy is in "RTS economy" below).

- **Orders** are plain JSON, defined once in `engine/core/orders.ts` (`orderSchema`, `Order`,
  `parseOrder`, re-exported here) so kits can make them without importing the sim (item 122):
  `{ id, faction, type, units: [ids], target? }`: a cell for `move`, an entity id for `attack`,
  none for `stop`; `build`, `train` and `gather` are in "RTS economy".
- `applyOrder(world, order)` (`rts-orders.ts`), between ticks: checks the shape, then the world
  (for a unit order, `unitOrderRefusal`: every unit exists,
  is a living `Unit` with `Position` and belongs to `faction`; a move target is on the map and
  enterable; an attack target is a living entity with `Health` and `Position`, not one of the
  ordered units and not of the order's faction). Refused: returns `{ ok: false, error }` (lines
  starting `order <id>:`, naming the field or the unit) and changes nothing; it never throws for
  a bad order, so a stale order from the view (its unit just died) is simply dropped by the
  caller. Accepted: `{ ok: true, order }`, and every change it makes is logged under the cause
  `order:<id>`: each unit's `Task` (and `Target` for `attack`; `move` drops `Target`; `stop`
  drops both); a worker taken off a build leaves its job (`Worker.job` null).
- `Unit` `{ type, speed, attack, range, cooldown, sight }`: `type` is the unit type it was made
  from, for the view (null by default; no system reads it). `speed` is ticks per straight cell of cost 1;
  entering a cell takes `speed * stepCost / STRAIGHT_COST` ticks rounded to nearest, at least 1
  (8-way costs: a diagonal is 14, a cell of cost c is c times as much). `range` and `sight` are
  whole cells of integer distance, `distFloor` (the floor of the straight-line distance;
  `inRange(a, b, range)`), so range 1 reaches all eight neighbours. `cooldown` is ticks from one
  hit to the next. `sight` is stored for the view and fog of war; no system reads it yet.
- `Task` `{ order, kind: "move" | "attack" | "build" | "gather", goal, target, path, flow }`: what
  a unit is doing; a `move` has a `goal` cell, the others a `target` entity. `path` is the rest of
  an A* way (planned on the first step, kept while its next cell is a legal step and it still ends
  at the goal, else planned again); `flow` is set when the order named `FLOW_GROUP_SIZE` (4) or
  more units: they read one shared 8-way `flowField` instead. `build` and `gather` tasks always
  have `flow` and walk by the 8-way field with `near` to the target's `Position`.
- `Target` `{ entity }`: what a unit fights. `Cooldown` `{ move, attack }`: ticks before the unit
  may step or hit again, present only while one is above 0. `Facing8` `{ dir }`: `STEPS_8` index
  (0 north, 1 north-east ... 7 north-west) of the last step or hit, for the view (`facingOf`).
- `moveSystem` (`move`): a unit with a `Task` cooling down counts down; else a move task at its
  goal is removed, an attack task whose target is gone or dead is removed (with `Target`), a unit
  within range of its target stands, and otherwise it steps one 8-way cell toward the goal (the
  target's cell), standing at its elevation, sets `Facing8` and starts its step cooldown. A
  `build` or `gather` task stands while its target is gone (the economy systems run first and drop
  or switch it) or within reach (`inReach`: on or next to the target's footprint, diagonals
  included). No way there: the task is dropped. Units do not block each other (stacking is
  allowed in 0.9), and buildings do not block units either (see "RTS economy").
- `attackSystem` (`attack`): every living `Unit` counts its attack cooldown down; else, unless on
  a move task, it hits its `Target` when within range: `Health.hp - attack` (not below 0), faces
  it, and starts its cooldown. A unit with no task keeps a target only while it is in range and
  otherwise picks the nearest enemy within range (another faction's living entity with `Owner`;
  nearest by squared distance, ties to the lowest id). Hits land at once, in id order.
- `deathSystem` (`death`): every `Unit` or `Building` at 0 hp is destroyed (each removal and the
  destroy are logged under `death`); a named squad member first leaves its squad (strength - 1,
  off `members`, not captain).
- **Heroes** (item 121) are ordinary units with a `Member` role `hero`; an order can name one
  alone. Nothing in the orders or systems tells them apart.
- Tests: `rts.test.ts` (move around a wall, speed and cell cost, a flow-field group, stop, no way;
  attack closes to range and kills, chasing, idle units fighting back, heroes ordered alone and
  leaving their squad on death; every refusal changes nothing; a two-sided battle gives the same
  hashes and log twice, causes only `order:<n>` or a system's name, and a save and load at seven
  ticks mid-battle steps on to the uninterrupted hashes). `engine/core/orders.test.ts` checks the
  order schema.

## RTS economy

`economy.ts` (Engine 0.9 T8; docs/BUILD-LOG.md, Engine 0.9, decisions 2 and 7) adds construction,
training and one gatherable resource, as machinery driven by data. Same rules as the units: all
integer, no randomness, entities in id order, all state in components.

- **Types are data, never code.** The unit and building types (stats, costs, build and training
  time, what a building trains, drop-offs) are the world's `RtsTypes` component, held by one entity
  like `Terrain` (the lowest id wins; `rtsTypesOf`), so it is saved and hashed with the world. Its
  schema is `rtsTypesSchema` in `engine/core/rts-types.ts` (shared with kits; in
  `docs/reference/schemas.md`). A scenario gives it as an entity's component data. Whatever is
  made from a type gets the type's numbers copied into its components, so later changes to the
  table never change existing units or buildings.
- `spawnUnit(world, faction, type, cell)`: `Position`, `Owner`, `Health` (full), `Unit` (with
  `type`), plus `Worker { job: null, rate: work }` when the type has `work` and `Gatherer` when it
  has `gather`. `placeBuilding(world, faction, kind, at, built?)`: `Position` (the north-west cell),
  `Owner`, `Building { kind, w, h, dropoff }` (`footprint.ts`), `Health`, `Producer` when the type
  trains anything, and unless `built` a site: `Construction` at 0 of the type's `work`, `Health.hp`
  1. Neither checks placement or cost; orders do.
- **Stockpiles.** A faction's resources are the `Inventory` of its `Stockpile { faction }` entity
  (`stockpileOf`: the lowest id). Costs are paid from it when an order is accepted; an order the
  faction cannot afford is refused (`faction "red" cannot afford barracks: needs 100 gold, has 40`)
  and changes nothing. There is no refund (no cancel order in 0.9).
- **Placement** (`placementRefusal`): every footprint cell on the map and enterable, none under
  another `Building`'s footprint or a `Resource` node. Buildings do not block movement in 0.9: the
  footprint is for placement and reach only (units stand on or next to it).
- Orders (`economyOrderRefusal`, then written under `order:<id>`):
  - `build` `{ units, target: cell, building }`: units are living units of the faction with
    `Worker`; the type exists, the placement is free and the faction can pay. It pays, places the
    site, and gives each unit `Worker.job` = the site and a `build` task on it.
  - `train` `{ units, target: unit type }`: `units` are buildings of the faction with a
    `Producer` whose `trains` lists the type, finished and standing; the faction pays the cost once
    per building. Each queues `{ unit, ticks: trainTicks }`.
  - `gather` `{ units, target: node }`: units with `Gatherer`, a `Resource` node, and a faction
    with a stockpile. Each unit's `Gatherer.node` is set (a load of another item is dropped) and it
    gets a `gather` task on the node.
- `Resource { item }`: a node; its `Inventory` holds what is left. `Gatherer { capacity, ticks,
node, item, carry, progress }`. `Producer { trains, queue: [{ unit, ticks }], progress }`.
- `gatherSystem` (`gather`): while the task targets the gatherer's node, next to it the unit takes
  one item every `ticks` ticks (an emptied node is destroyed); full, or with its node empty and a
  load, it turns to the nearest finished, standing drop-off (`Building.dropoff`) of its faction
  (none: it waits). Next to it, the load goes into the faction's stockpile and it turns back to
  its node, or the nearest other node of the same item (none: the task ends). Nearest is by
  squared distance to the footprint, ties to the lowest id.
- `constructSystem` (`construct`): a worker next to its site adds `Worker.rate` work (`addWork`),
  and the site's `Health.hp` rises by what that adds to `max * progress / work` (rounded down,
  capped at `max`), so damage taken while it goes up stays. A finished, dead or gone site ends the
  task (the worker leaves its job); the worker that finishes it ends its task at once.
- `trainSystem` (`train`): a finished, standing `Producer` spends one tick per step on the first
  queued unit; when its `ticks` are spent the unit appears (`spawnUnit`) on the first enterable
  cell of `ringAround` the footprint (the south side first, west to east, then east, north and
  west) and leaves the queue. No such cell: it waits there, done.
- Tests: `economy.test.ts` (a build placed, paid and finished on the tick its work says, workers
  walking up and sharing the work, a move order taking a worker off; refusals for cost, map edge,
  rock, overlaps, unknown types and non-workers that change nothing; training after the type's
  ticks with its cost charged, queues, a hall training workers, refusals; gathering raising the
  stockpile across two nodes and the gather rate; a whole economy scenario with the same hashes
  and log twice, and save and load mid-construction and mid-training stepping on to the same
  hashes), `footprint.test.ts` and `engine/core/rts-types.test.ts`.

## The sample world

`__fixtures__/village.world.json` is the Engine 0.8 proof: a 24x14 village with a river and two
bridges, hills, forest and rock; a woodpile, a hall and a granary going up, three workers (one
starts with no job) and a patrolling squad of 12 with four named members. It runs with
`[...STANDARD_COMPONENTS, Terrain, ...SYSTEM_COMPONENTS]`, systems `[haulSystem, buildSystem,
patrolSystem]` and `log: { ticks: 100 }`. The hall completes near tick 400 and the granary near
6,500; the squad walks its four waypoints the whole run.

- Run it: `pnpm test engine/sim/sample-world` (about 7 s). `sample-world.test.ts` runs 10,000
  ticks twice and compares state hashes (first 16 hex digits of the SHA-256 of `canonical()`)
  every 10 ticks; compares every 100th with the golden file `__fixtures__/village.hashes.json`;
  saves and loads (as text) at 83 ticks (0, 1, every 250th, 40 seeded random ones, 9,999 and
  10,000), checking save -> load -> save gives the same text and the hashes for 250 ticks after;
  runs to 10,000 from a few loads; and reloads at every one of those ticks in a single run. It
  also asserts the buildings complete, the woodpile is drawn down, the squad reaches every
  waypoint without entering river or rock, and workers rest at random.
- Exhaustive, opt-in: `WW_SAVE_EVERY_TICK=1 pnpm test engine/sim/sample-world` also saves and
  reloads at every one of the 10,001 ticks in one run (about two minutes; not on CI).
- After a change meant to change the sample's state, regenerate the golden file with
  `WW_UPDATE_GOLDEN=1 pnpm test engine/sim/sample-world` and commit it.

## Maths

`math.ts` (exported from `index.ts`) holds the replacements, all exact on every machine:

- Integers: `idiv(a, b)` and `imod(a, b)` (floored, `imod(-1, 4)` is 3), `clamp(v, lo, hi)`,
  `ipow(base, exp)` (throws past safe integers), `isqrt(n)` (largest `r` with `r * r <= n`).
- Grid distances: `distSq` (compare it instead of rooting it), `distFloor` (its `isqrt`),
  `manhattan`, `chebyshev`.
- Angles are binary: `ANGLE_STEPS` (256) is a full turn, `QUARTER_TURN` is 64, counted from +x
  toward +y; `wrapAngle` wraps any integer. `sinFixed(a)` and `cosFixed(a)` read a quarter-wave
  table in fixed point, `FIXED_ONE` (65536) = 1.0. `directionAngle(i, n)` and
  `directionVector(i, n, length)` give one of `n` even directions (4, 8, 16 and so on);
  `scaleFixed(f, v)` is `f * v / FIXED_ONE` rounded; `iatan2(y, x)` is the nearest angle step to a
  vector (integers within ±2^31).

## Rules

- Headless and deterministic: the same seed, components and systems give the same snapshots,
  every run.
- Imports only `engine/core` (plus `zod` for schemas). Never backends, `engine/tools`, kits or games.
- All randomness through the world's seeded RNG. No `Math.random`, no `Date.now` or
  `performance.now`, no DOM. This purity rule is lint-enforced on every file under `engine/sim/`
  (the `purity` block in `eslint.config.js`), and any `engine/core` file the sim imports at run time
  must be on `PURE_CORE` in `config/layers.js` (`tests/architecture/purity.test.ts` checks it).
- **No machine-dependent float maths.** `Math.sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`,
  `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, `exp`, `expm1`, `log`, `log1p`, `log2`,
  `log10`, `pow`, `cbrt` and `hypot` are not required to be correctly rounded, so their last bits
  can differ between engines and CPUs. They and the `**` operator are lint errors in every file
  under `engine/sim/`, tests included (`SIM_FORBIDDEN_MATH` and `SIM_MATH_DIRS` in
  `config/layers.js`, the `sim-math` block in `eslint.config.js`, checked by
  `tests/architecture/purity.test.ts`). Use `math.ts` instead. Exact `Math` functions stay
  allowed: `floor`, `ceil`, `round`, `trunc`, `abs`, `sign`, `min`, `max`, `sqrt` (correctly
  rounded by IEEE 754), `fround`, `imul`. Prefer integers for positions and amounts anyway.
- Component data is plain JSON-safe data: no classes, `Map`, `Set`, functions, `undefined` or
  non-finite numbers. No genre rules here: no game content, only the world's machinery.
- Tests run in Node with `pnpm test`, with no browser (`world.test.ts`, `events.test.ts`, `math.test.ts`,
  `components.test.ts`, `squad.test.ts`, `terrain.test.ts`, `save.test.ts`, `scenario.test.ts`,
  `path.test.ts`, `astar.test.ts`, `systems.test.ts`, `rts.test.ts`, `economy.test.ts`,
  `footprint.test.ts`, `sample-world.test.ts`).
