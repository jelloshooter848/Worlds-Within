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
- `systems.ts`: the `Walk` and `Hauler` components (`SYSTEM_COMPONENTS`), `walkToward` and the
  systems `haulSystem`, `buildSystem` and `patrolSystem` (see "Systems").
- `__fixtures__/village.world.json`: the sample world (see "The sample world"), with its golden
  hashes `village.hashes.json`, and `village-build.run.json`, a CLI run file on it (`pnpm cli run`;
  `engine/tools/CLAUDE.md`, World runs) with its golden `village-build.hashes.json`. Fixtures only:
  no game content anywhere else in the folder.
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
`passable`, `inBounds`, `cellIndex`, `cellAt`. Height is data only in 0.8 (item 101): it changes
no cost and there is no line of sight. Line-of-sight and height rules are for 0.9 onwards, in
integer maths, here in `engine/sim`.

## Scenarios

A scenario is a world written as data (`scenario.ts`). `worldFromScenario(json, options)` checks it
and returns the world at tick 0; every change it makes is logged with the cause `scenario`.
`options.components` defaults to `STANDARD_COMPONENTS` plus `Terrain` and must include `Terrain`
(and `Squad` and `Member` when there are squads); pass the systems and log retention the world
should run with.

```text
{ format: "worlds-within/scenario", version: 1, seed,
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
- `buildSystem` (`build`): a building's `Health.hp` follows its `Construction`:
  `max * progress / work` rounded down (at least 1), `max` once done.
- `patrolSystem` (`patrol`): an entity with `Patrol` walks to its current waypoint (standing on
  it) and on arriving turns to the next one, looping.

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
  `path.test.ts`, `systems.test.ts`, `sample-world.test.ts`).
