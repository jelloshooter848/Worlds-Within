import { describe, expect, it } from 'vitest';
import {
  Terrain,
  cellAt,
  cellIndex,
  flatTerrain,
  heightAt,
  moveCost,
  passable,
  terrainOf,
  typeAt,
  type TerrainData,
} from './terrain';
import { createWorld } from './world';

/** 3 x 2: a hill in the middle of the top row, water at the bottom right. */
const HILLS: TerrainData = {
  width: 3,
  height: 2,
  types: [
    { name: 'grass', cost: 1, passable: true },
    { name: 'mud', cost: 3, passable: true },
    { name: 'water', cost: 1, passable: false },
  ],
  elevation: [0, 4, 1, -2, 0, 0],
  cells: [0, 0, 0, 1, 0, 2],
};

describe('terrain', () => {
  it('stores integer elevation per cell and looks it up by (x, y)', () => {
    expect(Terrain.schema.parse(HILLS)).toEqual(HILLS);
    expect(heightAt(HILLS, 1, 0)).toBe(4);
    expect(heightAt(HILLS, 0, 1)).toBe(-2);
    expect(heightAt(HILLS, 2, 0)).toBe(1);
    expect(() => heightAt(HILLS, 3, 0)).toThrow(/off the 3x2 terrain/);
    expect(cellIndex(HILLS, 2, 1)).toBe(5);
    expect(cellAt(HILLS, 5)).toEqual({ x: 2, y: 1 });
  });

  it('gives movement cost by cell type, null when impassable or off the map', () => {
    expect(typeAt(HILLS, 0, 1).name).toBe('mud');
    expect(moveCost(HILLS, 0, 0)).toBe(1);
    expect(moveCost(HILLS, 1, 0)).toBe(1); // height does not change cost in 0.8
    expect(moveCost(HILLS, 0, 1)).toBe(3);
    expect(moveCost(HILLS, 2, 1)).toBeNull();
    expect(moveCost(HILLS, -1, 0)).toBeNull();
    expect(passable(HILLS, 2, 1)).toBe(false);
  });

  it('rejects non-integer elevation and mismatched grids', () => {
    const bad = (patch: Partial<TerrainData>): boolean =>
      Terrain.schema.safeParse({ ...HILLS, ...patch }).success;
    expect(bad({ elevation: [0, 0.5, 0, 0, 0, 0] })).toBe(false);
    expect(bad({ elevation: [0, 0, 0] })).toBe(false);
    expect(bad({ cells: [0, 0, 0, 0, 0, 3] })).toBe(false);
    expect(bad({ types: [HILLS.types[0], HILLS.types[0], HILLS.types[2]] as TerrainData['types'] })).toBe(
      false,
    );
  });

  it('lives in the world as data', () => {
    const world = createWorld(0, { components: [Terrain] });
    expect(() => terrainOf(world)).toThrow(/exactly one Terrain, found 0/);
    world.add(world.spawn(), Terrain, flatTerrain(4, 3));
    expect(heightAt(terrainOf(world), 3, 2)).toBe(0);
    expect(world.snapshot().components['Terrain']?.[0]?.[1]).toMatchObject({ width: 4, height: 3 });
  });
});
