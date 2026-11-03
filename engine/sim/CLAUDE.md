# engine/sim

The optional world simulation (from Engine 0.8): the world as data, with no graphics. Games that
need a living world use it; simple games never touch it. The ECS is our own small one (decision in
`docs/BUILD-LOG.md`, Engine 0.8, item 99); one tick is one world minute (item 100).

## Files

- `component.ts`: `defineComponent(name, schema, { omitWhenEmpty? })` -> `ComponentDef<T>`, a
  component kind with the Zod schema its data must match (`omitWhenEmpty`: see "Time").
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
  schema `scenarioSchema`, `ScenarioError` and `scenarioKeys(json)` (each `key`'s entity id, for a
  mission's `refs`) (see "Scenarios" below).
- `path.ts`: integer walking on the terrain grid, `distanceField` and `nextStep` (see "Walking").
- `astar.ts`: RTS pathfinding, `findPath` (A*) for one unit and `flowField`/`flowStep` for a
  group, 4-way or 8-way (see "Walking").
- `systems.ts`: the `Walk` and `Hauler` components (`SYSTEM_COMPONENTS`), `walkToward`, `addWork`
  and the systems `haulSystem`, `buildSystem` and `patrolSystem` (see "Systems").
- `rts.ts`: RTS units (Engine 0.9): the components `Unit`, `Facing8`, `Task`, `Target` and
  `Cooldown` (`UNIT_COMPONENTS`), the unit order checks and writes, and the systems `moveSystem`
  and `attackSystem` (see "RTS units").
- `economy.ts`: the RTS economy (Engine 0.9 T8): the components `RtsTypes`, `Stockpile`,
  `Resource`, `Producer` and `Gatherer` (`ECONOMY_COMPONENTS`, with `Building`), `spawnUnit`,
  `placeBuilding`, the economy order checks and writes, and the systems `gatherSystem`,
  `constructSystem` and `trainSystem` (see "RTS economy").
- `footprint.ts`: the `Building` component and footprint helpers (`footprintOf`, `inReach`,
  `inRect`, `rectsOverlap`, `ringAround`), shared by the two above.
- `rts-orders.ts`: `applyOrder` for every order type, `RTS_COMPONENTS` (the unit, economy and
  fate components) and `RTS_SYSTEMS` (the economy's systems, then the units', in that order).
- `fate.ts`: fates of named individuals (Engine 0.13 T2): the `Fate` component
  (`FATE_COMPONENTS`, `omitWhenEmpty`), `FATE_STATES`, `MAP_COMPONENTS`, `fateOf`, `namedPeople`,
  `setFate` and its helpers `injurePerson`, `capturePerson`, `killPerson`, `freePerson`, and
  `deathSystem` (moved here from `rts.ts`: it keeps a named person who dies as a dead record) (see
  "Fates" below). `startFate` (Engine 0.13 T5) gives a fresh person a fate reached in another
  world (carry-over).
- `carry.ts`: carry-over (Engine 0.13 T5): `carriedRecord(world, from, keys)`, the schemas
  `carryFromSchema` (a scenario's `from`), `carrySpecSchema` and `carriedRecordSchema`,
  `CARRIED_FORMAT`, `CARRIED_VERSION`, `CARRY_CAUSE` (`carry`), and the checks and apply step
  `worldFromScenario` uses (see "Carry" below).
- `scenario-error.ts`: `ScenarioError` and `ScenarioIssue` (re-exported by `scenario.ts`), in a file
  of their own so `carry.ts` and `scenario.ts` do not import each other.
- `system-sets.ts`: named system sets (Engine 0.9 T9, items 118 and 132): `SYSTEM_SETS`
  (`village`: `[...STANDARD_COMPONENTS, Terrain, ...SYSTEM_COMPONENTS]` with `haulSystem`,
  `buildSystem`, `patrolSystem`; `rts`: `[...STANDARD_COMPONENTS, Terrain, ...RTS_COMPONENTS]` with
  `RTS_SYSTEMS`), `SYSTEM_SET_NAMES` and `DEFAULT_SYSTEM_SET` (`village`). A scenario names one in
  `systems` (Scenarios, below). Both sets also register `TIME_COMPONENTS`, `MISSION_COMPONENTS` and `OPPORTUNITY_COMPONENTS` (Engine 0.10), which
  stay out of snapshots until used, and `FATE_COMPONENTS` (Engine 0.13; `rts` through
  `RTS_COMPONENTS`), also left out until used.
- `time.ts`: the time service and frozen events (Engine 0.10 T3): `EventMember`, `WorldTime`
  (`TIME_COMPONENTS`), `timeOf`, `freezeEvent`/`unfreezeEvent`, `joinEvent`/`leaveEvent`,
  `eventMembers`, `frozenCheck`, `startExperience`, `addExperience`, `stampCommitment` (see
  "Time" below).
- `mission.ts`: the mission lifecycle (Engine 0.10 T4): `Missions` (`MISSION_COMPONENTS`),
  `openMission`, `delegateMission`, `playMission`, `quitMission`, `commitMission`,
  `settleMissions`, `missionsOf`, `missionSnapshot` (see "Missions" below).
- `mission-port.ts`: `missionPort(world, { refs? })` (Engine 0.11 T5, item 173), the
  `MissionWorldPort` an `engine/core` `MissionHost` drives (see "Missions", Live hosting), and
  `roundSeed(seed, id)`.
- `opportunity.ts`: opportunities (Engine 0.10 T5): `Opportunities` (`OPPORTUNITY_COMPONENTS`),
  `addOpportunities`, `settleOpportunities`, `opportunityGate`, `takeOpportunity`,
  `applyOpportunityEffect`, `opportunitiesOf` (see "Opportunities" below).
- `__fixtures__/village.world.json`: the sample world (see "The sample world"), with its golden
  hashes `village.hashes.json`, and `village-build.run.json`, a CLI run file on it (`pnpm cli run`;
  `engine/tools/CLAUDE.md`, World runs) with its golden `village-build.hashes.json`; and
  `battle.world.json`, a tiny `rts` battle, with `battle.run.json`, its recorded orders and sync
  hashes (`engine/tools/CLAUDE.md`, Recorded orders), and the golden `battle.hashes.json`; and
  (Engine 0.10 T6) `siege.world.json`, an `rts` world with a battle event `siege` (red soldiers and
  three blue siege engines keyed `ram`, `tower`, `catapult`, all `EventMember`s), a barracks site
  outside it with its builder, and four opportunities (`night-raid` and `supply-run` in one
  `exclusive` group, a `relative` `rescue-window`, `scout-gap` closing at 25), with the missions
  `raid` (event `siege`, cost 30; `clean`, `partial`, `repelled` opening the rescue), `convoy`,
  `rescue` and `scout` as `*.mission.json`, and the run files `raid-partial`, `raid-failure`,
  `opportunity-closing`, `frozen-construction`, `raid-delegated`, `fixed-cost-few` and
  `fixed-cost-many` with their golden `.hashes.json` (`engine/tools/CLAUDE.md`, Missions in world
  runs; Engine 0.10's done-when cases, checked by `tests/runs/missions.test.ts`); and (Engine 0.13
  T3) `captive.world.json`, a small `rts` world with the village's stockpile (`hall`, 200 gold) and
  a squad `guard` whose named captain `captain` (Hale) and hero `sergeant` (Mara) stand on the map,
  and five opportunities: `ambush-window` (absolute) and the dormant `relative` follow-ups
  `rescue-window`, `exchange-window` and `leave-window` (one `exclusive` group, `captive`) and
  `ransom-window`; with the missions `ambush` (cost 10; `taken` damages and captures the captain
  `by` raiders and opens the three follow-ups; delegated it draws `taken` for the seed),
  `rescue-captain` (played or delegated; `freed` frees him at (1, 1), `failed` injures the sergeant
  and opens `ransom-window`), and the choices with no `play` `exchange-captain` (80 gold and
  `freed`), `leave-captain` (no effects: the capture stands) and `ransom-captain` (150 gold and
  `freed`); and the run files `capture-rescue`, `capture-rescue-failed`, `capture-exchange` and
  `capture-leave` with their golden `.hashes.json`, checked by `tests/runs/missions.test.ts`.
  And (Engine 0.13 T5) `captive-after.world.json`, the captive world's follow-up: its `from` names
  `captive` and carries the `captain` and the `sergeant` (Health and fate) and the village's gold,
  and a `when` rule opens its dormant `rescue-window`, `exchange-window` and `leave-window` when
  the captain comes in captured (`carry.test.ts`).
  Fixtures only: no game content anywhere else in the folder.
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
  live state. Every registered kind is listed, empty or not, except one defined with
  `omitWhenEmpty: true` that no entity has (`registered(c)` says whether a kind is registered). `canonical()` is that snapshot as canonical JSON (`canonicalJson` from
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
- **Components**: every kind the save lists must be in `components` (extra kinds start empty).
  The save lists the snapshot's kinds plus any `omitWhenEmpty` kind the kept log still names;
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

## Time

The time service and frozen events (`time.ts`, Engine 0.10 T3; docs/BUILD-LOG.md, Engine 0.10,
items 150-152). The mission lifecycle ("Missions" below) is built on it.

- **World time** is the world's `tick` (`timeOf(world).world`). Only `step()` moves it.
- **Experience time** is the ticks spent inside an open mission: `startExperience(world, mission,
cause)` opens the mission's clock at the current tick with 0 ticks, `addExperience(world,
mission, ticks, cause)` adds to it. It never moves the world: ten ticks or ten thousand leave
  `tick` where it was. Read with `timeOf(world).experience(mission)` (null when not open) and
  `.open()`.
- **Commitment time** is the tick a mission's result is committed at:
  `stampCommitment(world, mission, cause, tick = world.tick)` closes the clock and appends
  `{ mission, opened, tick, experience }` to the commitments (`timeOf(world).commitment(mission)`,
  `.commitments()` in commit order). The list is append-only: a mission commits once, and opening,
  adding to or committing a committed mission is refused (`mission_committed`).
- **Frozen events.** An event is the entities with `EventMember { event }` (`joinEvent`,
  `leaveEvent`, `eventMembers`; or written in a scenario). `freezeEvent(world, event, cause)` holds
  it still until `unfreezeEvent(world, event, cause)`; `timeOf(world).frozen()` lists
  `{ event, by, since }` (`by` is the cause that froze it). An event freezes once
  (`event_frozen`). Systems build `frozenCheck(world)` once per run and skip what it says:
  - **skip frozen entities:** `move` and `attack` (no step, no hit and no cooldown countdown;
    no unit picks a frozen unit as a target, and a unit whose `Target` is frozen holds its hit),
    `death` (a frozen entity does not die), `patrol`, and a frozen worker's `haul`, `gather` and
    `construct` (its task waits; a frozen hauler draws nothing from the RNG);
  - **keep running:** `build`, `train`, and `haul`, `gather` and `construct` for everyone
    outside the event, so a building still goes up while the battle is held.
- **Results.** Every write returns `{ ok: true }` or `{ ok: false, code, error }` (`TimeRefusal`:
  `event_frozen`, `event_not_frozen`, `mission_open`, `mission_not_open`, `mission_committed`,
  `bad_ticks`, `bad_id`); a refusal changes nothing.
- **World data.** `EventMember` is on the members; `WorldTime` `{ frozen, experience, committed }`
  is on one world-level entity spawned by the first time write (so it takes the next id). Both are
  in snapshots, saves and hashes, and both are `omitWhenEmpty`, so a world that never uses them
  snapshots, saves and hashes exactly as before (the 0.8 and 0.9 golden hashes do not move). A
  world built without them registers them on first write; load it with `TIME_COMPONENTS` in
  `components` (both system sets have them).
- **Causes.** Between ticks a write runs under `withCause(cause)`, so freezes, unfreezes and clock
  changes are in the event log as `WorldTime` changes with that cause. During a step the running
  system is the logged cause and the cause given is kept in the data (`frozen[].by`).
- Integers only, no randomness.
- Tests: `time.test.ts` (the three kinds of time, refusals changing nothing, the time components
  out of snapshots until used, a frozen patrol, and the battle fixture with its battle frozen: a
  barracks finishes while the battle's units keep their `Position`, `Health` and `Cooldown`, the
  freeze and unfreeze are logged with their cause, the battle resumes after, and a save and load
  mid-freeze steps on with equal hashes).

## Missions

The mission lifecycle (`mission.ts`, Engine 0.10 T4; docs/BUILD-LOG.md, Engine 0.10, items
150-154). The mission definition, its outcomes and effects, and the record types are the plain
JSON contract in `engine/core/missions.ts`; this file runs it on a world.

- **Open.** `openMission(world, def, { refs? })` checks `def` with `missionSchema` and records it
  as world data: the whole def as it was (outcomes, weights, effects, `worldTimeCost`), the open
  tick T and the commit tick T + `worldTimeCost`, fixed now. It starts the mission's experience
  clock (`startExperience`), freezes its `event` (if any) and returns `{ ok, mission, openTick,
commitTick, snapshot }`, `snapshot` being the plain world snapshot a kit's adapter reads
  (`missionSnapshot(world)` takes it again, e.g. after a load). Effects name entities by id or by
  a scenario key; every key must be in `refs` (copied onto the open mission), and every `set`
  component must be registered.
- **Resolve.** `delegateMission(world, id)` draws `int(totalWeight)` once and takes the
  outcome it falls in, walking the outcomes in file order (`pickOutcome`): the fair, average
  result (item 154). The draw comes from the mission's own generator,
  `Rng.derived(world.seed, 'mission:<id>')`, never `world.rng`, so it is the same at whatever tick
  the mission is delegated (or times out) and the rest of the world's randomness does not move. `playMission(world, id, outcomeId | { outcome, stats? })` takes only a
  declared outcome, and with `playable` only one of those; anything else is refused
  (`unknown_outcome`) and the mission stays open and unresolved. `quitMission(world, id)` takes
  `onQuit`. A mission resolves once: a second play, delegate or quit is refused
  (`mission_resolved`). Resolving records the choice (and the kit's report) on the open mission;
  nothing else changes until the commit.
- **Commit.** `commitMission(world, id, result?)` steps the world up to the commit tick (no steps
  when it is there already), settling after each step and once there, so it and every other mission
  due by then commit in the same order a tick-by-tick run gives (commit tick, then id); it delegates the
  mission if it is still unresolved (resolution `timeout`), then, under the cause `mission:<id>`:
  applies the outcome's effects in order, unfreezes the event, stamps the commitment
  (`stampCommitment` at the commit tick) and appends a `MissionRecord` `{ mission, outcome,
effects, report?, resolution, openTick, commitTick, experienceTicks, skipped }`. `result`, when
  given, must name the outcome it was resolved to (`result_mismatch`), or is played when it is
  unresolved. A caller that steps the world itself calls `settleMissions(world)` after each step,
  which commits every open mission whose commit tick has come (`commitTick <= world.tick`, in
  commit tick then id order) and returns the records. A mission the world stepped past unsettled
  is overdue: resolving it (delegate, play, quit, or a `result` handed to `commitMission`) is
  refused (`mission_overdue`), and the next `settleMissions` or `commitMission` commits it then,
  without stepping, recorded at its commit tick.
- **Effects** (data only): `damage` lowers `Health.hp` (not below 0; the death system removes it
  later; with `fromReport` (Engine 0.13, decision 4, M13) the amount is that stat of the played
  record's report when it is a whole number, a 0 skipping the effect, and the declared `amount`
  when the mission was delegated, quit or timed out or the report lacks it), `destroy` removes the entity, `inventory` adds or takes (not below 0), `set` merges
  `values` into the component. An effect whose entity is gone, a `damage` on an entity without
  `Health`, or a `set` that would break the component's schema is skipped and listed in
  `skipped`, never an error (so is a `fromReport` damage of 0). `fate` (Engine 0.13, decision 2, item 221)
  `{ entity, fate, by?, at? }` moves a named person's fate with `setFate` ("Fates") under
  `mission:<id>`, in the outcome's order (so `damage` then `fate` hurts and then captures):
  `injured`, `captured` (off the map and out of their squad, `Health` kept), `freed` (back on the
  cell `at`, enterable, with their held `Unit`, in no squad) or `dead`. One that cannot apply (the
  entity gone or not a `Member`, a fate that cannot move there such as anything after a death or a
  captive injured, a `freed` cell off the map or impassable) is skipped and listed in `skipped`,
  never an error. `opportunity` effects open or close opportunities
  ("Opportunities" below); one on an opportunity already taken or closed is skipped. Every
  opportunity an effect names must be known to the world when the mission opens
  (`unknown_opportunity`).
- **Choices with no round** (Engine 0.13): a mission with no `play` (an exchange, a leave-behind)
  is only delegated. `playMission` and `quitMission` refuse it (`not_playable`); its outcome is
  drawn by weight like any delegation (one outcome: certain).
- **Opportunities gate opening.** A mission named by an opportunity opens only while one of them
  is offered (`opportunity_closed`); opening it takes that opportunity.
- **Fixed world-time cost.** The world moves exactly `worldTimeCost` ticks between open and
  commit, however it is resolved and whether it was resolved at once or ticks later. Experience
  ticks (the kit's own round ticks, or ones recorded with `addExperience(world, id, n,
'mission:<id>')`) never step the world; recorded ones are kept on the commitment and on the
  record's `experienceTicks`, and nothing else differs.
- **No do-overs.** Recommitting, reopening, replaying or delegating a committed mission is refused
  (`mission_committed`), failure included: a failure is an ordinary outcome. Committed records are
  append-only and stored frozen, and never change after later ticks or a save and load. A
  committed fate never changes back (fates only move forward and `history` is append-only), and an
  outcome may open a **different** follow-up but never its own mission's opportunity again:
  `openMission` refuses an `opportunity` `{ open }` effect naming an opportunity of the same mission
  (`reopens_self`). A failed rescue opens a ransom, not a second rescue.
- **Refusals** are `{ ok: false, code, error }` with a one-line `error` (`MissionRefusal`:
  `bad_mission`, `bad_id`, `unknown_ref`, `unknown_component`, `mission_open`,
  `mission_not_open`, `mission_committed`, `mission_resolved`, `mission_overdue`, `event_frozen`,
  `unknown_outcome`, `result_mismatch`, `opportunity_closed`, `unknown_opportunity`,
  `reopens_self`, `not_playable`, `stepping`)
  and change nothing. Everything runs between
  ticks (`stepping` during a step).
- **World data.** `Missions` `{ open, committed }` lives on the `WorldTime` entity and is
  `omitWhenEmpty`, so a world that never opens a mission snapshots, saves and hashes as before.
  Both system sets register `MISSION_COMPONENTS`; load a world with them in `components`. The
  only randomness is the one delegation draw, from the mission's own generator seeded from the
  world seed and the mission id (it never draws from `world.rng`).
- Read with `missionsOf(world)`: `open()`, `committed()` (commit order), `record(id)`,
  `status(id)` (`open`, `committed` or null).
- **Live hosting** (`mission-port.ts`, Engine 0.11, item 173): `missionPort(world, { refs? })`
  fills `engine/core`'s `MissionWorldPort` so a game's glue gives a `MissionHost` the world in one
  call: `open` is `openMission` with `refs` and also returns the round's seed, `roundSeed(seed,
id)` = `Rng.derived(seed, "round:<id>").next()` (fixed by the seed and the mission id alone,
  never `world.rng`); `delegate`, `play` (`playMission` with the result's report), `quit`,
  `settle` (`settleMissions`, the ids committed), `snapshot` and `step` are the world's. Refusals
  keep the sim's codes. It records no experience ticks (the host counts them), so the world after
  a played round matches a world run's that resolved the same result at the open tick. It imports
  only the port's type from core.
- Tests: `mission.test.ts` (open and its refusals; partial success applying only its effects;
  failure committed with every retry refused; results outside the declared or playable space
  refused; any declared outcome playable; delegation repeatable from the seed and matching the
  weights over 4,000 seeds and the same at any delegation tick, with `world.rng` untouched; timeout and overdue; skipped effects; a second mission committed on
  the way; the same hash after commit for 0, 1 or 10,000 experience ticks; played at once or
  ticked through giving the same hash; records unchanged across later ticks and save and load),
  and `mission-fate.test.ts` (Engine 0.13: fate effects and capture follow-ups over the captive
  fixture, see "Opportunities"; and a `fromReport` damage played, played at 0, without the stat,
  delegated, quit and timed out).

## Opportunities

Windows that open and close in world time (`opportunity.ts`, Engine 0.10 T5; docs/BUILD-LOG.md,
Engine 0.10, decision 6, item 155). The data is `OpportunityDef` (`opportunitySchema` and
`parseOpportunity` in `engine/core/missions.ts`): `{ id, mission, opens, closes, exclusive?,
closesOthers?, relative? }`, `opens < closes`, world ticks, offered while `opens <= tick < closes`.

- **Adding.** `addOpportunities(world, defs, cause)` checks each def, refuses (changing nothing) a
  bad one (`bad_opportunity`), an id already known or repeated (`opportunity_exists`) or a
  `closesOthers` id that names no opportunity (`unknown_opportunity`), then settles them at once.
  A scenario's `opportunities` list is added this way after the squads (cause `scenario`; the
  `WorldTime` entity is spawned then, so it takes the next id).
- **Status**: `dormant` (a `relative` one waiting for an effect; no window yet), `waiting`,
  `offered`, `taken` or `closed`. Each state keeps its window (`opens`, `closes`, absolute ticks,
  null while dormant) and the cause (`by`) and tick (`at`) of its last change.
- **Time.** `settleOpportunities(world)` is the time-service hook: between ticks it offers each
  waiting one whose `opens` has come and closes each waiting or offered one whose `closes` has come,
  in id order, one write each under the cause `time`, with `at` the window's own tick (so a late
  settle still records when it happened). `settleMissions` calls it first and `commitMission` after
  every step it takes, so windows open and close during a mission's world-time cost; a caller that
  steps the world itself calls `settleMissions` (or this) after each step.
- **Taking.** `openMission` asks `opportunityGate(world, mission)`: a mission no opportunity names is
  not gated; otherwise the lowest-id one offered at the current tick is taken, and none offered is
  refused (`opportunity_closed`, naming why each is not open). Taking (`takeOpportunity`, under
  `mission:<id>`) marks it `taken`, then closes every other opportunity of the same mission, of its
  `exclusive` group and in its `closesOthers` that is dormant, waiting or offered, one logged write
  each. `closesOthers` is one way: the named ones do not close it back.
- **Effects** (`applyOpportunityEffect`, at the commit under `mission:<id>`): `{ open }` on a
  dormant `relative` one gives it the window `commit tick + opens` to `commit tick + closes`
  (offered at once when `opens` is 0); on a waiting one it is offered now, early; on an offered one
  nothing changes. `{ close }` closes a dormant, waiting or offered one. On one already taken or
  closed (or unknown) the effect is skipped (the record's `skipped`). A failure outcome opening a
  rescue is the intended use.
- **Capture follow-ups** (Engine 0.13, decision 2, item 221) need nothing new: an outcome whose
  `fate` effect captures someone also opens dormant `relative` opportunities in one `exclusive`
  group (a rescue, an exchange and a leave-behind; the captive fixture's `rescue-window`,
  `exchange-window` and `leave-window`), and taking one closes the others by the rule above. A
  rescue's success holds `fate: freed`, an exchange is a choice with no `play` paying with an
  `inventory` effect on the stockpile and `fate: freed`, and leaving them behind holds no fate
  effect (the capture stands, and the choice is in the committed records). A failed rescue is an
  ordinary outcome that may open a different opportunity (the fixture's dearer `ransom-window`),
  never the rescue again (`reopens_self`).
- **World data.** `Opportunities { list }` (sorted by id) lives on the `WorldTime` entity and is
  `omitWhenEmpty`, so a world without opportunities snapshots, saves and hashes as before (the 0.8
  and 0.9 golden hashes do not move). Both system sets register `OPPORTUNITY_COMPONENTS`; load a
  world with them in `components`. Integers only, no randomness. Read with
  `opportunitiesOf(world)`: `all()`, `get(id)`, `status(id)`, `offered()`.
- Tests: `opportunity.test.ts` (windows opening and closing by time with the cause `time`, a late
  settle keeping the window's ticks, a take closing its exclusive rival and `closesOthers` under
  `mission:<id>`, refusals for a closed, unopened or dormant opportunity changing nothing, a
  mission's world-time cost carrying the world past another window's close, a failure opening a
  follow-up rescue and a success leaving it dormant, a close effect and a skipped one, the same
  hashes on every run and after save and load at five ticks, and scenario opportunities and their
  errors); `mission-fate.test.ts` (a delegated capture opening the three follow-ups, taking each
  closing its rivals, a failed rescue committed and never retried that opens only the ransom, a
  rescue freeing the captive with his hp and unit kept, an exchange paid from the stockpile, a
  leave-behind changing nothing, skipped fate effects, `unknown_ref` and `reopens_self` at open,
  the same hashes on every run and after save and load at five ticks, and records and fates
  unchanged after save and load).

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
- `leaveSquad(world, person)` (Engine 0.13): one named person leaves: strength - 1, off
  `members` (and `captain`), `Member.squad` null; returns whether a squad lost them (a person in
  no squad is left as they are). The fate writes and `deathSystem` use it, so a squad's strength
  and members stay consistent when a named person is captured or dies ("Fates").

## Fates

Fates of named individuals (`fate.ts`, Engine 0.13 T2; docs/BUILD-LOG.md, Engine 0.13, decision
1, item 220). A named person (an entity with `Member`) carries a fate that survives battle, save
and load, so every mode can read it; the unnamed rank and file have none (they are a squad's
`strength`).

- **`Fate`** `{ state, by, at, held, history }`, `omitWhenEmpty`: `state` is `injured`,
  `captured`, `freed` or `dead` (`FATE_STATES`); `by` the faction that captured or killed them
  (or null); `at` the world tick it was reached; `held` (only while captured) the `{ unit, owner }`
  data kept to free them; `history` every state reached, oldest first, each
  `{ state, by, at, cause }`, append-only (its last entry is the current state). **No `Fate`
  means active**, so a world where no fate is ever set snapshots, saves and hashes as before.
- **States only move forward**: active or freed -> injured; active, freed or injured ->
  captured; captured -> freed; any living state -> dead; dead is final. Anything else (from dead,
  captured -> injured, a state to itself) is refused `fate_final`. A freed person captured again
  is a second capture in `history`, not the first one undone.
- **Reading**: `fateOf(world, id)` -> `{ state, by, at, history }` (`state` `active` with no
  history when there is no `Fate`), or null when `id` is not a living entity with `Member`.
  `namedPeople(world)`: every `Member` ascending by id as `{ id, name, role, squad, fate }`.
- **Writing**, between ticks, logged under the cause given (also kept in `history`):
  `setFate(world, id, state, { cause, by?, at?, cell? })` and the helpers
  `injurePerson(world, id, { cause, by? })`, `capturePerson`, `killPerson` and
  `freePerson(world, id, cell, cause, by?)`. Each returns `{ ok: true, fate }` or
  `{ ok: false, code, error }` with nothing changed: `bad_id` (no such entity, or a bad faction id
  or tick), `not_named` (no `Member`), `fate_final`, `bad_cell` (a `freed` without a cell, or onto
  one off the terrain or impassable) or `stepping` (during a step). A bad cause throws. `at`
  (default the world's tick) lets a fate carried from another world keep its tick. `Fate` is
  registered on first use in a world built without it.
- **From a mission** (Engine 0.13 T3): an outcome's `fate` effect calls `setFate` at the commit
  under `mission:<id>`; a refusal there is a skipped effect in the record, never an error
  ("Missions", Effects).
- **Injured** is a label: `Health` is not changed (battle damage alone injures no one).
- **Captured**: the person leaves the map and their squad: `MAP_COMPONENTS` (`Position`, `Unit`,
  `Task`, `Target`, `Cooldown`, `Facing8`, `Worker`, `Gatherer`, `EventMember`) are removed and
  `leaveSquad` runs; `Member`, `Health` and `Owner` stay, and `held` keeps their `Unit` and
  `Owner`. No system, kit or view has to skip them: everything that counts or fights needs `Unit`
  and `Position`.
- **Freed**: back on the given cell (enterable; `z` from the terrain) with the held `Unit`, in no
  squad (a game that wants them in one says so with a later write).
- **Dead**: off the map and out of their squad like a capture, `Health.hp` set to 0, `held` null;
  the entity stays as a record. In battle, `deathSystem` does this for a named person at 0 hp
  (`by` null: the attack system does not record who struck; cause `death`); everyone else at 0 hp
  is destroyed as before.
- Integers only, no randomness. Tests: `fate.test.ts` (each fate, every refusal leaving the world
  as it was, `stepping`, registration on first use, both system sets, a battle where the named
  captain dies and the hero is captured then freed, the same hashes on every run, and save and load
  at six ticks giving the uninterrupted hashes), `squad.test.ts` (`leaveSquad`), `rts.test.ts`
  (a named hero killed in battle kept as dead; an unnamed unit destroyed).

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
             members: [{ key?, name, role, components? }] }],   // not Member: it is built
  opportunities?: [{ id, mission, opens, closes, ... }],      // Engine 0.10: see Opportunities
  from?: { scenario, carry: { people, stockpiles }, when? } }  // Engine 0.13: see Carry
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
- **From another scenario** (Engine 0.13): `from` names the scenario this one follows and what
  carries from its end world; `worldFromScenario(json, { carried })` applies a carried record last,
  under the cause `carry` (see "Carry"). `from` is optional, so the format stayed at version 1.
- The format is in `docs/reference/schemas.md` ("World scenario", from `scenarioSchema`, with the
  example `docs/reference/examples/world-scenario.json`). A change to the format bumps
  `SCENARIO_VERSION`.

## Carry

A scenario that starts from another's results (`carry.ts`, Engine 0.13 T5; docs/BUILD-LOG.md,
Engine 0.13, decision 5, item 224). The second scenario names the first in `from`; a **carried
record**, plain JSON, is built from the first world's end state and applied to the second world
at tick 0.

```text
"from": { "scenario": "captive",                       // the first scenario's content id
          "carry": { "people": ["captain", "sergeant"],  // squad-member keys: Health and fate
                     "stockpiles": [{ "faction": "village", "items": ["gold"] }] },
          "when": [{ "key": "captain", "fate": "captured",
                     "open": ["rescue-window", "exchange-window", "leave-window"] }] }

const record = carriedRecord(endWorld, second.from, scenarioKeys(first));
const world = worldFromScenario(second, { carried: record });
```

- **The record**: `{ format: "worlds-within/carried", version: 1, from, tick, people: { <key>:
{ fate, by, at, hp, max } }, stockpiles: { <faction>: { <item>: n } } }`, every key sorted,
  integers and ids only (`carriedRecordSchema`, in `docs/reference/schemas.md`). `fate` is
  `active` or a `Fate` state (`by` and `at` null while active); `hp` and `max` are `Health` (both
  null without one); a missing item counts 0. Only what the spec names carries: buildings,
  positions, other units, the RNG and the seed do not, so two endings that differ only in one
  person give records that differ only in that person's entry.
- **`carriedRecord(world, from, keys)`** reads only; `keys` are the first scenario's
  (`scenarioKeys`). A bad spec throws `ScenarioError` with paths under `from`: a key the first
  scenario lacks (`from.carry.people.0: "nobody" is not a key of the first scenario`), one that
  is not a living `Member`, a faction with no stockpile, a person, faction or item given twice.
- **Applying** (`worldFromScenario`'s `carried`, after the entities, squads and opportunities),
  under the cause `carry`: for each person in spec order, `Health` set to the carried hp capped
  at the second scenario's `max`, then the fate by `startFate` (`captured`: off the map and out of
  the squad, `held` their `Unit` and `Owner`; `dead`: off the map, hp 0, a record; `injured` and
  `freed`: where the scenario put them; `history` one step with the cause `carry` and the first
  world's `by` and `at`); then each stockpile item replaced; then each `when` rule whose fate
  matches opens its opportunities (as an `opportunity` effect: offered at once when `opens` is 0).
  Without `carried` the scenario starts as written, so it is playable alone.
- **Checks** (one `ScenarioError` line per field, always made for `from`): each carried key is a
  squad member's key of this scenario and has no `Fate` of its own in the file; each carried
  faction has a `Stockpile` entity; each `when` names a carried key and `relative` opportunities
  of the scenario. For `carried` (paths under `carried`): its schema, `from` equal to
  `from.scenario`, and exactly the people, factions and items the spec names
  (`carried.people.mayor: "mayor" is not carried by this scenario (from.carry.people)`,
  `carried.people: has no entry for "sergeant"`); `carried` given to a scenario without `from` is
  an error.
- Deterministic: the same record gives the same start hash every run. Tests: `carry.test.ts`
  (the captive fixture's end carried into `captive-after.world.json`: the record, a captured,
  active, injured and dead person carried in, equal hashes every run, through 30 ticks and a save
  and load, records differing in one person's fate giving start worlds differing only in that
  person (and, for a capture, his squad and the opportunities his `when` rule opens), and every
  error).

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
- `moveSystem` (`move`): a unit cooling down from a step counts down (with or without a `Task`,
  so a stop mid-step leaves no stale wait); else, with a task, a move task at its
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
- `deathSystem` (`death`, in `fate.ts` since Engine 0.13): every `Unit` or `Building` at 0 hp
  without `Member` is destroyed (each removal and the destroy are logged under `death`). A named
  person (`Member`) at 0 hp is kept as a dead record instead: they leave their squad
  (`leaveSquad`: strength - 1, off `members`, not captain) and the map (`MAP_COMPONENTS`) and get
  `Fate { state: "dead", by: null }` (see "Fates").
- **Heroes** (item 121) are ordinary units with a `Member` role `hero`; an order can name one
  alone. Nothing in the orders or systems tells them apart.
- Tests: `rts.test.ts` (move around a wall, speed and cell cost, a flow-field group, stop, no way;
  attack closes to range and kills, chasing, idle units fighting back, heroes ordered alone and
  leaving their squad on death as a dead record (Engine 0.13), an unnamed unit still destroyed; every refusal changes nothing; a two-sided battle gives the same
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
- All randomness through the world's seeded RNG (or, for a mission's delegation draw, a generator
  derived from the world seed with `Rng.derived`, item 154). No `Math.random`, no `Date.now` or
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
  `footprint.test.ts`, `time.test.ts`, `mission.test.ts`, `mission-fate.test.ts`, `opportunity.test.ts`, `fate.test.ts`, `sample-world.test.ts`).
