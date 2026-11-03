import { describe, expect, it } from 'vitest';
import { battleSnapshot, siegeSnapshot } from './__fixtures__/world';
import { sidesOf } from './sides';
import { facingOfDir, isFinished, readWorld, thingAt } from './snapshot';

describe('readWorld', () => {
  it('reads units, buildings, resources, stockpiles, terrain and types from a world snapshot', () => {
    const v = readWorld(battleSnapshot({ tick: 7 }));
    expect(v.tick).toBe(7);
    expect(v.terrain?.width).toBe(8);
    expect(v.units.map((u) => u.id)).toEqual([5, 6, 7, 9, 10]);
    expect(v.units[0]).toMatchObject({
      type: 'worker',
      faction: 'red',
      worker: true,
      gatherer: true,
      carry: 2,
    });
    expect(v.units.find((u) => u.id === 7)?.role).toBe('hero');
    expect(v.units.find((u) => u.id === 9)).toMatchObject({ task: 'move', moveWait: 2, dir: 6 });
    expect(v.units.find((u) => u.id === 6)?.target).toBe(9);
    expect(v.buildings.map((b) => [b.id, b.kind, isFinished(b)])).toEqual([
      [3, 'hall', true],
      [8, 'barracks', false],
    ]);
    expect(v.resources).toEqual([{ id: 4, item: 'gold', x: 4, y: 0, amount: 30 }]);
    expect(v.stock).toEqual({ red: { gold: 120 } });
    expect(v.types?.buildings['barracks']?.size).toEqual({ w: 2, h: 2 });
  });

  it('reads an empty world and refuses what is not a snapshot, naming the field', () => {
    const v = readWorld({ tick: 0, components: {} });
    expect(v).toMatchObject({ terrain: null, units: [], buildings: [], types: null });
    expect(() => readWorld({ tick: 0, components: { Position: [[1, { x: 'a', y: 0 }]] } })).toThrow(
      /components\.Position\.0\.1\.x/,
    );
  });

  it('maps Facing8 directions to the eight facings', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(facingOfDir)).toEqual([
      'up',
      'up-right',
      'right',
      'down-right',
      'down',
      'down-left',
      'left',
      'up-left',
    ]);
    expect(facingOfDir(null)).toBe('down');
  });

  it('finds what stands on a cell: units first, then buildings, then resource nodes', () => {
    const v = readWorld(battleSnapshot());
    expect(thingAt(v, 2, 1)).toMatchObject({ what: 'unit' });
    expect(thingAt(v, 1, 1)).toMatchObject({ what: 'building', building: { id: 3 } });
    expect(thingAt(v, 4, 0)).toMatchObject({ what: 'resource' });
    expect(thingAt(v, 5, 5)).toBeNull();
  });
});

describe('readWorld: missions (Engine 0.11)', () => {
  it('reads offered opportunities, open missions and frozen events', () => {
    const offered = readWorld(siegeSnapshot());
    expect(offered.missions).toEqual({
      offered: [{ opportunity: 'raid-window', mission: 'raid', closes: 20 }],
      open: [],
      committed: [],
      gated: ['raid'],
      frozen: [],
    });
    expect(offered.units.find((u) => u.id === 9)).toMatchObject({ event: 'siege', frozen: false });

    const open = readWorld(siegeSnapshot({ open: true, tick: 10 }));
    expect(open.missions.offered).toEqual([]);
    expect(open.missions.open).toEqual([
      {
        id: 'raid',
        title: 'Burn the siege engines',
        event: 'siege',
        openTick: 3,
        commitTick: 33,
        resolved: false,
      },
    ]);
    expect(open.missions.frozen).toEqual(['siege']);
    expect(open.units.filter((u) => u.frozen).map((u) => u.id)).toEqual([6, 9, 10]);
    expect(open.buildings.filter((b) => b.frozen).map((b) => b.id)).toEqual([8]);
    expect(open.units.find((u) => u.id === 5)).toMatchObject({ event: null, frozen: false });
  });

  it('a snapshot without mission state reads with none and nothing frozen', () => {
    const v = readWorld(battleSnapshot());
    expect(v.missions).toEqual({ offered: [], open: [], committed: [], gated: [], frozen: [] });
    expect(v.units.every((u) => u.event === null && !u.frozen)).toBe(true);
  });
});

describe('readWorld: fates (Engine 0.13)', () => {
  const fate = (state: string) => ({ state, by: null, at: 0, held: null, history: [] });
  /**
   * The battle with fates: the hero Ada (7) injured at 15 of 30, blue soldier 9 captured and
   * blue soldier 10 dead by the data alone (both still have `Unit` and `Position` here), and a
   * captured red sergeant (11) off the map as the sim leaves one (no `Unit`, no `Position`).
   */
  const snapshot = () =>
    battleSnapshot({
      extra: {
        Member: [
          [7, { name: 'Ada', squad: null, role: 'hero' }],
          [9, { name: 'Bo', squad: null, role: 'regular' }],
          [10, { name: 'Cy', squad: null, role: 'regular' }],
          [11, { name: 'Dee', squad: null, role: 'captain' }],
        ],
        Fate: [
          [7, fate('injured')],
          [9, fate('captured')],
          [10, fate('dead')],
          [11, fate('captured')],
        ],
        Owner: [
          [3, { faction: 'red' }],
          [5, { faction: 'red' }],
          [6, { faction: 'red' }],
          [7, { faction: 'red' }],
          [8, { faction: 'blue' }],
          [9, { faction: 'blue' }],
          [10, { faction: 'blue' }],
          [11, { faction: 'red' }],
        ],
        Health: [
          [3, { hp: 400, max: 400 }],
          [5, { hp: 20, max: 20 }],
          [6, { hp: 30, max: 30 }],
          [7, { hp: 15, max: 30 }],
          [8, { hp: 1, max: 200 }],
          [9, { hp: 30, max: 30 }],
          [10, { hp: 0, max: 30 }],
          [11, { hp: 22, max: 40 }],
        ],
      },
    });

  it('never shows someone captured or dead; the injured stay at their hp now', () => {
    const v = readWorld(snapshot());
    expect(v.units.map((u) => u.id)).toEqual([5, 6, 7]);
    expect(v.units.find((u) => u.id === 7)).toMatchObject({ hp: 15, maxHp: 30, role: 'hero' });
    expect(thingAt(v, 6, 4)).toBeNull(); // where the captured soldier still "stands"
    expect(sidesOf(v).blue?.units).toBe(0);
  });

  it('lists every named person with their fate for a HUD, on the map or not', () => {
    expect(readWorld(snapshot()).named).toEqual([
      { id: 7, name: 'Ada', role: 'hero', faction: 'red', fate: 'injured', hp: 15, maxHp: 30, x: 2, y: 3 },
      {
        id: 9,
        name: 'Bo',
        role: 'regular',
        faction: 'blue',
        fate: 'captured',
        hp: 30,
        maxHp: 30,
        x: null,
        y: null,
      },
      {
        id: 10,
        name: 'Cy',
        role: 'regular',
        faction: 'blue',
        fate: 'dead',
        hp: 0,
        maxHp: 30,
        x: null,
        y: null,
      },
      {
        id: 11,
        name: 'Dee',
        role: 'captain',
        faction: 'red',
        fate: 'captured',
        hp: 22,
        maxHp: 40,
        x: null,
        y: null,
      },
    ]);
    // A world where no fate moved reads everyone as active.
    expect(readWorld(battleSnapshot()).named).toEqual([
      { id: 7, name: 'Ada', role: 'hero', faction: 'red', fate: 'active', hp: 15, maxHp: 30, x: 2, y: 3 },
    ]);
  });
});
