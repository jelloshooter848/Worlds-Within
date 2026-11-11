import type { JsonObject, JsonValue } from '../core/headless';
import { canonicalJson } from '../core/headless';
import { Rng } from '../core/rng';
import type { ComponentDef } from './component';
import type { Cause, Change, ChangeOp, LogOptions } from './events';
import { EXTERNAL_CAUSE, checkCause, deepFreeze } from './events';

/** Any component kind, whatever its data type. */
export type AnyComponent = ComponentDef<JsonValue>;

/**
 * The world: entities, component stores, systems run in a fixed order, a seeded RNG and an integer
 * tick (one tick is one world minute; docs/BUILD-LOG.md, Engine 0.8, item 100). Headless and
 * deterministic: the same seed, components and systems give the same snapshots on every run.
 *
 *   const world = createWorld(7, { components: [Position], systems: [{ name: 'move', run: move }] });
 *   const id = world.spawn();
 *   world.add(id, Position, { x: 0, y: 0 });
 *   world.step();                        // runs `move`, then tick 0 -> 1
 *   for (const e of world.query(Position)) ...   // ascending entity id, always
 *   world.withCause('order:3', (w) => w.add(id, Position, { x: 2, y: 0 }));
 *   world.events(1);                     // every change at tick 1 or later, with its cause
 *
 * Stored component data is frozen: change it with `add` (or `update`), never in place, so every
 * change goes through the World API and into the event log.
 */

/** An entity: a positive integer id, handed out in order and never reused. */
export type Entity = number;

/** A system: one named step of a tick. Systems run in the order they were added. */
export interface System {
  readonly name: string;
  run(world: World): void;
}

export interface WorldOptions {
  /** Component kinds to register now (more can be added with `registerComponent`). */
  readonly components?: readonly AnyComponent[];
  /** Systems in run order (more can be appended with `addSystem`). */
  readonly systems?: readonly System[];
  /** Event log retention (default: keep every change). See `LogOptions`. */
  readonly log?: LogOptions;
}

/** The whole world as JSON-safe data. Components are listed per kind in ascending entity id. */
export interface WorldSnapshot extends JsonObject {
  seed: number;
  tick: number;
  nextId: number;
  rng: number;
  entities: number[];
  components: { [name: string]: [number, JsonValue][] };
}

export interface World {
  /** The seed the world was created with. */
  readonly seed: number;
  /** Ticks committed so far: an integer, 0 for a new world. */
  readonly tick: number;
  /** The id the next `spawn` will return. */
  readonly nextId: number;
  /** The world's own seeded RNG. All randomness in the sim goes through it. */
  readonly rng: Rng;

  /** Register a component kind; its name must be new. */
  registerComponent(def: AnyComponent): void;
  /** Whether a component kind of this name is registered. */
  registered(c: AnyComponent | string): boolean;
  /** Append a system to the run order; its name must be new. */
  addSystem(system: System): void;
  /** System names in run order. */
  systems(): string[];

  /** A new entity with no components. */
  spawn(): Entity;
  /** Remove an entity and all its components. Throws if it does not exist. */
  destroy(id: Entity): void;
  /** Whether the entity exists. */
  alive(id: Entity): boolean;
  /** Every live entity, ascending by id. */
  entities(): Entity[];

  /**
   * Set component `c` on `id` (adding or replacing it). The data is checked against the
   * component's schema and a frozen, parsed copy is stored, so later changes to `data` do not
   * leak in. Logged as `add` (new) or `set` (replaced).
   */
  add<T extends JsonValue>(id: Entity, c: ComponentDef<T>, data: T): T;
  add(id: Entity, c: string, data: JsonValue): JsonValue;
  /** `add(id, c, fn(current))`: replace the component with a new value made from the current one. */
  update<T extends JsonValue>(id: Entity, c: ComponentDef<T>, fn: (current: Readonly<T>) => T): Readonly<T>;
  /** The stored data, frozen (read it; change it with `add`), or undefined when the entity lacks it. */
  get<T extends JsonValue>(id: Entity, c: ComponentDef<T>): T | undefined;
  get(id: Entity, c: string): JsonValue | undefined;
  has(id: Entity, c: AnyComponent | string): boolean;
  /** Remove component `c` from `id`; returns whether it was there. */
  remove(id: Entity, c: AnyComponent | string): boolean;

  /** Entities that have every listed component, ascending by id. Returns a fresh array. */
  query(...cs: (AnyComponent | string)[]): Entity[];

  /**
   * Run every system in order, then commit the tick (tick + 1). Changes the systems make are
   * attributed to the system making them and staged; they join the event log only at the commit.
   * If a system throws, the tick is not committed and its staged changes are dropped from the log
   * (the world itself is not rolled back: treat it as broken).
   */
  step(): void;

  /**
   * Run `fn` with `cause` as the cause of every change it makes (between ticks only; inside a step
   * the cause is always the running system). Without it, a change between ticks is logged with the
   * cause `'external'`. Returns what `fn` returns.
   */
  withCause<R>(cause: Cause, fn: (world: World) => R): R;
  /** The cause a change made now would be logged with. */
  readonly cause: Cause;
  /**
   * Committed changes with `tick >= sinceTick` (all kept changes when omitted), oldest first, in
   * the order they were made. Staged changes of a running step are not included. Entries are
   * frozen JSON-safe data; the array is fresh.
   */
  events(sinceTick?: number): Change[];

  /**
   * The whole world as JSON-safe data (copied: changing it does not change the world). Every
   * registered kind is listed, except an `omitWhenEmpty` kind that no entity has.
   */
  snapshot(): WorldSnapshot;
  /**
   * The same snapshot without the copies (Engine 0.16 part D, D9): the component values are the
   * world's own stored values, which are deep-frozen, so it is read-only. For readers that only
   * read it once per tick (the RTS kit's view), where copying every component was most of a tick.
   */
  peek(): WorldSnapshot;
  /** The snapshot as canonical JSON (sorted keys): equal worlds give equal text, for hashing. */
  canonical(): string;
}

type Store = Map<Entity, JsonValue>;

/**
 * The state a loaded world starts from (`save.ts` builds it from a checked save file). Component
 * data is already parsed by its schema; the log entries are already checked. Not part of the
 * public API: load a world with `loadWorld`.
 */
export interface RestoredState {
  readonly tick: number;
  readonly nextId: number;
  readonly rng: number;
  /** Live entities, ascending. */
  readonly entities: readonly Entity[];
  /** Per component name, the data of each entity that has it. */
  readonly data: ReadonlyMap<string, ReadonlyMap<Entity, JsonValue>>;
  readonly log: readonly Change[];
}

/** What `saveWorld` needs beyond the public API: the world's log policy and whether a step runs. */
export interface WorldInternals {
  readonly stepping: () => boolean;
  readonly log: { readonly enabled: boolean; readonly ticks: number | undefined };
  /** The registered component kind named `name` (for checking data before a write). */
  readonly component: (name: string) => AnyComponent | undefined;
}

const internals = new WeakMap<World, WorldInternals>();

/** The internals of a world made by `createWorld` or `loadWorld` (for `save.ts`, `time.ts` and `mission.ts`). */
export function worldInternals(world: World): WorldInternals {
  const found = internals.get(world);
  if (!found) throw new Error('not a world made by createWorld or loadWorld');
  return found;
}

export function createWorld(seed: number, options: WorldOptions = {}): World {
  return makeWorld(seed, options);
}

/**
 * A world, new (no `restored`) or rebuilt from a save. Rebuilding sets the state directly: it logs
 * nothing, and the saved log is taken over as it was.
 */
export function makeWorld(seed: number, options: WorldOptions, restored?: RestoredState): World {
  if (!Number.isInteger(seed)) throw new Error(`world seed must be an integer, got ${seed}`);
  const defs = new Map<string, AnyComponent>();
  const stores = new Map<string, Store>();
  const systemList: System[] = [];
  // Ascending by construction: ids are handed out in increasing order and only ever removed.
  const live: Entity[] = [];
  const liveSet = new Set<Entity>();
  let tick = restored?.tick ?? 0;
  let nextId = restored?.nextId ?? 1;
  const rng = restored ? Rng.fromState(restored.rng) : new Rng(seed >>> 0);
  let stepping = false;
  // The cause of changes made now: the running system during a step, else the withCause cause.
  let cause: Cause = EXTERNAL_CAUSE;
  const logOn = options.log?.enabled ?? true;
  const keepTicks = options.log?.ticks;
  if (keepTicks !== undefined && !(Number.isInteger(keepTicks) && keepTicks >= 0)) {
    throw new Error(`log.ticks must be an integer >= 0, got ${keepTicks}`);
  }
  // Committed changes, oldest first, and the changes staged by the step now running.
  const log: Change[] = [];
  const staged: Change[] = [];

  const record = (op: ChangeOp, entity: Entity, extra: { [key: string]: JsonValue } = {}): void => {
    if (!logOn) return;
    const change = Object.freeze({ tick, cause, op, entity, ...extra }) as Change;
    (stepping ? staged : log).push(change);
  };

  const trim = (): void => {
    if (keepTicks === undefined) return;
    const oldest = tick - keepTicks;
    let drop = 0;
    while (drop < log.length && (log[drop] as Change).tick < oldest) drop++;
    if (drop > 0) log.splice(0, drop);
  };

  const nameOf = (c: AnyComponent | string): string => (typeof c === 'string' ? c : c.name);

  const storeOf = (c: AnyComponent | string): Store => {
    const name = nameOf(c);
    const store = stores.get(name);
    if (!store) throw new Error(`unknown component "${name}": register it first`);
    if (typeof c !== 'string' && defs.get(name) !== c) {
      throw new Error(`component "${name}" is a different definition from the one registered`);
    }
    return store;
  };

  const mustLive = (id: Entity): void => {
    if (!liveSet.has(id)) throw new Error(`no entity ${id}`);
  };

  // The snapshot with each stored value passed through `copy` (a deep copy, or the frozen value).
  const snapshotOf = (copy: (value: JsonValue) => JsonValue): WorldSnapshot => {
    const components: WorldSnapshot['components'] = {};
    for (const name of [...stores.keys()].sort()) {
      const store = stores.get(name) as Store;
      if (store.size === 0 && (defs.get(name) as AnyComponent).omitWhenEmpty) continue;
      components[name] = live
        .filter((id) => store.has(id))
        .map((id): [number, JsonValue] => [id, copy(store.get(id) as JsonValue)]);
    }
    return { seed, tick, nextId, rng: rng.state(), entities: live.slice(), components };
  };

  const world: World = {
    get seed() {
      return seed;
    },
    get tick() {
      return tick;
    },
    get nextId() {
      return nextId;
    },
    get rng() {
      return rng;
    },
    get cause() {
      return cause;
    },

    registerComponent(def) {
      if (defs.has(def.name)) throw new Error(`component "${def.name}" is already registered`);
      defs.set(def.name, def);
      stores.set(def.name, new Map());
    },

    registered(c) {
      return defs.has(nameOf(c));
    },

    addSystem(system) {
      if (systemList.some((s) => s.name === system.name)) {
        throw new Error(`system "${system.name}" is already added`);
      }
      checkCause(system.name);
      if (stepping) throw new Error(`cannot add system "${system.name}" during a step`);
      systemList.push(system);
    },

    systems() {
      return systemList.map((s) => s.name);
    },

    spawn() {
      const id = nextId++;
      live.push(id);
      liveSet.add(id);
      record('spawn', id);
      return id;
    },

    destroy(id) {
      mustLive(id);
      for (const name of [...stores.keys()].sort()) {
        const store = stores.get(name) as Store;
        if (!store.has(id)) continue;
        record('remove', id, { component: name, before: store.get(id) as JsonValue });
        store.delete(id);
      }
      liveSet.delete(id);
      record('destroy', id);
      live.splice(live.indexOf(id), 1);
    },

    alive(id) {
      return liveSet.has(id);
    },

    entities() {
      return live.slice();
    },

    add(id: Entity, c: AnyComponent | string, data: JsonValue): JsonValue {
      mustLive(id);
      const store = storeOf(c);
      const def = defs.get(nameOf(c)) as AnyComponent;
      const parsed = def.schema.safeParse(data);
      if (!parsed.success) {
        throw new Error(`component "${def.name}" on entity ${id}: ${parsed.error.message}`);
      }
      // Throws, naming the path, on anything that would not survive a save (NaN, Map, undefined...).
      canonicalJson(parsed.data, `${def.name}`);
      const stored = deepFreeze(structuredClone(parsed.data));
      const before = store.get(id);
      store.set(id, stored);
      if (before === undefined) record('add', id, { component: def.name, value: stored });
      else record('set', id, { component: def.name, before, value: stored });
      return stored;
    },

    update<T extends JsonValue>(
      id: Entity,
      c: ComponentDef<T>,
      fn: (current: Readonly<T>) => T,
    ): Readonly<T> {
      const current = world.get(id, c);
      if (current === undefined) throw new Error(`entity ${id} has no component "${c.name}" to update`);
      return world.add(id, c, fn(current));
    },

    get(id: Entity, c: AnyComponent | string): JsonValue | undefined {
      return storeOf(c).get(id);
    },

    has(id, c) {
      return storeOf(c).has(id);
    },

    remove(id, c) {
      const store = storeOf(c);
      const before = store.get(id);
      if (before === undefined) return false;
      store.delete(id);
      record('remove', id, { component: nameOf(c), before });
      return true;
    },

    query(...cs) {
      const wanted = cs.map(storeOf);
      return live.filter((id) => wanted.every((store) => store.has(id)));
    },

    step() {
      if (stepping) throw new Error('step() called from inside a system');
      const outer = cause;
      stepping = true;
      try {
        for (const system of systemList) {
          cause = system.name;
          system.run(world);
        }
      } catch (err) {
        staged.length = 0;
        throw err;
      } finally {
        stepping = false;
        cause = outer;
      }
      tick += 1;
      for (const change of staged) log.push(change);
      staged.length = 0;
      trim();
    },

    withCause<R>(next: Cause, fn: (w: World) => R): R {
      if (stepping) throw new Error(`withCause("${next}") inside a step: a system's changes are its own`);
      checkCause(next);
      const outer = cause;
      cause = next;
      try {
        return fn(world);
      } finally {
        cause = outer;
      }
    },

    events(sinceTick) {
      if (sinceTick === undefined) return log.slice();
      if (!Number.isInteger(sinceTick))
        throw new Error(`events(sinceTick) needs an integer, got ${sinceTick}`);
      // The log is in tick order, so the first kept index is a binary search away.
      let lo = 0;
      let hi = log.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if ((log[mid] as Change).tick < sinceTick) lo = mid + 1;
        else hi = mid;
      }
      return log.slice(lo);
    },

    snapshot() {
      return snapshotOf((value) => structuredClone(value));
    },

    peek() {
      return snapshotOf((value) => value);
    },

    canonical() {
      return canonicalJson(world.snapshot());
    },
  };

  for (const def of options.components ?? []) world.registerComponent(def);
  for (const system of options.systems ?? []) world.addSystem(system);
  if (restored) {
    for (const id of restored.entities) {
      live.push(id);
      liveSet.add(id);
    }
    for (const [name, values] of restored.data) {
      const store = storeOf(name);
      for (const [id, value] of values) store.set(id, deepFreeze(structuredClone(value)));
    }
    for (const change of restored.log) log.push(deepFreeze(structuredClone(change)));
  }
  internals.set(world, {
    stepping: () => stepping,
    log: { enabled: logOn, ticks: keepTicks },
    component: (name) => defs.get(name),
  });
  return world;
}
