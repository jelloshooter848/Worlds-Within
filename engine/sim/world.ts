import type { JsonObject, JsonValue } from '../core/headless';
import { canonicalJson } from '../core/headless';
import { Rng } from '../core/rng';
import type { ComponentDef } from './component';

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
   * component's schema and the parsed copy is stored, so later changes to `data` do not leak in.
   */
  add<T extends JsonValue>(id: Entity, c: ComponentDef<T>, data: T): T;
  add(id: Entity, c: string, data: JsonValue): JsonValue;
  /** The stored data (mutable in place by systems), or undefined when the entity lacks it. */
  get<T extends JsonValue>(id: Entity, c: ComponentDef<T>): T | undefined;
  get(id: Entity, c: string): JsonValue | undefined;
  has(id: Entity, c: AnyComponent | string): boolean;
  /** Remove component `c` from `id`; returns whether it was there. */
  remove(id: Entity, c: AnyComponent | string): boolean;

  /** Entities that have every listed component, ascending by id. Returns a fresh array. */
  query(...cs: (AnyComponent | string)[]): Entity[];

  /** Run every system in order, then commit the tick (tick + 1). */
  step(): void;

  /** The whole world as JSON-safe data (copied: changing it does not change the world). */
  snapshot(): WorldSnapshot;
  /** The snapshot as canonical JSON (sorted keys): equal worlds give equal text, for hashing. */
  canonical(): string;
}

type Store = Map<Entity, JsonValue>;

export function createWorld(seed: number, options: WorldOptions = {}): World {
  if (!Number.isInteger(seed)) throw new Error(`world seed must be an integer, got ${seed}`);
  const defs = new Map<string, AnyComponent>();
  const stores = new Map<string, Store>();
  const systemList: System[] = [];
  // Ascending by construction: ids are handed out in increasing order and only ever removed.
  const live: Entity[] = [];
  const liveSet = new Set<Entity>();
  let tick = 0;
  let nextId = 1;
  const rng = new Rng(seed >>> 0);
  let stepping = false;

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

    registerComponent(def) {
      if (defs.has(def.name)) throw new Error(`component "${def.name}" is already registered`);
      defs.set(def.name, def);
      stores.set(def.name, new Map());
    },

    addSystem(system) {
      if (systemList.some((s) => s.name === system.name)) {
        throw new Error(`system "${system.name}" is already added`);
      }
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
      return id;
    },

    destroy(id) {
      mustLive(id);
      for (const store of stores.values()) store.delete(id);
      liveSet.delete(id);
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
      const stored = structuredClone(parsed.data);
      store.set(id, stored);
      return stored;
    },

    get(id: Entity, c: AnyComponent | string): JsonValue | undefined {
      return storeOf(c).get(id);
    },

    has(id, c) {
      return storeOf(c).has(id);
    },

    remove(id, c) {
      return storeOf(c).delete(id);
    },

    query(...cs) {
      const wanted = cs.map(storeOf);
      return live.filter((id) => wanted.every((store) => store.has(id)));
    },

    step() {
      if (stepping) throw new Error('step() called from inside a system');
      stepping = true;
      try {
        for (const system of systemList) system.run(world);
      } finally {
        stepping = false;
      }
      tick += 1;
    },

    snapshot() {
      const components: WorldSnapshot['components'] = {};
      for (const name of [...stores.keys()].sort()) {
        const store = stores.get(name) as Store;
        components[name] = live
          .filter((id) => store.has(id))
          .map((id): [number, JsonValue] => [id, structuredClone(store.get(id) as JsonValue)]);
      }
      return { seed, tick, nextId, rng: rng.state(), entities: live.slice(), components };
    },

    canonical() {
      return canonicalJson(world.snapshot());
    },
  };

  for (const def of options.components ?? []) world.registerComponent(def);
  for (const system of options.systems ?? []) world.addSystem(system);
  return world;
}
