import { describe, expect, it } from 'vitest';
import { inReach, inRect, rectsOverlap, ringAround } from './footprint';

describe('footprints', () => {
  const rect = { x: 2, y: 3, w: 2, h: 1 };

  it('reach a rectangle from on it or any cell around it, diagonals included', () => {
    expect(inReach({ x: 2, y: 3 }, rect)).toBe(true);
    expect(inReach({ x: 1, y: 2 }, rect)).toBe(true);
    expect(inReach({ x: 4, y: 4 }, rect)).toBe(true);
    expect(inReach({ x: 5, y: 3 }, rect)).toBe(false);
    expect(inReach({ x: 3, y: 5 }, rect)).toBe(false);
    expect(inRect({ x: 3, y: 3 }, rect)).toBe(true);
    expect(inRect({ x: 4, y: 3 }, rect)).toBe(false);
  });

  it('overlap only when they share a cell', () => {
    expect(rectsOverlap(rect, { x: 3, y: 3, w: 1, h: 1 })).toBe(true);
    expect(rectsOverlap(rect, { x: 4, y: 3, w: 1, h: 1 })).toBe(false);
    expect(rectsOverlap(rect, { x: 0, y: 0, w: 5, h: 3 })).toBe(false);
  });

  it('ring the rectangle south side first, then east, north and west, each cell once', () => {
    expect(ringAround(rect)).toEqual([
      { x: 1, y: 4 },
      { x: 2, y: 4 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 3 },
      { x: 4, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
      { x: 1, y: 3 },
    ]);
  });
});
