import { describe, expect, it } from 'vitest';
import { battleSnapshot } from './__fixtures__/world';
import { sidesOf } from './sides';
import { readWorld } from './snapshot';

describe('sidesOf', () => {
  it('counts each side: units by type, finished buildings by kind, sites and stock', () => {
    const sides = sidesOf(readWorld(battleSnapshot()), ['red', 'blue', 'green']);
    expect(Object.keys(sides)).toEqual(['red', 'blue', 'green']);
    expect(sides['red']!.units).toBe(3);
    expect(sides['red']!.buildings).toEqual({ hall: 1 });
    expect(sides['red']!.sites).toBe(0);
    expect(sides['blue']!.unitTypes).toEqual({ soldier: 2 });
    expect(sides['blue']!.sites).toBe(1);
    expect(sides['green']).toEqual({ units: 0, unitTypes: {}, buildings: {}, sites: 0, stock: {} });
  });
});
