import { describe, expect, it } from 'vitest';
import { clampBoxInside, LABEL_EDGE_MARGIN, unionBox } from './label-clamp';

// Keeping world labels inside the picture (Engine 0.16 polish P6, gap M45).

const PIC = { width: 320, height: 180 };
const M = LABEL_EDGE_MARGIN;

describe('clampBoxInside', () => {
  it('leaves a box already inside the margins where it is', () => {
    expect(clampBoxInside({ x: 100, y: 50, w: 40, h: 6 }, PIC)).toEqual({ x: 100, y: 50, w: 40, h: 6 });
    expect(clampBoxInside({ x: M, y: M, w: 40, h: 6 }, PIC)).toEqual({ x: M, y: M, w: 40, h: 6 });
  });

  it('moves a box past each edge back inside, keeping its size', () => {
    expect(clampBoxInside({ x: -14, y: 50, w: 40, h: 6 }, PIC)).toEqual({ x: M, y: 50, w: 40, h: 6 });
    expect(clampBoxInside({ x: 300, y: 50, w: 40, h: 6 }, PIC)).toEqual({
      x: 320 - M - 40,
      y: 50,
      w: 40,
      h: 6,
    });
    expect(clampBoxInside({ x: 100, y: -3, w: 40, h: 6 }, PIC)).toEqual({ x: 100, y: M, w: 40, h: 6 });
    expect(clampBoxInside({ x: 100, y: 178, w: 40, h: 6 }, PIC)).toEqual({
      x: 100,
      y: 180 - M - 6,
      w: 40,
      h: 6,
    });
  });

  it('moves a box past a corner in both directions', () => {
    expect(clampBoxInside({ x: -5, y: -5, w: 20, h: 10 }, PIC)).toEqual({ x: M, y: M, w: 20, h: 10 });
    expect(clampBoxInside({ x: 310, y: -5, w: 20, h: 10 }, PIC)).toEqual({ x: 300 - M, y: M, w: 20, h: 10 });
    expect(clampBoxInside({ x: -5, y: 175, w: 20, h: 10 }, PIC)).toEqual({ x: M, y: 170 - M, w: 20, h: 10 });
    expect(clampBoxInside({ x: 310, y: 175, w: 20, h: 10 }, PIC)).toEqual({
      x: 300 - M,
      y: 170 - M,
      w: 20,
      h: 10,
    });
  });

  it('puts a box bigger than the picture on the start margins', () => {
    expect(clampBoxInside({ x: -40, y: -10, w: 400, h: 200 }, PIC)).toEqual({ x: M, y: M, w: 400, h: 200 });
    expect(clampBoxInside({ x: 50, y: 60, w: 400, h: 200 }, PIC)).toEqual({ x: M, y: M, w: 400, h: 200 });
  });

  it('takes a margin', () => {
    expect(clampBoxInside({ x: -4, y: 0, w: 10, h: 4 }, PIC, 0)).toEqual({ x: 0, y: 0, w: 10, h: 4 });
    expect(clampBoxInside({ x: 315, y: 0, w: 10, h: 4 }, PIC, 5)).toEqual({ x: 305, y: 5, w: 10, h: 4 });
  });
});

describe('unionBox', () => {
  it('holds every box, or is null for none', () => {
    expect(unionBox([])).toBeNull();
    expect(
      unionBox([
        { x: 10, y: 20, w: 11, h: 4 },
        { x: 8, y: 25, w: 16, h: 3 },
      ]),
    ).toEqual({ x: 8, y: 20, w: 16, h: 8 });
  });
});
