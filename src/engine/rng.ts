/** Seeded xorshift32 so simulations and replays are deterministic. */
export class Rng {
  private s: number;
  constructor(seed = 0x9e3779b9) {
    this.s = seed >>> 0 || 1;
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
