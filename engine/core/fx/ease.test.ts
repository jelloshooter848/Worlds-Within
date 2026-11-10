import { describe, expect, it } from 'vitest';
import { ease, EASE_NAMES, isEaseName } from './ease';

describe('easing curves', () => {
  it.each(EASE_NAMES.map((n) => [n]))('%s starts at 0 and ends at 1 exactly', (name) => {
    expect(ease(name, 0)).toBe(0);
    expect(ease(name, 1)).toBe(1);
    // Clamped outside [0, 1].
    expect(ease(name, -1)).toBe(0);
    expect(ease(name, 2)).toBe(1);
    // Finite everywhere between.
    for (let i = 1; i < 20; i++) expect(Number.isFinite(ease(name, i / 20))).toBe(true);
  });

  it('nears its ends continuously (all but step)', () => {
    for (const name of EASE_NAMES.filter((n) => n !== 'step')) {
      expect(Math.abs(ease(name, 1e-6)), name).toBeLessThan(0.01);
      expect(Math.abs(ease(name, 1 - 1e-6) - 1), name).toBeLessThan(0.01);
    }
  });

  it('has the shapes it is named for', () => {
    expect(ease('linear', 0.25)).toBe(0.25);
    expect(ease(undefined, 0.25)).toBe(0.25);
    expect(ease('quadIn', 0.5)).toBe(0.25);
    expect(ease('quadOut', 0.5)).toBe(0.75);
    expect(ease('cubicIn', 0.5)).toBe(0.125);
    expect(ease('quartIn', 0.5)).toBe(0.0625);
    for (const n of [
      'quadInOut',
      'cubicInOut',
      'quartInOut',
      'sineInOut',
      'backInOut',
      'bounceInOut',
    ] as const)
      expect(ease(n, 0.5), n).toBeCloseTo(0.5, 10);
    expect(ease('sineOut', 0.5)).toBeCloseTo(Math.SQRT1_2, 10);
    // Back pulls back first, then overshoots on the way out.
    expect(ease('backIn', 0.2)).toBeLessThan(0);
    expect(ease('backOut', 0.8)).toBeGreaterThan(1);
    expect(ease('elasticOut', 0.2)).toBeGreaterThan(1);
    expect(ease('bounceOut', 0.5)).toBeGreaterThan(0.5);
    expect(ease('step', 0.99)).toBe(0);
  });

  it('knows its names', () => {
    expect(isEaseName('backOut')).toBe(true);
    expect(isEaseName('wobble')).toBe(false);
    expect(isEaseName('toString')).toBe(false);
  });
});
