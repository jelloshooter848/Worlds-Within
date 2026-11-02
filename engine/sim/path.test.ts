import { describe, expect, it } from 'vitest';
import { UNREACHABLE, distanceField, nextStep } from './path';
import type { TerrainData } from './terrain';

/** Terrain from rows: `.` grass (cost 1), `f` forest (cost 5), `#` rock (impassable). */
function grid(rows: string[]): TerrainData {
  const types = [
    { name: 'grass', cost: 1, passable: true },
    { name: 'forest', cost: 5, passable: true },
    { name: 'rock', cost: 1, passable: false },
  ];
  const cells = rows.flatMap((r) => [...r].map((c) => '.f#'.indexOf(c)));
  return { width: rows[0]?.length ?? 0, height: rows.length, types, elevation: cells.map(() => 0), cells };
}

/** Walk from `from` to the field's goal, returning the cells entered. */
function route(t: TerrainData, field: Int32Array, from: { x: number; y: number }): string[] {
  const out: string[] = [];
  let at = from;
  for (let i = 0; i < 100; i++) {
    const step = nextStep(t, field, at);
    if (!step) return out;
    out.push(`${step.x},${step.y}`);
    at = step;
  }
  throw new Error('no arrival');
}

describe('distanceField and nextStep', () => {
  it('sums the cost of each cell entered and never enters rock', () => {
    const t = grid(['...', '.#.', '...']);
    const field = distanceField(t, { x: 2, y: 2 }, false);
    expect([...field]).toEqual([4, 3, 2, 3, UNREACHABLE, 1, 2, 1, 0]);
    // Ties go north, east, south, west in that order: east first from the corner.
    expect(route(t, field, { x: 0, y: 0 })).toEqual(['1,0', '2,0', '2,1', '2,2']);
  });

  it('goes around costly ground when that is cheaper', () => {
    const t = grid(['.f.', '...']);
    const field = distanceField(t, { x: 2, y: 0 }, false);
    expect(field[0]).toBe(4); // south, east, east, north: 4 rather than 5 + 1 through the forest
    expect(route(t, field, { x: 0, y: 0 })).toEqual(['0,1', '1,1', '2,1', '2,0']);
  });

  it('with near, stops next to a goal no one can enter', () => {
    const t = grid(['...', '.#.', '...']);
    const field = distanceField(t, { x: 1, y: 1 }, true);
    expect(field[1]).toBe(0);
    expect(field[0]).toBe(1);
    expect(nextStep(t, field, { x: 1, y: 0 })).toBeNull();
    expect(route(t, field, { x: 0, y: 0 })).toEqual(['1,0']);
  });

  it('gives no step when the goal cannot be reached', () => {
    const t = grid(['.#.', '.#.']);
    const field = distanceField(t, { x: 2, y: 0 }, false);
    expect(field[0]).toBe(UNREACHABLE);
    expect(nextStep(t, field, { x: 0, y: 0 })).toBeNull();
  });

  it('returns the same field for the same terrain object and goal', () => {
    const t = grid(['...']);
    expect(distanceField(t, { x: 0, y: 0 }, false)).toBe(distanceField(t, { x: 0, y: 0 }, false));
    expect([...distanceField(grid(['...']), { x: 0, y: 0 }, false)]).toEqual([0, 1, 2]);
  });
});
