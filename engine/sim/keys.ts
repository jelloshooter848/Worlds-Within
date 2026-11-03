import type { Entity, World } from './world';

/**
 * The world's key table (Engine 0.15 T7, gaps M10 and D6; docs/BUILD-LOG.md, Engine 0.15,
 * decision 8): every scenario `key` and the entity id it was given, fixed when the world is built
 * (`worldFromScenario`) and kept in world saves (an optional `keys` field, so older saves load).
 * It lives **beside** the world, never in its snapshot, so keeping it moves no state hash. A
 * mission's params and a kit's rules may name any key the table holds (`missionPort` hands the
 * table to the round), and run checks read `world.key.<key>...` through it (`engine/tools`).
 *
 *   const world = worldFromScenario(json);
 *   worldKeys(world);          // { hall: 3, ram: 18, ... }: frozen; {} for a world with no keys
 *
 * A key keeps its id after its entity is destroyed (the table says who it was, not who is alive).
 */

const tables = new WeakMap<World, Readonly<Record<string, Entity>>>();
const EMPTY: Readonly<Record<string, Entity>> = Object.freeze({});

/** The world's key table (key to entity id), frozen; empty when the world was given none. */
export function worldKeys(world: World): Readonly<Record<string, Entity>> {
  return tables.get(world) ?? EMPTY;
}

/**
 * Sets the world's key table (for `worldFromScenario` and `loadWorld`; not part of the public
 * API). Keys are copied in sorted order and frozen. Throws on an id that is not a positive integer.
 */
export function keepKeys(world: World, keys: Readonly<Record<string, Entity>>): void {
  const table: Record<string, Entity> = {};
  for (const key of Object.keys(keys).sort()) {
    const id = keys[key] as Entity;
    if (!Number.isInteger(id) || id < 1)
      throw new Error(`key "${key}" names entity ${id}, not a positive integer`);
    table[key] = id;
  }
  tables.set(world, Object.freeze(table));
}
