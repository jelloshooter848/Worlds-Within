import { describe, expect, it } from 'vitest';
import { validate } from '@engine/core/content/validate';
import { presentFrameSchema, type PresentFrame } from '@engine/core/present';
import { battleSnapshot } from './__fixtures__/world';
import {
  buildingSight,
  fogView,
  isVisible,
  RTS_BUILDING_SIGHT_EXTRA,
  RTS_UNIT_SIGHT,
  RtsFogMemory,
  unitSight,
  visibility,
} from './fog';
import { presentWorld, RtsPresentState } from './present';
import { readWorld, type RtsView } from './snapshot';

// Fog of war (Engine 0.16 part D, D5): sight, explored memory, last-seen buildings, enemies hidden.

const SIZE = { width: 320, height: 240 };

/**
 * The 8 x 6 battle with short sight: every red unit sees 1 cell, the hall 1 cell from its
 * footprint (0,0)-(1,1); red's worker stands at (2,1), its soldiers at (1,3) and (2,3). Blue's
 * barracks site is at (6,0)-(7,1), its soldiers at (6,4) and (7,4), the gold node at (4,0).
 */
function view(tick = 5, edit: (v: RtsView) => void = () => {}): RtsView {
  const v = readWorld(battleSnapshot({ tick }));
  for (const u of v.units) u.sight = 1;
  v.types!.buildings['hall']!.sight = 1;
  edit(v);
  return v;
}

const seen = (v: RtsView) => {
  const vis = visibility(v, 'red');
  const rows: string[] = [];
  for (let y = 0; y < vis.height; y++) {
    let row = '';
    for (let x = 0; x < vis.width; x++) row += isVisible(vis, x, y) ? '#' : '.';
    rows.push(row);
  }
  return rows;
};

const ids = (frame: PresentFrame) => frame.entities.map((e) => e.id);

describe('visibility', () => {
  it("is the cells within each unit's and building's sight (distance floored, from the footprint)", () => {
    expect(seen(view())).toEqual(['####....', '####....', '####....', '####....', '####....', '........']);
  });

  it('grows with the sight radius: sight 2 reaches two cells straight and one and one diagonal', () => {
    const v = view(5, (x) => {
      x.units = x.units.filter((u) => u.id === 5);
      x.buildings = x.buildings.filter((b) => b.faction !== 'red');
      x.units[0]!.sight = 2;
    });
    // The worker at (2,1): (4,1) and (2,3) at 2 are seen, (4,3) at 2.8 (floored 2) too, (4,4) not.
    expect(seen(v)).toEqual(['#####...', '#####...', '#####...', '#####...', '........', '........']);
    v.units[0]!.sight = 0;
    expect(seen(v)).toEqual(['........', '..#.....', '........', '........', '........', '........']);
  });

  it("falls back to the type's sight, then RTS_UNIT_SIGHT; a building without one to its size", () => {
    const v = readWorld(battleSnapshot());
    const worker = { ...v.units.find((u) => u.id === 5)! };
    delete worker.sight;
    expect(unitSight(v, worker)).toBe(4); // the fixture's worker type
    expect(unitSight(v, { ...worker, type: 'nobody' })).toBe(RTS_UNIT_SIGHT);
    expect(unitSight(v, { ...worker, sight: 7 })).toBe(7);
    const hall = v.buildings.find((b) => b.id === 3)!;
    expect(buildingSight(v, hall)).toBe(2 + RTS_BUILDING_SIGHT_EXTRA);
    v.types!.buildings['hall']!.sight = 6;
    expect(buildingSight(v, hall)).toBe(6);
  });

  it('is empty for another faction with nothing on the map, and for a world without terrain', () => {
    expect(visibility(view(), 'green').cells.every((c) => c === 0)).toBe(true);
    const bare = view(5, (v) => (v.terrain = null));
    expect(visibility(bare, 'red').cells.length).toBe(0);
  });
});

describe('fogView and RtsFogMemory', () => {
  it('shows own units and buildings always, enemy units only where seen now', () => {
    const v = view(5, (x) => {
      x.units.find((u) => u.id === 9)!.x = 3; // a blue soldier walks into sight at (3,4)
    });
    const fv = fogView(v, 'red');
    expect(fv.units.map((u) => u.id)).toEqual([5, 6, 7, 9]);
    expect(fv.buildings.map((b) => b.thing.id)).toEqual([3]);
    expect(fv.resources).toEqual([]); // the gold node at (4,0) is out of sight
    expect(fv.fog!.cells).toEqual(['22220000', '22220000', '22220000', '22220000', '22220000', '00000000']);
  });

  it('remembers explored cells and enemy buildings and nodes as last seen', () => {
    const memory = new RtsFogMemory();
    // Tick 5: the worker scouts east to (5,1) and sees the barracks site at 15 of 30 and the gold.
    const scout = view(5, (x) => (x.units.find((u) => u.id === 5)!.x = 5));
    const first = fogView(scout, 'red', memory);
    expect(first.buildings.map((b) => [b.thing.id, b.remembered])).toEqual([
      [3, false],
      [8, false],
    ]);
    expect(first.resources.map((r) => [r.thing.id, r.remembered])).toEqual([[4, false]]);
    // Tick 6: back home; the site went up to 25 meanwhile, but red remembers it at 15.
    const home = view(6, (x) => (x.buildings.find((b) => b.id === 8)!.construction!.progress = 25));
    const later = fogView(home, 'red', memory);
    const site = later.buildings.find((b) => b.thing.id === 8)!;
    expect(site.remembered).toBe(true);
    expect(site.thing.construction!.progress).toBe(15);
    expect(later.resources.map((r) => [r.thing.id, r.remembered])).toEqual([[4, true]]);
    // The scouted cells stay explored ('1'), the never seen stay '0'.
    expect(later.fog!.cells[1]).toBe('22221110');
    expect(later.fog!.cells[5]).toBe('00000000');
    expect(memory.isExplored(6, 1)).toBe(true);
    // Tick 7: the site is destroyed out of sight: still remembered, until red looks again.
    const gone = view(7, (x) => (x.buildings = x.buildings.filter((b) => b.id !== 8)));
    expect(fogView(gone, 'red', memory).buildings.map((b) => b.thing.id)).toEqual([3, 8]);
    const look = view(8, (x) => {
      x.buildings = x.buildings.filter((b) => b.id !== 8);
      x.units.find((u) => u.id === 5)!.x = 5;
    });
    expect(fogView(look, 'red', memory).buildings.map((b) => b.thing.id)).toEqual([3]);
    expect(memory.lastSeenBuildings()).toEqual([]);
  });

  it('starts afresh for an earlier tick (a replay from the start)', () => {
    const memory = new RtsFogMemory();
    fogView(
      view(5, (x) => (x.units.find((u) => u.id === 5)!.x = 5)),
      'red',
      memory,
    );
    expect(memory.isExplored(6, 1)).toBe(true);
    fogView(view(0), 'red', memory);
    expect(memory.isExplored(6, 1)).toBe(false);
    expect(memory.lastSeenBuildings()).toEqual([]);
  });
});

describe('presentWorld with fog', () => {
  it('fills frame.fog, hides enemy units outside sight and draws last-seen buildings, passing the schema', () => {
    const state = new RtsPresentState();
    const scout = view(5, (x) => (x.units.find((u) => u.id === 5)!.x = 5));
    presentWorld(scout, { faction: 'red', size: SIZE, fog: true, state });
    const frame = presentWorld(view(6), { faction: 'red', size: SIZE, fog: true, state, selection: [8] });
    expect(validate('frame.json', frame, presentFrameSchema).errors).toEqual([]);
    expect(frame.fog).toEqual({
      cols: 8,
      rows: 6,
      cells: ['22221110', '22221110', '22221110', '22220000', '22220000', '00000000'],
    });
    expect(ids(frame)).not.toContain('unit-9');
    expect(ids(frame)).not.toContain('unit-10');
    const site = frame.entities.find((e) => e.id === 'building-8')!;
    expect(site.tags).toContain('last-seen');
    // A remembered building has no bars and no ring.
    expect(ids(frame)).not.toContain('building-8/progress');
    expect(ids(frame)).not.toContain('building-8/ring');
    expect(frame.entities.find((e) => e.id === 'resource-4')!.tags).toContain('last-seen');
    // The HUD counts the enemies seen.
    expect(frame.status['enemyUnits']).toBe(0);
    expect(frame.status['enemyNear']).toBeUndefined();
  });

  it('leaves the frame as before when off (the default)', () => {
    const v = view();
    const off = presentWorld(v, { faction: 'red', size: SIZE, fog: false });
    expect(off).toEqual(presentWorld(v, { faction: 'red', size: SIZE }));
    expect(off.fog).toBeUndefined();
    expect(ids(off)).toContain('unit-9');
    expect(off.status['enemyUnits']).toBe(2);
  });
});
