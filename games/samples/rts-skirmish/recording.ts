import { canonicalJson, type JsonObject } from '@engine/core/headless';
import type { RecordedOrder } from '@kits/rts';

/**
 * The page's recording of a battle (Engine 0.9 T12, the "done when"): the player's orders with
 * their ticks (the kit's `RtsGame.recorded()`) and the sync hashes of the game's snapshot every
 * `hashEvery` ticks, written out as a run file that `pnpm -s cli run` replays headless to the same
 * hashes. The hash is the tools' state hash (`stateHash` in `engine/tools/headless-run.ts`): the
 * first 16 hex digits of the SHA-256 of the snapshot's canonical JSON, here through Web Crypto
 * (`crypto.subtle`, in the browser and in Node), so the page needs no Node.
 *
 * The page calls `reached(tick, snapshot)` after every step (and once at tick 0, before any
 * order): a hash tick takes the canonical JSON then, before the orders of that tick are applied,
 * which is where `run` hashes it too. Hashing is asynchronous; `runFile` waits for it.
 */

/** Sync hashes every 20 ticks (item 124). */
export const HASH_EVERY = 20;

/** The state hash `run` computes, from canonical JSON (async: Web Crypto). */
export async function stateHashOf(json: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

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
  private readonly hashes: { tick: number; hash: Promise<string> }[] = [];

  constructor(
    readonly seed: number,
    readonly hashEvery = HASH_EVERY,
  ) {}

  /** The game is at `tick` (no orders of this tick applied yet): hashes it on a hash tick. */
  reached(tick: number, snapshot: () => JsonObject): void {
    if (tick % this.hashEvery !== 0) return;
    if (this.hashes.some((h) => h.tick === tick)) return;
    this.hashes.push({ tick, hash: stateHashOf(canonicalJson(snapshot())) });
  }

  /** The last tick hashed so far (the length a run file can have). */
  lastHashed(): number {
    return this.hashes.reduce((last, h) => Math.max(last, h.tick), 0);
  }

  /**
   * The battle so far as a run file, ending at the last hash tick: `orders` are those applied
   * before it (`recorded`, the kit's `RtsGame.recorded()`). `game` is `..`, the game folder seen
   * from `games/samples/rts-skirmish/runs/`; a file saved elsewhere changes it. Null before the
   * first hash tick after 0 (a run plays at least one tick).
   */
  async runFile(recorded: readonly RecordedOrder[], game = '..'): Promise<RecordedRun | null> {
    const ticks = this.lastHashed();
    if (ticks === 0) return null;
    const hashes = await Promise.all(
      this.hashes.filter((h) => h.tick <= ticks).map(async (h) => ({ tick: h.tick, hash: await h.hash })),
    );
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
