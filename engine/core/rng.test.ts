import { describe, expect, it } from 'vitest';
import { Rng } from './rng';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('exposes its state, which moves with every draw', () => {
    const a = new Rng(42);
    const before = a.state();
    a.next();
    expect(a.state()).not.toBe(before);
    expect(a.state()).toBe(new Rng(42).next());
  });
  it('continues from a saved state with fromState', () => {
    const a = new Rng(42);
    for (let i = 0; i < 10; i++) a.next();
    const b = Rng.fromState(a.state());
    for (let i = 0; i < 100; i++) expect(b.next()).toBe(a.next());
  });
  it('fromState rejects anything that is not a state', () => {
    for (const bad of [0, -1, 1.5, 2 ** 32, Number.NaN]) {
      expect(() => Rng.fromState(bad)).toThrow('rng state must be an integer');
    }
  });
  it('produces ints in range', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });
  it('derived gives the same numbers for a seed and key, different ones for other keys', () => {
    const a = Rng.derived(7, 'mission:raid');
    const b = Rng.derived(7, 'mission:raid');
    for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
    const firsts = new Set(
      ['mission:raid', 'mission:convoy', 'mission:rescue'].flatMap((k) =>
        [7, 8].map((seed) => Rng.derived(seed, k).next()),
      ),
    );
    expect(firsts.size).toBe(6);
  });
});
