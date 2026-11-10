import { describe, expect, it } from 'vitest';
import { nineSlice, sliceInsets } from './nine-slice';
import { panelDraws } from './paint';

describe('nine-slice panels (Engine 0.16 T6)', () => {
  it('keeps corners, stretches edges and fills the centre', () => {
    const pieces = nineSlice({ w: 9, h: 9 }, sliceInsets(3), { x: 10, y: 20, w: 30, h: 15 });
    expect(pieces).toHaveLength(9);
    expect(pieces[0]).toEqual({ sx: 0, sy: 0, sw: 3, sh: 3, x: 10, y: 20, w: 3, h: 3 });
    expect(pieces[1]).toEqual({ sx: 3, sy: 0, sw: 3, sh: 3, x: 13, y: 20, w: 24, h: 3 });
    expect(pieces[2]).toEqual({ sx: 6, sy: 0, sw: 3, sh: 3, x: 37, y: 20, w: 3, h: 3 });
    expect(pieces[4]).toEqual({ sx: 3, sy: 3, sw: 3, sh: 3, x: 13, y: 23, w: 24, h: 9 });
    expect(pieces[8]).toEqual({ sx: 6, sy: 6, sw: 3, sh: 3, x: 37, y: 32, w: 3, h: 3 });
    // Every pixel of the box is covered exactly once.
    const area = pieces.reduce((a, p) => a + p.w * p.h, 0);
    expect(area).toBe(30 * 15);
  });

  it('takes four insets', () => {
    const pieces = nineSlice(
      { w: 10, h: 6 },
      { left: 1, top: 2, right: 3, bottom: 1 },
      { x: 0, y: 0, w: 20, h: 10 },
    );
    expect(pieces.map((p) => [p.sx, p.sw, p.x, p.w]).slice(0, 3)).toEqual([
      [0, 1, 0, 1],
      [1, 6, 1, 16],
      [7, 3, 17, 3],
    ]);
    expect(pieces.map((p) => [p.sy, p.sh, p.y, p.h]).filter((_, i) => i % 3 === 0)).toEqual([
      [0, 2, 0, 2],
      [2, 3, 2, 7],
      [5, 1, 9, 1],
    ]);
  });

  it('tiles edges and the centre at their size, cutting the last copy', () => {
    const pieces = nineSlice({ w: 6, h: 6 }, sliceInsets(2), { x: 0, y: 0, w: 9, h: 6 }, 'tile');
    const top = pieces.filter((p) => p.y === 0 && p.sx === 2);
    expect(top.map((p) => [p.x, p.w, p.sw])).toEqual([
      [2, 2, 2],
      [4, 2, 2],
      [6, 1, 1],
    ]);
  });

  it('shrinks corners into a box smaller than them, dropping empty pieces', () => {
    const pieces = nineSlice({ w: 8, h: 8 }, sliceInsets(3), { x: 0, y: 0, w: 4, h: 8 });
    const row = pieces.filter((p) => p.y === 0);
    expect(row.map((p) => [p.sx, p.sw, p.x, p.w])).toEqual([
      [0, 2, 0, 2],
      [6, 2, 2, 2],
    ]);
  });

  it('turns pieces into image draws of the frame', () => {
    const draws = panelDraws({ sheet: 's', palette: 'p', frame: 'panel' }, { w: 3, h: 3 }, sliceInsets(1), {
      x: 0,
      y: 0,
      w: 5,
      h: 5,
    });
    expect(draws).toHaveLength(9);
    expect(draws[4]).toEqual({
      kind: 'image',
      sheet: 's',
      palette: 'p',
      frame: 'panel',
      sx: 1,
      sy: 1,
      sw: 1,
      sh: 1,
      x: 1,
      y: 1,
      w: 3,
      h: 3,
    });
  });
});
