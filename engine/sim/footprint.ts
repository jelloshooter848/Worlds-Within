import { z } from 'zod';
import { defineComponent } from './component';
import { Position } from './components';
import type { Cell } from './path';
import type { Entity, World } from './world';

/**
 * Buildings on the grid (Engine 0.9 T8): the `Building` component and footprint helpers shared by
 * the unit systems (`rts.ts`, walking up to a building) and the economy (`economy.ts`, placing,
 * building, training and dropping off). See "RTS economy" in this folder's CLAUDE.md.
 */

const Id = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -');

/**
 * A building: its type (`kind`, an id in the world's `RtsTypes`), its footprint `w` x `h` cells
 * from its `Position` (the north-west cell), and whether gatherers drop resources here once it is
 * finished (`dropoff`). Copied from the building type when the building is placed. Buildings do not
 * block movement in 0.9 (units stack, as they do on each other); the footprint is for placement
 * and for reaching the building.
 */
export const Building = defineComponent(
  'Building',
  z.strictObject({
    kind: Id,
    w: z.int().min(1).max(16),
    h: z.int().min(1).max(16),
    dropoff: z.boolean(),
  }),
);
export type BuildingData = z.infer<typeof Building.schema>;

/** A rectangle of cells: `x`, `y` is its north-west cell. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The cells an entity covers: its `Building` footprint, or its one cell; null without `Position`. */
export function footprintOf(world: World, id: Entity): Rect | null {
  const pos = world.get(id, Position);
  if (!pos) return null;
  const b = world.get(id, Building);
  return { x: pos.x, y: pos.y, w: b?.w ?? 1, h: b?.h ?? 1 };
}

/** Whether `cell` is inside `rect`. */
export function inRect(cell: Cell, rect: Rect): boolean {
  return cell.x >= rect.x && cell.y >= rect.y && cell.x < rect.x + rect.w && cell.y < rect.y + rect.h;
}

/** Whether `a` and `b` share a cell. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Whether a unit on `cell` can reach `rect` to work on it, gather from it or drop off at it: it
 * stands on it or on one of the cells around it, diagonals included (Chebyshev distance at most 1).
 */
export function inReach(cell: Cell, rect: Rect): boolean {
  const dx =
    cell.x < rect.x ? rect.x - cell.x : cell.x >= rect.x + rect.w ? cell.x - (rect.x + rect.w - 1) : 0;
  const dy =
    cell.y < rect.y ? rect.y - cell.y : cell.y >= rect.y + rect.h ? cell.y - (rect.y + rect.h - 1) : 0;
  return dx <= 1 && dy <= 1;
}

/**
 * The cells around `rect`, in a fixed order: the row south of it (west to east, corners
 * included), then the column east of it (south to north), the row north of it (east to west), and
 * the column west of it (north to south). Where a trained unit appears: the first free one.
 */
export function ringAround(rect: Rect): Cell[] {
  const cells: Cell[] = [];
  const left = rect.x - 1;
  const right = rect.x + rect.w;
  const top = rect.y - 1;
  const bottom = rect.y + rect.h;
  for (let x = left; x <= right; x++) cells.push({ x, y: bottom });
  for (let y = bottom - 1; y >= top; y--) cells.push({ x: right, y });
  for (let x = right - 1; x >= left; x--) cells.push({ x, y: top });
  for (let y = top + 1; y < bottom; y++) cells.push({ x: left, y });
  return cells;
}
