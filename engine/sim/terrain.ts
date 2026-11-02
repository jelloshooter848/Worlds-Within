import { z } from 'zod';
import { defineComponent } from './component';
import { idiv, imod } from './math';
import type { Entity, World } from './world';

/**
 * The world's terrain: a grid of `width` x `height` cells, each with an integer elevation and a
 * cell type (docs/BUILD-LOG.md, Engine 0.8, item 101). Stored as world data: a `Terrain`
 * component on one entity of the world, so it is in every snapshot and save like everything else.
 *
 * Cells are listed row by row (`index = y * width + x`). `types` names the kinds of ground; each
 * cell holds an index into it. A type has a movement `cost` (an integer, at least 1) and a
 * `passable` flag. Elevation is data only in 0.8: it changes neither cost nor anything else. Line of
 * sight and height rules come in 0.9 or later, in integer maths, here in engine/sim.
 *
 *   const t = flatTerrain(4, 3);          // all "ground", cost 1, elevation 0
 *   heightAt(t, 2, 1);                    // 0
 *   moveCost(t, 2, 1);                    // 1 (null for a wall or off the map)
 */
const TerrainType = z.strictObject({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -'),
  cost: z.int().min(1),
  passable: z.boolean(),
});
export type TerrainType = z.infer<typeof TerrainType>;

export const Terrain = defineComponent(
  'Terrain',
  z
    .strictObject({
      width: z.int().min(1),
      height: z.int().min(1),
      types: z.array(TerrainType).min(1),
      /** Elevation per cell, row by row. */
      elevation: z.array(z.int()),
      /** Type index per cell, row by row. */
      cells: z.array(z.int().min(0)),
    })
    .superRefine((t, ctx) => {
      const size = t.width * t.height;
      if (t.elevation.length !== size) {
        ctx.addIssue({
          code: 'custom',
          path: ['elevation'],
          message: `needs ${size} cells, has ${t.elevation.length}`,
        });
      }
      if (t.cells.length !== size) {
        ctx.addIssue({
          code: 'custom',
          path: ['cells'],
          message: `needs ${size} cells, has ${t.cells.length}`,
        });
      }
      const bad = t.cells.findIndex((c) => c >= t.types.length);
      if (bad >= 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['cells', bad],
          message: `type ${t.cells[bad]} is not in types`,
        });
      }
      const names = t.types.map((ty) => ty.name);
      if (new Set(names).size !== names.length) {
        ctx.addIssue({ code: 'custom', path: ['types'], message: 'type names must be unique' });
      }
    }),
);
export type TerrainData = z.infer<typeof Terrain.schema>;

/** The one ground type of `flatTerrain`. */
export const GROUND: TerrainType = Object.freeze({ name: 'ground', cost: 1, passable: true });

/** Terrain data of `width` x `height` cells, all of one type (`GROUND` by default) at elevation 0. */
export function flatTerrain(width: number, height: number, type: TerrainType = GROUND): TerrainData {
  const size = width * height;
  return {
    width,
    height,
    types: [{ ...type }],
    elevation: new Array<number>(size).fill(0),
    cells: new Array<number>(size).fill(0),
  };
}

/** Whether (x, y) is a cell of the grid. */
export function inBounds(t: TerrainData, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < t.width && y < t.height;
}

/** The row-by-row index of cell (x, y). Throws when it is off the grid. */
export function cellIndex(t: TerrainData, x: number, y: number): number {
  if (!inBounds(t, x, y)) throw new Error(`cell (${x}, ${y}) is off the ${t.width}x${t.height} terrain`);
  return y * t.width + x;
}

/** The cell (x, y) of a row-by-row index. */
export function cellAt(t: TerrainData, index: number): { x: number; y: number } {
  return { x: imod(index, t.width), y: idiv(index, t.width) };
}

/** The integer elevation of cell (x, y). Throws when it is off the grid. */
export function heightAt(t: TerrainData, x: number, y: number): number {
  return t.elevation[cellIndex(t, x, y)] as number;
}

/** The type of cell (x, y). Throws when it is off the grid. */
export function typeAt(t: TerrainData, x: number, y: number): TerrainType {
  return t.types[t.cells[cellIndex(t, x, y)] as number] as TerrainType;
}

/**
 * The cost of entering cell (x, y): its type's integer cost, or null when the cell is impassable
 * or off the grid. Height does not change it in 0.8.
 */
export function moveCost(t: TerrainData, x: number, y: number): number | null {
  if (!inBounds(t, x, y)) return null;
  const type = typeAt(t, x, y);
  return type.passable ? type.cost : null;
}

/** Whether cell (x, y) can be entered. */
export function passable(t: TerrainData, x: number, y: number): boolean {
  return moveCost(t, x, y) !== null;
}

/** The entity holding the world's terrain. Throws unless exactly one entity has `Terrain`. */
export function terrainEntity(world: World): Entity {
  const found = world.query(Terrain);
  if (found.length !== 1) throw new Error(`the world needs exactly one Terrain, found ${found.length}`);
  return found[0] as Entity;
}

/** The world's terrain data (the stored object). Throws unless exactly one entity has `Terrain`. */
export function terrainOf(world: World): TerrainData {
  return world.get(terrainEntity(world), Terrain) as TerrainData;
}
