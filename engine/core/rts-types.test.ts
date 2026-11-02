import { describe, expect, it } from 'vitest';
import { rtsTypesSchema } from './rts-types';

const UNIT = { health: 10, speed: 2, attack: 1, range: 1, cooldown: 3, sight: 4, trainTicks: 5 };

describe('rts types', () => {
  it('fills defaults: free, no work, no gathering, nothing trained, no drop-off', () => {
    const table = rtsTypesSchema.parse({
      units: { scout: UNIT },
      buildings: { hut: { health: 50, size: { w: 1, h: 1 }, work: 10 } },
    });
    expect(table.units.scout).toEqual({ ...UNIT, cost: {}, work: null, gather: null });
    expect(table.buildings.hut).toEqual({
      health: 50,
      size: { w: 1, h: 1 },
      work: 10,
      cost: {},
      trains: [],
      dropoff: false,
    });
  });

  it('refuses a building that trains an unknown unit, and bad numbers, naming the field', () => {
    const result = rtsTypesSchema.safeParse({
      units: { scout: { ...UNIT, speed: 0, cost: { gold: 0 } } },
      buildings: { barracks: { health: 50, size: { w: 2, h: 0 }, work: 10, trains: ['scout', 'knight'] } },
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path.join('.')) ?? [];
    expect(paths).toContain('units.scout.speed');
    expect(paths).toContain('units.scout.cost.gold');
    expect(paths).toContain('buildings.barracks.size.h');
    const unknown = rtsTypesSchema.safeParse({
      units: { scout: UNIT },
      buildings: { barracks: { health: 50, size: { w: 2, h: 2 }, work: 10, trains: ['scout', 'knight'] } },
    });
    expect(unknown.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['buildings.barracks.trains.1', 'unit type "knight" is not in units'],
    ]);
  });
});
