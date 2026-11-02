import { describe, expect, it } from 'vitest';
import {
  DIAGONAL_COST,
  FLOW_GROUP_SIZE,
  STEPS_8,
  STRAIGHT_COST,
  findPath,
  flowField,
  flowStep,
  stepCost,
  type Neighbourhood,
} from './astar';
import { UNREACHABLE, distanceField, nextStep, type Cell } from './path';
import { moveCost, type TerrainData } from './terrain';

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

const key = (c: Cell): string => `${c.x},${c.y}`;

/** Checks every step of a path is a legal move and returns its summed cost. */
function walkCost(t: TerrainData, from: Cell, cells: readonly Cell[], n: Neighbourhood): number {
  let at = from;
  let total = 0;
  for (const c of cells) {
    const cost = stepCost(t, at.x, at.y, { x: c.x - at.x, y: c.y - at.y }, n);
    expect(cost, `step ${key(at)} -> ${key(c)}`).not.toBeNull();
    expect(Math.abs(c.x - at.x) <= 1 && Math.abs(c.y - at.y) <= 1).toBe(true);
    if (n === 4) expect(Math.abs(c.x - at.x) + Math.abs(c.y - at.y)).toBe(1);
    total += cost as number;
    at = c;
  }
  return total;
}

/** A seeded 0..n-1 sequence from a tiny LCG (test-only; the sim uses world.rng). */
function lcg(seed: number): (n: number) => number {
  let s = seed >>> 0;
  return (n) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % n;
  };
}

/** A big map: grass with forest patches and rock walls with gaps, made from a seed. */
function bigMap(size: number, seed: number): TerrainData {
  const rand = lcg(seed);
  const rows: string[] = [];
  for (let y = 0; y < size; y++) {
    let row = '';
    for (let x = 0; x < size; x++) {
      const wall = x % 16 === 8 && y % 32 !== 0 && y % 32 !== 1;
      row += wall ? '#' : rand(10) === 0 ? 'f' : rand(25) === 0 ? '#' : '.';
    }
    rows.push(row);
  }
  return grid(rows);
}

describe('stepCost', () => {
  it('scales 8-way steps and refuses to cut corners', () => {
    const t = grid(['.#', '..']);
    expect(stepCost(t, 0, 1, { x: 1, y: 0 }, 8)).toBe(STRAIGHT_COST);
    expect(stepCost(t, 0, 1, { x: 1, y: 0 }, 4)).toBe(1);
    // Into the rock itself: no.
    expect(stepCost(t, 0, 1, { x: 1, y: -1 }, 8)).toBeNull();
    // (0, 0) -> (1, 1) passes the rock at (1, 0): a corner cut, so not allowed.
    expect(stepCost(t, 0, 0, { x: 1, y: 1 }, 8)).toBeNull();
    const open = grid(['..', '..']);
    expect(stepCost(open, 0, 0, { x: 1, y: 1 }, 8)).toBe(DIAGONAL_COST);
  });
});

describe('findPath (A*)', () => {
  it('4-way, finds a cheapest path with the same cost as the distance field', () => {
    const t = grid(['.f.', '...']);
    const path = findPath(t, { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(path?.cost).toBe(4); // around the forest: 4 rather than 5 + 1
    expect(path?.cells.map(key)).toEqual(['0,1', '1,1', '2,1', '2,0']);
    expect(walkCost(t, { x: 0, y: 0 }, path?.cells ?? [], 4)).toBe(4);
  });

  it('8-way, takes diagonals and goes round forest when cheaper', () => {
    const t = grid(['....', '.ff.', '....']);
    const path = findPath(t, { x: 0, y: 0 }, { x: 3, y: 2 }, { neighbourhood: 8 });
    // Through forest diagonally: 14*5 = 70. Round the edge: 10 + 10 + 14 + 10 = 44 (or the like).
    expect(path?.cost).toBe(44);
    for (const c of path?.cells ?? []) expect(t.cells[c.y * t.width + c.x]).not.toBe(1);
  });

  it('never enters impassable cells or cuts corners', () => {
    const t = grid(['.#...', '.#.#.', '...#.']);
    const path = findPath(t, { x: 0, y: 0 }, { x: 4, y: 0 }, { neighbourhood: 8 });
    expect(path).not.toBeNull();
    const cells = path?.cells ?? [];
    for (const c of cells) expect(moveCost(t, c.x, c.y)).not.toBeNull();
    expect(walkCost(t, { x: 0, y: 0 }, cells, 8)).toBe(path?.cost);
    // Every diagonal here would pass a rock corner ((0,1) -> (1,2) passes (1,1); (2,1) -> (3,0)
    // passes (3,1)), so the way is all straight steps.
    expect(cells.map(key)).toEqual(['0,1', '0,2', '1,2', '2,2', '2,1', '2,0', '3,0', '4,0']);
  });

  it('returns null when there is no way, or the goal or start is rock', () => {
    const t = grid(['.#.', '.#.']);
    expect(findPath(t, { x: 0, y: 0 }, { x: 2, y: 0 }, { neighbourhood: 8 })).toBeNull();
    expect(findPath(t, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
    expect(findPath(t, { x: 1, y: 0 }, { x: 0, y: 0 })).toBeNull();
    expect(findPath(t, { x: -1, y: 0 }, { x: 0, y: 0 })).toBeNull();
    // Diagonal gaps between two rocks do not let a unit through.
    const pinched = grid(['.#', '#.']);
    expect(findPath(pinched, { x: 0, y: 0 }, { x: 1, y: 1 }, { neighbourhood: 8 })).toBeNull();
  });

  it('gives an empty path at the goal and null past the expansion cap', () => {
    const t = grid(['.....']);
    expect(findPath(t, { x: 2, y: 0 }, { x: 2, y: 0 })).toEqual({ cells: [], cost: 0, expanded: 0 });
    expect(findPath(t, { x: 0, y: 0 }, { x: 4, y: 0 }, { maxExpanded: 3 })).toBeNull();
    expect(findPath(t, { x: 0, y: 0 }, { x: 4, y: 0 }, { maxExpanded: 5 })?.cost).toBe(4);
  });

  it('breaks ties the same way every run, on fresh terrain objects too', () => {
    const rows = ['......', '......', '......', '......'];
    const run = (): string[] =>
      findPath(grid(rows), { x: 0, y: 0 }, { x: 5, y: 3 }, { neighbourhood: 8 })?.cells.map(key) ?? [];
    const first = run();
    for (let i = 0; i < 5; i++) expect(run()).toEqual(first);
    expect(first).toEqual(['1,1', '2,2', '3,3', '4,3', '5,3']);
    const four = (): string[] => findPath(grid(rows), { x: 0, y: 0 }, { x: 2, y: 2 })?.cells.map(key) ?? [];
    expect(four()).toEqual(four());
  });

  it('matches the flow field cost from many starts on a big map (always a cheapest path)', () => {
    const t = bigMap(64, 7);
    const goal = { x: 60, y: 60 };
    for (const n of [4, 8] as const) {
      const field = flowField(t, goal, { neighbourhood: n });
      const rand = lcg(n);
      for (let i = 0; i < 40; i++) {
        const from = { x: rand(64), y: rand(64) };
        const want =
          moveCost(t, from.x, from.y) === null ? UNREACHABLE : (field.dist[from.y * 64 + from.x] as number);
        const path = findPath(t, from, goal, { neighbourhood: n });
        if (want === UNREACHABLE) expect(path).toBeNull();
        else {
          expect(path?.cost).toBe(want);
          expect(walkCost(t, from, path?.cells ?? [], n)).toBe(want);
        }
      }
    }
  });
});

describe('flowField and flowStep (groups)', () => {
  it('4-way is exactly distanceField and nextStep', () => {
    const t = grid(['...', '.#.', '...']);
    const field = flowField(t, { x: 2, y: 2 });
    expect(field.dist).toBe(distanceField(t, { x: 2, y: 2 }, false));
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++)
        expect(flowStep(t, field, { x, y })).toEqual(nextStep(t, field.dist, { x, y }));
  });

  it('8-way, with near, stops next to a goal no one can enter', () => {
    const t = grid(['...', '.#.', '...']);
    const field = flowField(t, { x: 1, y: 1 }, { neighbourhood: 8, near: true });
    expect(field.dist[0]).toBe(0);
    expect(flowStep(t, field, { x: 0, y: 0 })).toBeNull();
  });

  it('a group of units following one field all reach the goal', () => {
    const t = bigMap(96, 3);
    const goal = { x: 90, y: 50 };
    const field = flowField(t, goal, { neighbourhood: 8 });
    const rand = lcg(11);
    const units: Cell[] = [];
    while (units.length < 200) {
      const c = { x: rand(40), y: rand(96) };
      if (field.dist[c.y * 96 + c.x] !== UNREACHABLE && moveCost(t, c.x, c.y) !== null) units.push(c);
    }
    for (let tick = 0; tick < 1000; tick++) {
      let moved = false;
      for (let i = 0; i < units.length; i++) {
        const at = units[i] as Cell;
        const step = flowStep(t, field, at);
        if (!step) continue;
        expect(stepCost(t, at.x, at.y, { x: step.x - at.x, y: step.y - at.y }, 8)).not.toBeNull();
        units[i] = step;
        moved = true;
      }
      if (!moved) break;
    }
    for (const u of units) expect(u).toEqual(goal);
  });
});

describe('A* vs flow field (measured)', () => {
  // Work is counted in cells expanded, which is deterministic, rather than in milliseconds. A flow
  // field expands every reachable cell once (59,173 here); one A* across this map expands about
  // 11,000 on average (16,709 for the first unit), 3.35 million for 300 units. Timed in Node 22
  // (warm): the field about 55 ms, one cross-map A* about 12 ms, so the break-even is 4 to 5 units
  // (FLOW_GROUP_SIZE). A* for a goal 8 cells away is about 0.13 ms.
  it('300 units sharing a goal on a 256x256 map: one field is far less work than A* each', () => {
    const size = 256;
    const t = bigMap(size, 5);
    const goal = { x: 250, y: 128 };
    const field = flowField(t, goal, { neighbourhood: 8 });
    let fieldCells = 0;
    for (const d of field.dist) if (d !== UNREACHABLE) fieldCells++;

    const rand = lcg(21);
    let astarCells = 0;
    let units = 0;
    let firstUnit = 0;
    while (units < 300) {
      const from = { x: rand(64), y: rand(size) };
      if (field.dist[from.y * size + from.x] === UNREACHABLE || moveCost(t, from.x, from.y) === null)
        continue;
      const path = findPath(t, from, goal, { neighbourhood: 8 });
      expect(path?.cost).toBe(field.dist[from.y * size + from.x]);
      astarCells += path?.expanded ?? 0;
      if (units === 0) firstUnit = astarCells;
      units++;
    }
    // One cross-map A* already costs a fair share of a field; by FLOW_GROUP_SIZE units it costs more.
    expect(firstUnit * FLOW_GROUP_SIZE).toBeGreaterThan(fieldCells);
    expect(astarCells).toBeGreaterThan(fieldCells * 50);
  });
});

describe('STEPS_8', () => {
  it('lists N, NE, E, SE, S, SW, W, NW', () => {
    expect(STEPS_8.map(key)).toEqual(['0,-1', '1,-1', '1,0', '1,1', '0,1', '-1,1', '-1,0', '-1,-1']);
  });
});
