import { z } from 'zod';
import { dottedPath } from './content/validate';

/**
 * Orders: what a player (or a scripted enemy) tells units to do, as plain JSON data
 * (docs/BUILD-LOG.md, Engine 0.9, items 122-123). Defined here in `engine/core`, the one layer both
 * `engine/sim` (which carries orders out: `applyOrder`) and `kits` (which make them from pointer
 * commands) may import.
 *
 *   { "id": 7, "faction": "red", "type": "move",   "units": [12, 13], "target": { "x": 9, "y": 4 } }
 *   { "id": 8, "faction": "red", "type": "attack", "units": [12],     "target": 31 }
 *   { "id": 9, "faction": "red", "type": "stop",   "units": [13] }
 *   { "id": 10, "faction": "red", "type": "build", "units": [14], "target": { "x": 6, "y": 6 },
 *     "building": "barracks" }
 *   { "id": 11, "faction": "red", "type": "train",  "units": [40],     "target": "soldier" }
 *   { "id": 12, "faction": "red", "type": "gather", "units": [14, 15], "target": 22 }
 *
 * `id` counts up from 1 in each battle and names the order in the world's event log (`order:<id>`);
 * `faction` is the side giving it and must own every unit; `units` are world entity ids (a hero is
 * named like any other unit). `target` depends on the type: a cell for `move` and `build` (the
 * new building's north-west cell, with its type in `building`), an entity id for `attack` and
 * `gather` (a resource node), a unit type for `train` (whose `units` are the buildings that train
 * it, one each), none for `stop`. Types are ids in the world's unit and building type table
 * (`rts-types.ts`).
 */

/** A faction or type id, as in the sim: a letter, then letters, digits, `_` or `-`. */
const Id = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -');
/** A world entity id: a positive integer. */
const EntityId = z.int().min(1);

const common = {
  id: z.int().min(1).describe('the order number, counting up from 1 in each battle'),
  faction: Id.describe('the side giving the order; it must own every unit'),
  units: z
    .array(EntityId)
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'units must not repeat' })
    .describe('the world entity ids of the units ordered'),
};

/** A cell of the world's terrain grid. */
export const orderCellSchema = z.strictObject({ x: z.int(), y: z.int() });

/** Walk to a cell. */
export const moveOrderSchema = z.strictObject({
  ...common,
  type: z.literal('move'),
  target: orderCellSchema.describe('the cell to walk to'),
});

/** Close to range of an entity and fight it until it dies. */
export const attackOrderSchema = z.strictObject({
  ...common,
  type: z.literal('attack'),
  target: EntityId.describe('the entity to attack'),
});

/** Drop the current order and stand. */
export const stopOrderSchema = z.strictObject({ ...common, type: z.literal('stop') });

/** Place a building of type `building` with its north-west cell at `target`, and build it. */
export const buildOrderSchema = z.strictObject({
  ...common,
  type: z.literal('build'),
  target: orderCellSchema.describe("the new building's north-west cell"),
  building: Id.describe('the building type to place (an id in the building types)'),
});

/** Queue one unit of type `target` at each building in `units`. */
export const trainOrderSchema = z.strictObject({
  ...common,
  type: z.literal('train'),
  target: Id.describe('the unit type to train (an id in the unit types)'),
});

/** Gather from a resource node and carry it to the faction's drop-off buildings. */
export const gatherOrderSchema = z.strictObject({
  ...common,
  type: z.literal('gather'),
  target: EntityId.describe('the resource node to gather from'),
});

/** Any order, told apart by `type`. */
export const orderSchema = z.discriminatedUnion('type', [
  moveOrderSchema,
  attackOrderSchema,
  stopOrderSchema,
  buildOrderSchema,
  trainOrderSchema,
  gatherOrderSchema,
]);

export type Order = z.infer<typeof orderSchema>;
export type OrderType = Order['type'];
export type OrderCell = z.infer<typeof orderCellSchema>;

/** The order types, in a fixed order. */
export const ORDER_TYPES: readonly OrderType[] = Object.freeze([
  'move',
  'attack',
  'stop',
  'build',
  'train',
  'gather',
]);

/**
 * Check `json` against `orderSchema`. On failure `error` is one line per bad field, each naming
 * it (`units.1: ...`, `target.x: ...`).
 */
export function parseOrder(json: unknown): { ok: true; order: Order } | { ok: false; error: string } {
  const result = orderSchema.safeParse(json);
  if (result.success) return { ok: true, order: result.data };
  const lines = result.error.issues.map((issue) => {
    const path = dottedPath(issue.path);
    return path === '' ? issue.message : `${path}: ${issue.message}`;
  });
  return { ok: false, error: lines.join('\n') };
}
