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
 *
 * `id` counts up from 1 in each battle and names the order in the world's event log (`order:<id>`);
 * `faction` is the side giving it and must own every unit; `units` are world entity ids (a hero is
 * named like any other unit). `target` depends on the type: a cell for `move`, an entity id for
 * `attack`, none for `stop`. More types (`build`, `train`, `gather`) join the union as the
 * systems that carry them out arrive.
 */

/** A faction id, as in the sim's `Owner`: a letter, then letters, digits, `_` or `-`. */
const FactionId = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -');
/** A world entity id: a positive integer. */
const EntityId = z.int().min(1);

const common = {
  id: z.int().min(1).describe('the order number, counting up from 1 in each battle'),
  faction: FactionId.describe('the side giving the order; it must own every unit'),
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

/** Any order, told apart by `type`. */
export const orderSchema = z.discriminatedUnion('type', [
  moveOrderSchema,
  attackOrderSchema,
  stopOrderSchema,
]);

export type Order = z.infer<typeof orderSchema>;
export type OrderType = Order['type'];
export type OrderCell = z.infer<typeof orderCellSchema>;

/** The order types, in a fixed order. */
export const ORDER_TYPES: readonly OrderType[] = Object.freeze(['move', 'attack', 'stop']);

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
