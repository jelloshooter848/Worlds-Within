import type { JsonObject } from '@engine/core/headless';
import { stateHash } from '@engine/core/state-hash';
import type { RecordedOrder } from '@kits/rts';

/**
 * The page's recording of a battle (Engine 0.9 T12, the "done when"): the player's orders with
 * their ticks (the kit's `RtsGame.recorded()`) and the sync hashes of the game's snapshot every
 * `hashEvery` ticks, written out as a run file that `pnpm -s cli run` replays headless to the same
 * hashes. The hash is the core's `stateHash` (`engine/core/state-hash.ts`), the one the tools and
 * the shell's step hook use: the first 16 hex digits of the SHA-256 of the snapshot's canonical
 * JSON, synchronous and in plain TypeScript, so the page needs no Node (Engine 0.15 T15, the API
 * review: the sample's own Web Crypto copy, `stateHashOf`, is gone).
 *
 * The page calls `reached(tick, snapshot)` after every step (and once at tick 0, before any
 * order): a hash tick takes the canonical JSON then, before the orders of that tick are applied,
 * which is where `run` hashes it too.
 */

/** Sync hashes every 20 ticks (item 124). */
export const HASH_EVERY = 20;

/** A recorded battle as a run file (`engine/tools/run-file.ts`). */
export interface RecordedRun {
  game: string;
  seed: number;
  ticks: number;
  orders: RecordedOrder[];
  hashEvery: number;
  hashes: { tick: number; hash: string }[];
}

export class BattleRecorder {
  private readonly hashes: { tick: number; hash: string }[] = [];

  constructor(
    readonly seed: number,
    readonly hashEvery = HASH_EVERY,
  ) {}

  /** The game is at `tick` (no orders of this tick applied yet): hashes it on a hash tick. */
  reached(tick: number, snapshot: () => JsonObject): void {
    if (tick % this.hashEvery !== 0) return;
    if (this.hashes.some((h) => h.tick === tick)) return;
    this.hashes.push({ tick, hash: stateHash(snapshot()) });
  }

  /** The last tick hashed so far (the length a run file can have). */
  lastHashed(): number {
    return this.hashes.reduce((last, h) => Math.max(last, h.tick), 0);
  }

  /**
   * The battle so far as a run file, ending at the last hash tick: `orders` are those applied
   * before it (`recorded`, the kit's `RtsGame.recorded()`). `game` is `..`, the game folder seen
   * from `games/rts-classic/runs/`; a file saved elsewhere changes it. Null before the
   * first hash tick after 0 (a run plays at least one tick).
   */
  async runFile(recorded: readonly RecordedOrder[], game = '..'): Promise<RecordedRun | null> {
    const ticks = this.lastHashed();
    if (ticks === 0) return null;
    const hashes = this.hashes.filter((h) => h.tick <= ticks).map((h) => ({ tick: h.tick, hash: h.hash }));
    return {
      game,
      seed: this.seed,
      ticks,
      orders: recorded.filter((o) => o.tick < ticks).map((o) => ({ ...o })),
      hashEvery: this.hashEvery,
      hashes,
    };
  }
}
