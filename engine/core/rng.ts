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
