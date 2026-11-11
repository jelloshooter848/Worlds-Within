import { describe, expect, it } from 'vitest';
import { validate } from '../content/validate';
import {
  DEFAULT_FOG_LOOK,
  fogBoxes,
  fogState,
  presentFrameSchema,
  resolveFogLook,
  skinSchema,
  type PresentFog,
  type PresentFrame,
} from './index';

// Fog of war as presentation (Engine 0.16 part D, D3): the frame's `fog`, the skin's `fog` look
// and the boxes the 2D walk draws.

function frame(fog?: unknown): PresentFrame {
  return {
    frame: 0,
    size: { width: 64, height: 64 },
    entities: [],
    map: { id: 'm', version: 0, tileSize: 8, cols: 3, rows: 2, tiles: ['...', '...'] },
    events: [],
    status: {},
    ...(fog !== undefined && { fog: fog as PresentFog }),
  };
}

const errorsOf = (data: unknown, schema: Parameters<typeof validate>[2]) =>
  validate('x.json', data, schema).errors.map((e) => [e.path, e.code]);

describe("a frame's fog", () => {
  it('passes the schema as rows of 0, 1 and 2, and a frame without one is unchanged', () => {
    expect(errorsOf(frame(), presentFrameSchema)).toEqual([]);
    expect(errorsOf(frame({ cols: 3, rows: 2, cells: ['012', '220'] }), presentFrameSchema)).toEqual([]);
  });

  it('names a bad cell, a row of the wrong length and a missing row', () => {
    const bad = validate('f.json', frame({ cols: 3, rows: 2, cells: ['01x', '22'] }), presentFrameSchema);
    expect(bad.errors.map((e) => e.path)).toEqual(['fog.cells.0', 'fog.cells.1']);
    expect(bad.errors[0]!.message).toMatch(/0 \(unexplored\), 1 \(explored\) and 2 \(visible\)/);
    const short = validate('f.json', frame({ cols: 3, rows: 2, cells: ['012'] }), presentFrameSchema);
    expect(short.errors.map((e) => e.path)).toEqual(['fog.cells']);
    expect(
      errorsOf(frame({ cols: 3, rows: 2, cells: ['012', '012'], extra: 1 }), presentFrameSchema),
    ).toEqual([['fog.extra', 'unrecognized_keys']]);
  });

  it('reads cell states, outside the grid as visible', () => {
    const fog: PresentFog = { cols: 3, rows: 1, cells: ['012'] };
    expect([0, 1, 2, 3].map((c) => fogState(fog, c, 0))).toEqual([
      'unexplored',
      'explored',
      'visible',
      'visible',
    ]);
    expect(fogState(fog, 0, 5)).toBe('visible');
  });
});

describe("a skin's fog look", () => {
  const skin = (fog: unknown) => ({ backend: 'canvas2d', kinds: {}, fog });

  it('accepts a full look and fills the defaults', () => {
    const look = { unexplored: { color: '#101010', alpha: 0.9 }, explored: { alpha: 0.4 }, edge: 2 };
    expect(errorsOf(skin(look), skinSchema)).toEqual([]);
    expect(resolveFogLook(look)).toEqual({
      unexplored: { color: '#101010', alpha: 0.9 },
      explored: { color: '#000000', alpha: 0.4 },
      edge: 2,
    });
    expect(resolveFogLook(undefined)).toEqual(DEFAULT_FOG_LOOK);
  });

  it('rejects a bad field, naming it', () => {
    expect(errorsOf(skin({ explored: { alpha: 2 } }), skinSchema)).toEqual([
      ['fog.explored.alpha', 'too_big'],
    ]);
    expect(errorsOf(skin({ unexplored: { color: 'black' } }), skinSchema)).toEqual([
      ['fog.unexplored.color', 'invalid_format'],
    ]);
    expect(errorsOf(skin({ edge: 40 }), skinSchema)).toEqual([['fog.edge', 'too_big']]);
    expect(errorsOf(skin({ shade: 1 }), skinSchema)).toEqual([['fog.shade', 'unrecognized_keys']]);
  });

  it("rejects a minimap's fog fields on another item", () => {
    const hud = [{ status: 'hp', as: 'number', x: 0, y: 0, fog: true, teams: { own: '#fff' }, view: '#fff' }];
    expect(errorsOf({ backend: 'canvas2d', kinds: {}, hud }, skinSchema)).toEqual([
      ['hud.0.fog', 'bad_field'],
      ['hud.0.teams', 'bad_field'],
      ['hud.0.view', 'bad_field'],
    ]);
  });
});

describe('fogBoxes', () => {
  const look = resolveFogLook({ explored: { color: '#222222', alpha: 0.5 } });

  it('merges each row into runs of one state and leaves visible cells clear', () => {
    const fog: PresentFog = { cols: 4, rows: 2, cells: ['0012', '1111'] };
    expect(fogBoxes(fog, look, 8)).toEqual([
      { x: 0, y: 0, w: 16, h: 8, color: '#000000', alpha: 1 },
      { x: 16, y: 0, w: 8, h: 8, color: '#222222', alpha: 0.5 },
      { x: 0, y: 8, w: 32, h: 8, color: '#222222', alpha: 0.5 },
    ]);
  });

  it('draws a soft edge toward lighter cells as boxes that never overlap', () => {
    const soft = { ...look, edge: 2 };
    // An unexplored cell with a visible cell on its right only.
    const boxes = fogBoxes({ cols: 2, rows: 1, cells: ['02'] }, soft, 8);
    expect(boxes).toEqual([
      { x: 0, y: 0, w: 6, h: 8, color: '#000000', alpha: 1 },
      { x: 6, y: 0, w: 2, h: 8, color: '#000000', alpha: 0.5 },
    ]);
    // Every px of a 3x3 grid with a visible centre is covered exactly once, the centre none.
    const grid: PresentFog = { cols: 3, rows: 3, cells: ['000', '020', '000'] };
    const cover = new Array(24 * 24).fill(0);
    for (const b of fogBoxes(grid, soft, 8))
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) cover[y * 24 + x]++;
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 24; x++) {
        const centre = x >= 8 && x < 16 && y >= 8 && y < 16;
        expect(cover[y * 24 + x], `${x},${y}`).toBe(centre ? 0 : 1);
      }
  });

  it('cuts the edge to half a tile and skips cells at alpha 0', () => {
    const boxes = fogBoxes({ cols: 2, rows: 1, cells: ['02'] }, { ...look, edge: 16 }, 8);
    expect(boxes.map((b) => b.w)).toEqual([4, 4]);
    const clear = resolveFogLook({ explored: { alpha: 0 } });
    expect(fogBoxes({ cols: 2, rows: 1, cells: ['11'] }, clear, 8)).toEqual([]);
  });
});
