import { describe, expect, it } from 'vitest';
import { Rng } from '../rng';
import { fxRange, fxRng } from './rng';

const draws = (rng: Rng, n = 8) => Array.from({ length: n }, () => rng.next());

describe('fxRng', () => {
  it('draws the same numbers for the same seed, frame and stream', () => {
    expect(draws(fxRng(42, 10, 'sparks'))).toEqual(draws(fxRng(42, 10, 'sparks')));
  });

  it('draws differently for another seed, frame or stream', () => {
    const base = draws(fxRng(42, 10, 'sparks'));
    expect(draws(fxRng(43, 10, 'sparks'))).not.toEqual(base);
    expect(draws(fxRng(42, 11, 'sparks'))).not.toEqual(base);
    expect(draws(fxRng(42, 10, 'dust'))).not.toEqual(base);
  });

  it('keeps streams independent: drawing from one never moves another', () => {
    const alone = draws(fxRng(7, 3, 'dust'));
    const sparks = fxRng(7, 3, 'sparks');
    draws(sparks, 100);
    const dust = fxRng(7, 3, 'dust');
    draws(sparks, 5);
    expect(draws(dust)).toEqual(alone);
  });

  it('never touches a world RNG made from the same seed', () => {
    const world = new Rng(42);
    const before = world.state();
    draws(fxRng(42, 0, 'any'), 50);
    expect(world.state()).toBe(before);
    expect(draws(new Rng(42))).toEqual(draws(world));
  });

  it('refuses a frame that is not a whole number', () => {
    expect(() => fxRng(1, 1.5, 'x')).toThrow(/whole number/);
  });

  it('fxRange stays in [lo, hi)', () => {
    const rng = fxRng(9, 0, 'range');
    for (let i = 0; i < 200; i++) {
      const v = fxRange(rng, -2, 3);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(3);
    }
  });
});
