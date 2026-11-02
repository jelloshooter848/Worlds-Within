/** Seeded xorshift32 so simulations and replays are deterministic. */
export class Rng {
  private s: number;
  constructor(seed = 0x9e3779b9) {
    this.s = seed >>> 0 || 1;
  }
  /**
   * An Rng that continues from `state` (a value `state()` returned, such as one kept in a save):
   * it draws exactly what the saved generator would have drawn next. Throws on anything that is not
   * a state (an integer from 1 to 2^32 - 1; xorshift never reaches 0).
   */
  static fromState(state: number): Rng {
    if (!Number.isInteger(state) || state < 1 || state > 0xffffffff) {
      throw new Error(`rng state must be an integer from 1 to 4294967295, got ${state}`);
    }
    return new Rng(state);
  }
  /**
   * An Rng of its own for `key` under `seed` (FNV-1a of the key mixed with the seed, then a
   * finalizer): the same seed and key always give the same numbers, and drawing from it never moves
   * any other generator. Used where a draw must not depend on when it happens (a mission's
   * delegation draw, item 154).
   */
  static derived(seed: number, key: string): Rng {
    let h = 0x811c9dc5 ^ (seed >>> 0);
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return new Rng(h >>> 0);
  }
  /** The generator's internal state (unsigned 32-bit): two Rngs with the same state draw the same numbers. */
  state(): number {
    return this.s;
  }
  /** Unsigned 32-bit. */
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x;
  }
  /** Integer in [0, n). */
  int(n: number): number {
    return this.next() % n;
  }
  /** Float in [0, 1). */
  float(): number {
    return this.next() / 0x100000000;
  }
  chance(p: number): boolean {
    return this.float() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)] as T;
  }
}
