# engine/sim

Folder: `engine/sim`. Detailed rules: [`engine/sim/CLAUDE.md`](../../engine/sim/CLAUDE.md).

## Purpose

The optional world simulation, headless and deterministic: entities, components, systems in a fixed
order, a seeded RNG per world and an integer tick (one tick is one world minute). The same seed and
systems give the same world on every run. Games that need a living world use it; simple games never
touch it. From Engine 0.10 it also runs time (world, experience and commitment time, and frozen
events), the mission lifecycle (open, delegate or play, commit at a fixed world-time cost, with
append-only records and no retries) and opportunities (windows that open and close in world time).
From Engine 0.13 named individuals carry a fate (injured, captured, freed or dead) that survives
battle, save and load, and a mission's `fate` effect sets it at the commit; a capture opens its
follow-ups (rescue, exchange, leave behind) with ordinary `opportunity` effects.

## Public API entry points

From `engine/sim/index.ts`:

- `defineComponent(name, schema, { omitWhenEmpty? })`: a component kind (`ComponentDef<T>`) whose
  data matches a Zod schema and is plain JSON-safe data; `omitWhenEmpty` keeps an unused kind out
  of snapshots and saves.
- `createWorld(seed, { components?, systems?, log? })` -> `World`:
  - `spawn()`, `destroy(id)`, `alive(id)`, `entities()`, `nextId`;
  - `registerComponent(def)`, `registered(def | name)`, `add(id, def | name, data)`, `update(id, def, fn)`, `get`, `has`,
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
  `worldSaveSchema` is the file's Zod schema (documented in `docs/reference/schemas.md`);
  `changeSchema` is one event log entry's.
- Scenarios (`scenario.ts`): `worldFromScenario(json, { components?, systems?, log? })` -> the
  `World` a world-start file describes (format `worlds-within/scenario`, version 1: seed, terrain
  as a text grid with a legend and a grid of elevation digits, entities with components, squads
  with named members; `{ "$ref": "<key>" }` in component data is another entity's id).
  `scenarioSchema`, `ScenarioError` (`issues` name each bad field). A scenario may name an engine
  system set in `systems` (`village` or `rts`), which it runs with when the caller passes no
  components or systems of its own. An optional `opportunities` list (Engine 0.10) adds
  opportunity windows to the world it builds (see Opportunities below), and an optional `from`
  (Engine 0.13) names the scenario it follows.
- Carry-over (`carry.ts`, Engine 0.13): `carriedRecord(world, from, keys)` -> the plain JSON
  carried record (`worlds-within/carried`, version 1: the carried people's fate and `Health`, by
  key, and stockpile item counts, keys sorted) built from a first scenario's end world by the
  second scenario's `from.carry` spec; `worldFromScenario(json, { carried })` applies it at tick 0
  under the cause `carry` (a captured or dead person starts off the map, an injured one at their
  hp, capped at the scenario's `max`; stockpile items replaced; `from.when` rules open dormant
  opportunities for a carried fate). `carriedRecordSchema`, `carryFromSchema`, `carrySpecSchema`,
  `CARRY_CAUSE`. Bad data throws `ScenarioError` with paths under `from` or `carried`.
  `startFate(world, id, state, { cause, by, at })` gives a fresh person a fate reached elsewhere.
- System sets (`system-sets.ts`, Engine 0.9): `SYSTEM_SETS` (`village`: standard components,
  `Terrain`, `SYSTEM_COMPONENTS` with haul, build, patrol; `rts`: standard components, `Terrain`,
  `RTS_COMPONENTS` with `RTS_SYSTEMS`), `SYSTEM_SET_NAMES`, `DEFAULT_SYSTEM_SET` (`village`, what
  the tools' world runs use when a scenario names none). Both register `TIME_COMPONENTS` too.
- Time and frozen events (`time.ts`, Engine 0.10): `timeOf(world)` -> `TimeService` reads **world
  time** (`world`, the tick), **experience time** (`experience(mission)`, `open()`: ticks spent
  inside an open mission, never moving the world) and **commitment time** (`commitment(mission)`,
  `commitments()`: the append-only `{ mission, opened, tick, experience }` records), plus
  `frozen()` and `isFrozen(id)`. Writes: `startExperience`, `addExperience`, `stampCommitment`,
  `freezeEvent`, `unfreezeEvent` (each `{ ok: true }` or `{ ok: false, code, error }`, logged under
  the cause given) and `joinEvent`, `leaveEvent`, `eventMembers`. An event is the entities with
  `EventMember { event }`; while it is frozen, `move`, `attack` (and the cooldown countdown),
  `death` and `patrol` skip its members, no unit attacks one, and its workers' `haul`, `gather` and
  `construct` wait, while `build`, `train` and everyone outside the event run on. The state is
  world data (`EventMember`, and `WorldTime` on one world-level entity), in snapshots and saves
  only once used, so existing golden hashes do not move.
- Missions (`mission.ts`, Engine 0.10 T4): the lifecycle of a mission (`MissionDef` from
  `engine/core/missions.ts`). `openMission(world, def, { refs? })` checks the def, records it with
  its outcome space, fixed `worldTimeCost`, open tick and commit tick (open + cost), starts its
  experience clock, freezes its `event` and returns `{ ok, mission, openTick, commitTick,
snapshot }` (the plain world snapshot a kit's adapter reads). `delegateMission(world, id)` draws
  one declared outcome (`int(totalWeight)`, walked in file order) from the mission's own generator,
  `Rng.derived(world.seed, 'mission:<id>')`, never `world.rng`, so the tick it happens at moves no hash;
  `playMission(world, id, outcomeId | report)` takes only a declared (and playable) outcome;
  `quitMission` takes `onQuit`. `commitMission(world, id, result?)` steps the world to the commit
  tick (committing any other mission due on the way), delegates an unresolved mission then
  (`timeout`), and under `mission:<id>` applies the outcome's effects, unfreezes the event, stamps
  the commitment and appends a frozen `MissionRecord`. A `fate` effect (Engine 0.13) moves a named
  person's fate with `setFate` under `mission:<id>`; one that cannot apply (the person gone, not
  named, already dead, or a `freed` cell that cannot be entered) is skipped and listed in the
  record's `skipped`, never an error. A `damage` effect with `fromReport` (Engine 0.13, M13) takes
  its amount from that stat of the played round's report (0 skips it; the declared `amount` when
  delegated, quit or timed out), so a round's hero brings its world hp loss back. A mission with no `play` is a choice: `playMission` and
  `quitMission` refuse it (`not_playable`), so it is only delegated. `openMission` refuses an
  outcome that opens an opportunity for the same mission (`reopens_self`: no do-overs). `settleMissions(world)` commits whatever is
  due by now (commit tick, then id order, the same order `commitMission` uses), for callers that
  step the world themselves; an overdue mission commits on the next settle and can no longer be
  resolved (`mission_overdue`). Retrying, replaying, reopening or
  recommitting is refused (`mission_committed`, `mission_resolved`) with a one-line reason and
  changes nothing. Read with `missionsOf(world)` (`open`, `committed`, `record`, `status`). The
  state is the `Missions` component (`MISSION_COMPONENTS`, on the `WorldTime` entity,
  `omitWhenEmpty`), so a world without missions hashes as before.
- Live hosting (`mission-port.ts`, Engine 0.11 T5, item 173): `missionPort(world, { refs? })` is
  the `MissionWorldPort` an `engine/core` `MissionHost` drives (`open` = `openMission` plus the
  round's seed `roundSeed(seed, id)`, `Rng.derived(seed, "round:<id>").next()`; `delegate`,
  `play` with the result's report, `quit`, `settle` = `settleMissions`, `snapshot`, `step`), so a
  game's glue fills it with one call. Refusals keep the sim's codes. From Engine 0.14 T7 it also
  gives `events` (`eventsSince`) and `timeline` (`worldTimeline` with the host's experience), and
  from Engine 0.15 T6 `records` (the committed records, for the host's `mission-commit` events).
- The RTS kit's port (`rts-port.ts`, Engine 0.15 T6, gap M27): `rtsWorldPort(world)` is the
  kit's `RtsWorldPort` over a world (`snapshot`, `applyOrder` keeping only the refusal's `error`,
  `step`), typed by shape (`RtsPort`) since the sim may not import the kit:
  `rtsGame({ world: rtsWorldPort(world), enemy, seed })`.
- Opportunities (`opportunity.ts`, Engine 0.10 T5): windows of world ticks in which a mission can
  be taken (`OpportunityDef` `{ id, mission, opens, closes, exclusive?, closesOthers?, relative? }`
  and `opportunitySchema` from `engine/core/missions.ts`; offered while `opens <= tick < closes`).
  `addOpportunities(world, defs, cause)` adds them (also from a scenario's `opportunities`);
  `settleOpportunities(world)` is the time-service hook that opens and closes windows as world time
  passes, logged under `time` (`settleMissions` and `commitMission` call it after every step, so
  windows pass during a mission's world-time cost too). A mission named by an opportunity opens
  only while one is offered (else `opportunity_closed`); opening it takes the opportunity
  (`taken`) and closes, under `mission:<id>`, the others of the same mission, its `exclusive` group
  and its `closesOthers`. An `opportunity` effect `{ open }` starts a `relative` (dormant) window
  counted from the commit tick, or offers a waiting one early; `{ close }` closes one; an effect on
  one already taken or closed is skipped. Read with `opportunitiesOf(world)` (`all`, `get`,
  `status`, `offered`). The state is the `Opportunities` component (`OPPORTUNITY_COMPONENTS`, on
  the `WorldTime` entity, `omitWhenEmpty`), in snapshots and saves.
- Timeline (`timeline.ts`, Engine 0.14 T7): `timelineOf({ world, events?, logFrom?, clock?,
experience? })` -> the timeline record (`worlds-within/timeline`, version 1, `timelineSchema`, in
  `docs/reference/schemas.md`): the world tick, the oldest tick the log keeps (`logFrom`), a game
  run's `clock` (world tick per game tick, run-length; `compressClock`, `gameTickOf`), frozen
  spans `{ event, by, from, to }`, experience per mission, opportunity windows with their status
  history and causes, and the missions opened and committed (outcome, resolution, open and commit
  ticks). A pure reader over a world's plain data (a snapshot or save and its event log): it never
  steps or changes a world. `worldTimeline(world, opts?)` reads a live world;
  `eventsSince(world, sinceTick)` -> `{ from, tick, changes }` is its log as a game hands it over
  (`HeadlessGame.worldEvents`); `logFrom(world)`; `timelineEntries(record)` lists the happenings
  by tick. `missionPort` gives a `MissionHost` both, so `pnpm cli events` and `pnpm cli timeline`
  read a mission game's world.
- Walking (`path.ts`): `distanceField(t, goal, near)` and `nextStep(t, field, from)`, 4-way, each
  cell entered costing its type's cost, impassable cells never entered, ties north, east, south,
  west.
- Pathfinding (`astar.ts`, Engine 0.9): `findPath(t, from, goal, { neighbourhood?, maxExpanded? })`
  -> `{ cells, cost, expanded }` or null (A* for one unit, a cap on expanded cells, fixed
  tie-breaking), and `flowField(t, goal, { neighbourhood?, near? })` with `flowStep(t, field, from)`
  for a group sharing a goal (`FLOW_GROUP_SIZE`, 4, units or more). Neighbourhood 4 (default, the
  same as `distanceField`) or 8: straight steps cost `STRAIGHT_COST` (10) and diagonals
  `DIAGONAL_COST` (14) times the cell's cost, no corner cutting, ties N, NE, E, SE, S, SW, W, NW
  (`STEPS_8`); `stepCost` is one move's cost.
- Systems (`systems.ts`): components `Walk` `{ wait }` and `Hauler` `{ item, source, capacity,
carry, rest, restOdds, restTicks }` (`SYSTEM_COMPONENTS`), `walkToward`, `addWork`, and `haulSystem`
  (workers fetch from a source and carry it to the nearest unfinished building as work, resting at
  random through the world RNG), `buildSystem` (a building's health follows its progress) and
  `patrolSystem` (walk the waypoints in a loop).
- RTS units (`rts.ts`, `rts-orders.ts`, Engine 0.9): orders as plain JSON (`orderSchema`, `Order`,
  `parseOrder`, defined in `engine/core/orders.ts` and re-exported: `move` to a cell, `attack` an
  entity, `stop`, and the economy's `build`, `train`, `gather`)
  and `applyOrder(world, order)` -> `{ ok: true, order }` or `{ ok: false, error }` (checked
  against the world: units exist, are living units of the order's faction, targets are valid;
  a refused order changes nothing), writing under the cause `order:<id>`. Components `Unit`
  `{ speed, attack, range, cooldown, sight }`, `Facing8` `{ dir }`, `Task`
  `{ order, kind, goal, target, path, flow }` (kinds `move`, `attack`, `build`, `gather`),
  `Target` `{ entity }` and `Cooldown` `{ move, attack }` (`UNIT_COMPONENTS`); systems
  `moveSystem` (8-way A*, or a shared flow field for a group of 4 or more; speed in ticks per
  cell; builders and gatherers walk up next to their target), `attackSystem` (range in integer
  distance, `inRange`; cooldown; nearest enemy for idle units, ties to the lowest id) and
  `deathSystem` (in `fate.ts`: dead units and buildings destroyed; a named person who dies leaves
  their squad and the map and is kept as a dead record). `facingOf`.
  Heroes are ordinary units an order can name alone.
- RTS economy (`economy.ts`, `footprint.ts`, Engine 0.9): unit and building types as data, the
  world's `RtsTypes` component (schema `rtsTypesSchema` from `engine/core/rts-types.ts`: stats,
  costs, build and training time, what a building trains, drop-offs); a faction's resources in
  the `Inventory` of its `Stockpile` `{ faction }`; `Building` `{ kind, w, h, dropoff }` (a
  footprint from its north-west cell), `Resource` `{ item }` nodes, `Producer`
  `{ trains, queue, progress }` and `Gatherer` `{ capacity, ticks, node, item, carry, progress }`
  (`ECONOMY_COMPONENTS`); `spawnUnit` and `placeBuilding` copy a type's numbers in. Orders: `build`
  (workers, a cell and a building type: placement and cost checked, paid, a site placed),
  `train` (buildings and a unit type: paid per building, queued) and `gather` (gatherers and a
  node); refused orders change nothing. Systems `gatherSystem` (one item per `ticks` next to a
  node, loads carried to the nearest drop-off into the stockpile, the next node taken when one
  runs dry), `constructSystem` (workers next to a site add their rate as work, `addWork`, and
  raise its health) and `trainSystem` (the first queued unit appears next to the building after
  its ticks). `RTS_COMPONENTS` (both sets) and `RTS_SYSTEMS` (gather, construct, train, move,
  attack, death, in that order) are in `rts-orders.ts`.
- Fates (`fate.ts`, Engine 0.13): the `Fate` component `{ state, by, at, held, history }`
  (`FATE_COMPONENTS`, `omitWhenEmpty`, registered by both system sets; no `Fate` means active) on
  a named person (`Member`). States only move forward (active or freed -> injured; -> captured;
  captured -> freed; any living state -> dead, which is final); `history` is append-only.
  `fateOf(world, id)` and `namedPeople(world)` read; `setFate(world, id, state, { cause, by?, at?,
cell? })`, `injurePerson`, `capturePerson`, `killPerson` and `freePerson(world, id, cell, cause,
by?)` write between ticks under the cause given and return `{ ok: true, fate }` or a refusal
  (`bad_id`, `not_named`, `fate_final`, `bad_cell`, `stepping`) that changes nothing. A captured
  or dead person loses `MAP_COMPONENTS` (`Position`, `Unit`, `Task`, `Target`, `Cooldown`,
  `Facing8`, `Worker`, `Gatherer`, `EventMember`) and leaves their squad (`leaveSquad`, in
  `squad.ts`: strength - 1, off `members` and `captain`) but stays in the world; a captured
  person's `Unit` and `Owner` are kept in `held` so `freePerson` can put them back on a cell.
- The sample world: `engine/sim/__fixtures__/village.world.json`, run by
  `pnpm test engine/sim/sample-world`: 10,000 ticks, the same hashes twice and as the golden file
  `village.hashes.json`, and a save and load at 83 ticks matching the uninterrupted run.
- On the CLI: `pnpm cli run engine/sim/__fixtures__/village-build.run.json` and
  `pnpm cli dump engine/sim/__fixtures__/village-build.run.json --tick N` play the sample world
  from a run file (`world` instead of `game`; see `docs/modules/engine-tools.md`).
- A recorded battle: `engine/sim/__fixtures__/battle.world.json` (an `rts` scenario: a red base
  with a hall, a gold node, two workers and a soldier; three blue units) and `battle.run.json`, its
  seven recorded orders (gather, build a barracks, train, move, attack) with sync hashes every 20
  ticks. `pnpm -s cli run engine/sim/__fixtures__/battle.run.json` replays it headless to the same
  hashes; a changed order fails at the first sync hash that differs.
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
  `cellIndex`, `cellAt`. Height is data only (0.8, and still in 0.9); line of sight comes later.
- The key table (`keys.ts`, Engine 0.15 T7, gaps M10, D6, M28): `worldKeys(world)` is every
  scenario key and its entity id, kept beside the world by `worldFromScenario` and `loadWorld`
  (the save's optional `keys`), never in the snapshot, so no hash moves. `missionPort(world)`
  opens missions with it as `refs` (the open mission's `refs` stay the keys its effects name) and
  hands the whole table to the round (`open`'s `keys`, `keys()`); `missionRecords(world)` is the
  committed records in commit order.

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
that malformed saves fail naming the field. `scenario.test.ts` checks world scenarios (ids, `$ref`,
squads, errors naming the field), `path.test.ts` walking costs and tie order, `astar.test.ts` A*
(cheapest paths, no rock or corner cutting, null with no way, same ties every run), a group on a
flow field and the A* vs flow field measurement, `systems.test.ts` hauling, building and
patrols, `rts.test.ts` orders, movement, combat and deaths (refused orders change nothing, a battle
repeats its hashes and survives a save and load mid-battle, a named hero who dies is kept as a dead
record), `fate.test.ts` each fate, refusals changing nothing, a battle with a named death and a
capture and release giving the same hashes every run and through save and load at six ticks, `economy.test.ts` building (paid,
placed, finished after its work ticks; refused for cost or blocked placement, changing nothing),
training (after the type's ticks, cost charged), gathering (the stockpile rises) and an economy
scenario with the same hashes twice and through a save and load mid-construction and
mid-training, `footprint.test.ts` the footprint helpers, and `sample-world.test.ts` the Engine 0.8 proof: the village runs 10,000 ticks with the same hashes twice and as the golden file, and survives a save and load at 83
ticks (`WW_SAVE_EVERY_TICK=1` reloads at every tick, about two minutes).
`engine/tools/world-run.test.ts` checks `run` and `dump` on a world run file. `time.test.ts` checks
the time service and the battle fixture with its battle frozen: a barracks finishes while the
battle's units keep their `Position`, `Health` and `Cooldown`, freeze and unfreeze are logged with
their cause, the battle resumes after, and a save and load mid-freeze gives equal hashes.
`mission.test.ts` checks the mission lifecycle: partial success applying only its effects, failure
with every retry refused, delegation repeatable from the seed and matching its weights over 4,000
seeds, any declared outcome playable and undeclared ones refused, the same hash after commit
however many experience ticks pass inside, and committed records unchanged across later ticks and
a save and load. `opportunity.test.ts` checks opportunities: a window opening and closing by time
(logged under `time`), a take closing its rival (logged under `mission:<id>`), a closed or unopened
opportunity refused, a mission's world-time cost carrying the world past another window's close, a
failure opening a follow-up rescue, the same hashes on every run and through save and load at five
ticks, and scenario opportunities. `mission-fate.test.ts` (Engine 0.13) checks fate effects and
capture follow-ups over `__fixtures__/captive.world.json`: a delegated capture opening the rescue,
exchange and leave-behind, taking one closing the others, a failed rescue committed as an ordinary
outcome that opens the ransom and never the rescue again, a rescue freeing the captive with his hp
kept, skipped fate effects, the refusals at open, the same hashes every run and through save and
load, and records unchanged after save and load. Its run files (`capture-rescue`,
`capture-rescue-failed`, `capture-exchange`, `capture-leave`) are checked with golden hashes by
`tests/runs/missions.test.ts`. `carry.test.ts` (Engine 0.13) checks carry-over from the captive
fixture's end into `captive-after.world.json`: the record, each fate carried in, equal start hashes
every run and through save and load, two records differing in one person's fate giving start
worlds differing only in that person, and path-named errors.
