import { describe, expect, it } from 'vitest';
import {
  ANGLE_STEPS,
  FIXED_ONE,
  QUARTER_TURN,
  chebyshev,
  clamp,
  cosFixed,
  directionAngle,
  directionVector,
  distFloor,
  distSq,
  iatan2,
  idiv,
  imod,
  ipow,
  isqrt,
  manhattan,
  scaleFixed,
  sinFixed,
  wrapAngle,
} from './math';

const ALL_ANGLES = Array.from({ length: ANGLE_STEPS }, (_, a) => a);

describe('integer helpers', () => {
  it('divides and wraps toward minus infinity', () => {
    expect([idiv(7, 2), idiv(-7, 2), idiv(7, -2), idiv(-8, 2), idiv(0, 5)]).toEqual([3, -4, -4, -4, 0]);
    expect([imod(7, 4), imod(-1, 4), imod(-8, 4), imod(5, -3)]).toEqual([3, 3, 0, -1]);
    expect(() => idiv(1, 0)).toThrow('division by zero');
    expect(() => idiv(1.5, 1)).toThrow('safe integer');
  });

  it('clamps', () => {
    expect([clamp(-3, 0, 10), clamp(4, 0, 10), clamp(11, 0, 10)]).toEqual([0, 4, 10]);
    expect(() => clamp(1, 2, 1)).toThrow('above');
  });

  it('raises to integer powers exactly', () => {
    expect([ipow(2, 0), ipow(2, 10), ipow(-3, 3), ipow(10, 15), ipow(2, 52)]).toEqual([
      1, 1024, -27, 1_000_000_000_000_000, 4_503_599_627_370_496,
    ]);
    expect(() => ipow(2, 54)).toThrow('safe integers');
    expect(() => ipow(2, -1)).toThrow('negative');
  });

  it('takes exact integer square roots', () => {
    expect([0, 1, 2, 3, 4, 15, 16, 17, 99, 100, 1_000_000].map(isqrt)).toEqual([
      0, 1, 1, 1, 2, 3, 4, 4, 9, 10, 1000,
    ]);
    const max = Number.MAX_SAFE_INTEGER; // 2^53 - 1
    expect(isqrt(max)).toBe(94_906_265);
    expect(isqrt(94_906_265 * 94_906_265)).toBe(94_906_265);
    expect(isqrt(94_906_265 * 94_906_265 - 1)).toBe(94_906_264);
    expect(() => isqrt(-1)).toThrow('negative');
  });

  it('measures distances on the grid', () => {
    expect(distSq(0, 0, 3, 4)).toBe(25);
    expect(distFloor(0, 0, 3, 4)).toBe(5);
    expect(distFloor(1, 1, 4, 3)).toBe(3); // sqrt(13) = 3.6
    expect(manhattan(-2, 5, 3, 1)).toBe(9);
    expect(chebyshev(-2, 5, 3, 1)).toBe(5);
  });
});

describe('fixed-point angles', () => {
  it('hits the exact values at the quarter turns', () => {
    expect([0, 64, 128, 192].map(sinFixed)).toEqual([0, FIXED_ONE, 0, -FIXED_ONE]);
    expect([0, 64, 128, 192].map(cosFixed)).toEqual([FIXED_ONE, 0, -FIXED_ONE, 0]);
    expect(sinFixed(32)).toBe(46341); // sin 45 degrees = 0.70711
    expect(sinFixed(1)).toBe(1608);
    expect(cosFixed(32)).toBe(46341);
  });

  it('never returns negative zero', () => {
    for (const a of ALL_ANGLES) {
      expect(Object.is(sinFixed(a), -0), `sin ${a}`).toBe(false);
      expect(Object.is(cosFixed(a), -0), `cos ${a}`).toBe(false);
    }
  });

  it('is symmetric around the circle', () => {
    for (const a of ALL_ANGLES) {
      expect(sinFixed(-a), `odd ${a}`).toBe(-sinFixed(a) || 0);
      expect(sinFixed(128 - a), `mirror ${a}`).toBe(sinFixed(a));
      expect(sinFixed(a + 128), `half turn ${a}`).toBe(-sinFixed(a) || 0);
      expect(cosFixed(-a), `even ${a}`).toBe(cosFixed(a));
      expect(cosFixed(a), `phase ${a}`).toBe(sinFixed(a + QUARTER_TURN));
    }
  });

  it('keeps sin^2 + cos^2 within table rounding of one', () => {
    for (const a of ALL_ANGLES) {
      const s = sinFixed(a);
      const c = cosFixed(a);
      expect(Math.abs(s * s + c * c - FIXED_ONE * FIXED_ONE), `angle ${a}`).toBeLessThanOrEqual(
        2 * FIXED_ONE,
      );
    }
  });

  it('rises through the first quarter', () => {
    for (let a = 1; a <= QUARTER_TURN; a++) expect(sinFixed(a)).toBeGreaterThan(sinFixed(a - 1));
  });

  it('wraps any integer angle', () => {
    expect([wrapAngle(-1), wrapAngle(256), wrapAngle(513)]).toEqual([255, 0, 1]);
    expect(sinFixed(64 + 256 * 3)).toBe(FIXED_ONE);
  });

  it('spaces directions evenly', () => {
    expect([0, 1, 2, 7, 8, -1].map((i) => directionAngle(i, 8))).toEqual([0, 32, 64, 224, 0, 224]);
    expect(directionAngle(3, 16)).toBe(48);
    expect(() => directionAngle(0, 6)).toThrow('do not divide');
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => directionVector(i, 8, 10))).toEqual([
      [10, 0],
      [7, 7],
      [0, 10],
      [-7, 7],
      [-10, 0],
      [-7, -7],
      [0, -10],
      [7, -7],
    ]);
    expect(directionVector(1, 4)).toEqual([0, FIXED_ONE]);
    expect(directionVector(2, 4)).toEqual([-FIXED_ONE, 0]);
  });

  it('scales fixed-point values with halves away from zero', () => {
    expect(scaleFixed(FIXED_ONE / 2, 3)).toBe(2);
    expect(scaleFixed(-FIXED_ONE / 2, 3)).toBe(-2);
    expect(scaleFixed(FIXED_ONE, 12345)).toBe(12345);
  });
});

describe('iatan2', () => {
  it('finds the axes and diagonals', () => {
    expect(iatan2(0, 0)).toBe(0);
    expect(iatan2(0, 5)).toBe(0);
    expect(iatan2(5, 5)).toBe(32);
    expect(iatan2(5, 0)).toBe(64);
    expect(iatan2(5, -5)).toBe(96);
    expect(iatan2(0, -5)).toBe(128);
    expect(iatan2(-5, -5)).toBe(160);
    expect(iatan2(-5, 0)).toBe(192);
    expect(iatan2(-5, 5)).toBe(224);
  });

  it('inverts every table angle', () => {
    for (const a of ALL_ANGLES) {
      expect(iatan2(sinFixed(a), cosFixed(a)), `angle ${a}`).toBe(a);
      const [x, y] = directionVector(a, ANGLE_STEPS, 1_000_000);
      expect(iatan2(y, x), `vector ${a}`).toBe(a);
    }
  });

  it('rounds to the nearest step', () => {
    // atan(1/2) = 26.57 degrees = 18.87 steps.
    expect(iatan2(1, 2)).toBe(19);
    // atan(1/100) = 0.573 degrees = 0.41 steps.
    expect(iatan2(1, 100)).toBe(0);
    expect(iatan2(-1, 100)).toBe(0);
    expect(iatan2(-2, 100)).toBe(255);
  });

  it('rejects coordinates it cannot multiply exactly', () => {
    expect(() => iatan2(1, 2147483649)).toThrow('2^31');
    expect(() => iatan2(0.5, 1)).toThrow('safe integer');
  });
});
