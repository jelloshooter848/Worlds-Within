# engine/sim

Folder: `engine/sim`. Detailed rules: [`engine/sim/CLAUDE.md`](../../engine/sim/CLAUDE.md).

## Purpose

The optional world simulation, headless and deterministic: entities, components, systems in a fixed
order, a seeded RNG per world and an integer tick (one tick is one world minute). The same seed and
systems give the same world on every run. Games that need a living world use it; simple games never
touch it.

## Public API entry points

From `engine/sim/index.ts`:

- `defineComponent(name, schema)`: a component kind (`ComponentDef<T>`) whose data matches a Zod
  schema and is plain JSON-safe data.
- `createWorld(seed, { components?, systems?, log? })` -> `World`:
  - `spawn()`, `destroy(id)`, `alive(id)`, `entities()`, `nextId`;
  - `registerComponent(def)`, `add(id, def | name, data)`, `update(id, def, fn)`, `get`, `has`,
    `remove`; stored data is frozen, so every change goes through these;
  - `query(...components)`: entities with all of them, always ascending by id;
  - `addSystem({ name, run })`, `systems()`, `step()` (systems in order, then `tick` + 1), `tick`;
  - `rng` (an `engine/core/rng.ts` `Rng`), `seed`;
  - `snapshot()` (the whole world as JSON-safe data) and `canonical()` (it as canonical JSON, for
    the tools to hash);
  - the event log: `events(sinceTick?)` lists every committed change as JSON-safe
    `{ tick, cause, op, entity, component?, before?, value? }` (`Change`; ops `spawn`, `destroy`,
    `add`, `set`, `remove`). A step's changes carry the running system's name and join the log when
    the tick commits; changes between ticks join at once with the cause from
    `withCause(cause, fn)` (`order:<id>`, `scenario`, `load`, ...) or `'external'`. Retention: all
    by default, `log: { ticks: n }` keeps the last `n` ticks, `log: { enabled: false }` none.
- Save and load (`save.ts`): `saveWorld(world)` -> the whole world as JSON-safe data (format
  `worlds-within/world`, version 1: seed, tick, RNG state, `nextId`, component kinds, system
  names, entities in id order with their components, the event log and its retention);
  `loadWorld(json, { components, systems? })` -> a `World` in the same state that steps on
  identically. Systems are code: pass the same list (checked by name). A bad save throws
  `SaveError` whose `issues` (and message) name each bad field (`entities.1.components.Health.hp`).
  `worldSaveSchema` is the file's Zod schema (documented in `docs/reference/schemas.md`).
- Scenarios (`scenario.ts`): `worldFromScenario(json, { components?, systems?, log? })` -> the
  `World` a world-start file describes (format `worlds-within/scenario`, version 1: seed, terrain
  as a text grid with a legend and a grid of elevation digits, entities with components, squads
  with named members; `{ "$ref": "<key>" }` in component data is another entity's id).
  `scenarioSchema`, `ScenarioError` (`issues` name each bad field).
- Walking (`path.ts`): `distanceField(t, goal, near)` and `nextStep(t, field, from)`, 4-way, each
  cell entered costing its type's cost, impassable cells never entered, ties north, east, south,
  west.
- Systems (`systems.ts`): components `Walk` `{ wait }` and `Hauler` `{ item, source, capacity,
carry, rest, restOdds, restTicks }` (`SYSTEM_COMPONENTS`), `walkToward`, and `haulSystem`
  (workers fetch from a source and carry it to the nearest unfinished building as work, resting at
  random through the world RNG), `buildSystem` (a building's health follows its progress) and
  `patrolSystem` (walk the waypoints in a loop).
- The sample world: `engine/sim/__fixtures__/village.world.json`, run by
  `pnpm test engine/sim/sample-world`: 10,000 ticks, the same hashes twice and as the golden file
  `village.hashes.json`, and a save and load at 83 ticks matching the uninterrupted run.
- On the CLI: `pnpm cli run engine/sim/__fixtures__/village-build.run.json` and
  `pnpm cli dump engine/sim/__fixtures__/village-build.run.json --tick N` play the sample world
  from a run file (`world` instead of `game`; see `docs/modules/engine-tools.md`).
- Deterministic maths (`math.ts`): `idiv`, `imod`, `clamp`, `ipow`, `isqrt`; `distSq`, `distFloor`,
  `manhattan`, `chebyshev`; binary angles (`ANGLE_STEPS` = 256 per turn) with fixed-point
  `sinFixed`/`cosFixed` (`FIXED_ONE` = 65536), `directionAngle`, `directionVector`, `scaleFixed`
  and `iatan2`.

- Standard components (`components.ts`, all in `STANDARD_COMPONENTS`): `Position` `{ x, y, z }`
  (integers, `z` defaults to 0), `Health` `{ hp, max }`, `Owner` `{ faction }`, `Inventory`
  (item id -> integer count, keys sorted; `inventoryAdd(world, id, item, delta)`),
  `Construction` `{ kind, progress, work, done }`, `Worker` `{ job, rate }`, `Patrol`
  `{ waypoints, index }`, `Squad` `{ strength, captain, members }` and `Member`
  `{ name, squad, role }` (`ROLES`: `regular`, `hero`, `captain`).
- Squads (`squad.ts`): `squadStrength(world, squad)` (one number for the RTS view),
  `squadMembers(world, squad)` (named people, ascending id), `pickMembers(world, squad, n, rng)`
  (deterministic for an RNG state), `joinSquad(world, squad, person)`, `applyLosses(world, squad,
n)` and `lossOrder(world, squad)`. Loss order: unnamed first, then regulars, heroes, the captain
  last; newest (highest id) first within a role.
- Terrain (`terrain.ts`): the `Terrain` component `{ width, height, types, elevation, cells }`
  held by one entity; `flatTerrain`, `terrainOf`, `terrainEntity`, `heightAt(t, x, y)` (integer
  elevation), `typeAt`, `moveCost` (null when impassable or off the grid), `passable`, `inBounds`,
  `cellIndex`, `cellAt`. Height is data only in 0.8; line of sight comes in 0.9 or later.

## Imports allowed

- `engine/core` only, and only `PURE_CORE` files at run time; `zod` for component schemas.
- Never backends, `engine/tools`, kits or games.
- All randomness through the world's seeded RNG; no `Math.random`, wall-clock time or DOM
  (lint-enforced).
- No floating-point maths that can differ between machines: `Math.sin`, `cos`, `tan`, `atan2`,
  `exp`, `log`, `pow`, `hypot` and the rest of `SIM_FORBIDDEN_MATH` (`config/layers.js`), and the
  `**` operator, are lint errors in `engine/sim/` whose message points at `engine/sim/math.ts`.
  Exact functions (`floor`, `trunc`, `abs`, `min`, `max`, `sqrt`, ...) stay allowed.

## How to test

`pnpm test` runs `engine/sim/world.test.ts` in Node, with no browser: same seed gives identical
snapshots, iteration is ascending by id after destroy and spawn, and RNG draws differ by seed.
`engine/sim/events.test.ts` checks the event log: attribution to systems, external causes between
ticks, nothing visible before commit, retention, and an identical log across two same-seed runs. `engine/sim/math.test.ts` checks the maths helpers give exact
integer results and that the sine table is symmetric; `tests/architecture/purity.test.ts` checks
the lint rule fires on sim files. `components.test.ts` checks each standard schema,
`squad.test.ts` squad strength against named members, seeded picking and the loss order, and
`terrain.test.ts` height lookup, movement cost and grid validation. `save.test.ts` checks that save ->
load -> save gives the same canonical JSON, that a world loaded at tick N gives the same snapshots
for the next ticks as the uninterrupted one, that RNG state, `nextId`, tick and log survive, and
that malformed saves fail naming the field.
