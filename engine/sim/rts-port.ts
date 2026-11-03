import type { Order } from '../core/orders';
import { applyOrder } from './rts-orders';
import type { World } from './world';

/**
 * The world side of the RTS kit's game (Engine 0.15 T6, gap M27; docs/BUILD-LOG.md, Engine 0.15,
 * decision 7): what `kits/rts`'s `RtsWorldPort` asks of a world, over an `engine/sim` world, so a
 * game's glue gives `rtsGame` its world in one call instead of writing the three lines itself:
 *
 *   rtsGame({ world: rtsWorldPort(world), enemy, seed });
 *
 * The sim may not import the kit (and the kit not the sim), so the type is written here by shape;
 * `tests/kits/rts-sim.test.ts` (outside the layers) checks it and the kit's `RtsWorldPort` fit
 * each other both ways. `snapshot` is `World.snapshot()`, `applyOrder` is `applyOrder(world,
 * order)` with only its refusal kept, `step` is `World.step()`.
 */
export interface RtsPort {
  snapshot(): unknown;
  applyOrder(order: Order): { ok: true } | { ok: false; error: string };
  step(): void;
}

/** The RTS kit's port over `world` (see {@link RtsPort}). */
export function rtsWorldPort(world: World): RtsPort {
  return {
    snapshot: () => world.snapshot(),
    applyOrder(order) {
      const applied = applyOrder(world, order);
      return applied.ok ? { ok: true } : { ok: false, error: applied.error };
    },
    step: () => world.step(),
  };
}
