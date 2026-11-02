import { parseOrder, type Order } from '../core/orders';
import {
  ECONOMY_COMPONENTS,
  constructSystem,
  economyOrderRefusal,
  gatherSystem,
  trainSystem,
  writeEconomyOrder,
} from './economy';
import {
  UNIT_COMPONENTS,
  attackSystem,
  deathSystem,
  moveSystem,
  unitOrderRefusal,
  writeUnitOrder,
} from './rts';
import type { System, World } from './world';

/**
 * The RTS as one set (Engine 0.9): `applyOrder` for every order type, the components and the
 * systems in their run order (see "RTS units" and "RTS economy" in this folder's CLAUDE.md).
 *
 *   const world = createWorld(seed, {
 *     components: [...STANDARD_COMPONENTS, Terrain, ...RTS_COMPONENTS],
 *     systems: RTS_SYSTEMS,
 *   });
 *   applyOrder(world, { id: 1, faction: 'red', type: 'move', units: [5], target: { x: 9, y: 2 } });
 *   world.step();
 */

/** The components the RTS systems use beyond the standard ones and `Terrain`. */
export const RTS_COMPONENTS = Object.freeze([...UNIT_COMPONENTS, ...ECONOMY_COMPONENTS]);

/**
 * The RTS systems in their run order: the economy first (gather, construct, train), then the
 * units (move, attack, death).
 */
export const RTS_SYSTEMS: readonly System[] = Object.freeze([
  gatherSystem,
  constructSystem,
  trainSystem,
  moveSystem,
  attackSystem,
  deathSystem,
]);

/** The result of `applyOrder`: applied, or refused with a reason (and nothing changed). */
export type OrderResult = { ok: true; order: Order } | { ok: false; error: string };

/**
 * Apply one order between ticks. It is checked first: against `orderSchema` (shape), then against
 * the world (`unitOrderRefusal` for `move`, `attack` and `stop`, `economyOrderRefusal` for
 * `build`, `train` and `gather`). A refused order returns `{ ok: false, error }`, one line starting
 * with `order <id>:`, and changes nothing. An accepted one makes its changes under the cause
 * `order:<id>`. Calling it during a step throws (`withCause` does).
 */
export function applyOrder(world: World, json: unknown): OrderResult {
  const parsed = parseOrder(json);
  const label =
    json !== null && typeof json === 'object' && typeof (json as { id?: unknown }).id === 'number'
      ? `order ${(json as { id: number }).id}`
      : 'order';
  if (!parsed.ok) return { ok: false, error: `${label}: ${parsed.error.split('\n').join(`\n${label}: `)}` };
  const order = parsed.order;
  const unitOrder = order.type === 'move' || order.type === 'attack' || order.type === 'stop';
  const why = unitOrder ? unitOrderRefusal(world, order) : economyOrderRefusal(world, order);
  if (why !== null) return { ok: false, error: `order ${order.id}: ${why}` };
  world.withCause(`order:${order.id}`, (w) => {
    if (order.type === 'move' || order.type === 'attack' || order.type === 'stop') writeUnitOrder(w, order);
    else writeEconomyOrder(w, order);
  });
  return { ok: true, order };
}
