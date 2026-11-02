import { z } from 'zod';
import { defineComponent } from './component';
import type { Entity, World } from './world';

/**
 * The world's standard components (Engine 0.8). All data is integers, strings, booleans and plain
 * objects or arrays, so it saves, hashes and loads exactly. Coordinates are cells of the terrain
 * grid; `z` is the level an entity stands on (docs/BUILD-LOG.md, Engine 0.8, item 101).
 *
 * These are the world's machinery, not game rules: what a building kind or an item id means is up
 * to the game's data.
 */

/** An identifier used in data: a letter, then letters, digits, `_` or `-`. */
const Id = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -');
/** An entity id: a positive integer. */
const EntityId = z.int().min(1);
const Count = z.int().min(0);

/** A cell position. `z` defaults to 0 (flat ground) so flat scenarios can leave it out. */
export const Position = defineComponent(
  'Position',
  z.strictObject({ x: z.int(), y: z.int(), z: z.int().default(0) }),
);
export type PositionData = z.infer<typeof Position.schema>;

/** Hit points: `hp` from 0 up to `max` (at least 1). */
export const Health = defineComponent(
  'Health',
  z
    .strictObject({ hp: Count, max: z.int().min(1) })
    .refine((h) => h.hp <= h.max, { message: 'hp must not exceed max' }),
);
export type HealthData = z.infer<typeof Health.schema>;

/** The faction an entity belongs to, by id (`"red"`, `"village"`). */
export const Owner = defineComponent('Owner', z.strictObject({ faction: Id }));
export type OwnerData = z.infer<typeof Owner.schema>;

/**
 * Items held: item id -> integer count (zero counts are allowed but `inventoryAdd` drops them).
 * Stored with keys in sorted order, so a snapshot lists items the same way however they were added.
 */
export const Inventory = defineComponent(
  'Inventory',
  z.record(Id, Count).transform((items) => sortKeys(items)),
);
export type InventoryData = z.infer<typeof Inventory.schema>;

/**
 * A building going up: its `kind` (a game id), `progress` so far and the `work` it needs, both in
 * work units; `done` is set once progress reaches the required work and never before.
 */
export const Construction = defineComponent(
  'Construction',
  z
    .strictObject({ kind: Id, progress: Count, work: z.int().min(1), done: z.boolean() })
    .refine((c) => c.progress <= c.work, { message: 'progress must not exceed work' })
    .refine((c) => c.done === (c.progress === c.work), {
      message: 'done must be true exactly when progress equals work',
    }),
);
export type ConstructionData = z.infer<typeof Construction.schema>;

/** A worker: the entity it is working on (`job`, null when idle) and the work it does per tick. */
export const Worker = defineComponent(
  'Worker',
  z.strictObject({ job: EntityId.nullable(), rate: z.int().min(1) }),
);
export type WorkerData = z.infer<typeof Worker.schema>;

/** A patrol route: waypoints visited in order (looping), and the index of the one being walked to. */
export const Patrol = defineComponent(
  'Patrol',
  z
    .strictObject({
      waypoints: z.array(z.strictObject({ x: z.int(), y: z.int(), z: z.int().default(0) })).min(1),
      index: Count,
    })
    .refine((p) => p.index < p.waypoints.length, { message: 'index must point at a waypoint' }),
);
export type PatrolData = z.infer<typeof Patrol.schema>;

/**
 * A squad: `strength` is how many people are in it (the one number the RTS view shows); `members`
 * are the named people among them (entities with `Member`), ascending by id, never more than the
 * strength; `captain` is one of them or null. The rest of the strength is unnamed rank and file.
 */
export const Squad = defineComponent(
  'Squad',
  z
    .strictObject({ strength: Count, captain: EntityId.nullable(), members: z.array(EntityId) })
    .refine((s) => s.members.length <= s.strength, { message: 'more named members than strength' })
    .refine((s) => s.members.every((m, i) => i === 0 || (s.members[i - 1] as number) < m), {
      message: 'members must be unique and ascending',
    })
    .refine((s) => s.captain === null || s.members.includes(s.captain), {
      message: 'captain must be one of the members',
    }),
);
export type SquadData = z.infer<typeof Squad.schema>;

/** Roles a named person can have in a squad, from first lost to last lost. */
export const ROLES = ['regular', 'hero', 'captain'] as const;
export type Role = (typeof ROLES)[number];

/** A named person: their name, the squad they are in (null when in none) and their role in it. */
export const Member = defineComponent(
  'Member',
  z.strictObject({ name: z.string().min(1), squad: EntityId.nullable(), role: z.enum(ROLES) }),
);
export type MemberData = z.infer<typeof Member.schema>;

/** A copy of `obj` with its keys in sorted (code unit) order. */
function sortKeys<V>(obj: Record<string, V>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const key of Object.keys(obj).sort()) out[key] = obj[key] as V;
  return out;
}

/** Every standard component kind, for `createWorld(seed, { components: STANDARD_COMPONENTS })`. */
export const STANDARD_COMPONENTS = Object.freeze([
  Position,
  Health,
  Owner,
  Inventory,
  Construction,
  Worker,
  Patrol,
  Squad,
  Member,
]);

/**
 * Add `delta` (may be negative) of `item` to the entity's inventory, creating it if missing.
 * Throws if the count would go below 0; a count that reaches 0 is dropped. Keys stay sorted.
 */
export function inventoryAdd(world: World, id: Entity, item: string, delta: number): InventoryData {
  if (!Number.isInteger(delta)) throw new Error(`inventoryAdd needs a whole number, got ${delta}`);
  const items = { ...(world.get(id, Inventory) ?? {}) };
  const count = (items[item] ?? 0) + delta;
  if (count < 0) throw new Error(`entity ${id} has ${items[item] ?? 0} ${item}, cannot take ${-delta}`);
  if (count === 0) delete items[item];
  else items[item] = count;
  return world.add(id, Inventory, items);
}
