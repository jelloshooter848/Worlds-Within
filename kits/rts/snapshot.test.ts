import { describe, expect, it } from 'vitest';
import { battleSnapshot } from './__fixtures__/world';
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
