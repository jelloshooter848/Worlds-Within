import { MinHeap, STEPS, UNREACHABLE, distanceField, type Cell } from './path';
import { moveCost, type TerrainData } from './terrain';

/**
 * Pathfinding for the RTS, in integers (see "Walking" in this folder's CLAUDE.md; docs/BUILD-LOG.md,
 * Engine 0.9, items 126-127).
 *
 * - `findPath(t, from, goal, options)`: A* for one unit. The cells to enter, the total cost and the
 *   number of cells expanded, or null when there is no way (or none found within `maxExpanded`).
 * - `flowField(t, goal, options)` and `flowStep(t, field, from)`: one shared field for a group that
 *   has the same goal; every unit reads its next step from it instead of running A*.
 *
 * Both take a neighbourhood: 4 (the default, the same moves and costs as `distanceField`) or 8
 * (diagonals too, never cutting a corner). In 8-way a straight step costs the entered cell's cost
 * times `STRAIGHT_COST` (10) and a diagonal step times `DIAGONAL_COST` (14), so all costs stay
 * integers; a diagonal step is allowed only when both straight cells beside it are passable.
 *
 *   const path = findPath(t, { x: 0, y: 0 }, { x: 5, y: 3 }, { neighbourhood: 8 });
 *   path?.cells;                                   // [{ x: 1, y: 1 }, ..., { x: 5, y: 3 }]
 *   const field = flowField(t, { x: 5, y: 3 }, { neighbourhood: 8 });
 *   flowStep(t, field, { x: 0, y: 0 });            // { x: 1, y: 1 } (or null: at the goal or no way)
 */

/** 4-way (north, east, south, west) or 8-way (with the diagonals). */
export type Neighbourhood = 4 | 8;

/** The eight steps, in the order ties are broken: N, NE, E, SE, S, SW, W, NW. */
export const STEPS_8: readonly Cell[] = Object.freeze([
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
]);

/** In 8-way, a straight step costs the entered cell's cost times this. */
export const STRAIGHT_COST = 10;
/** In 8-way, a diagonal step costs the entered cell's cost times this (about 10 times the square root of 2). */
export const DIAGONAL_COST = 14;

/** The default cap on the cells one A* search expands before it gives up (returns null). */
export const ASTAR_MAX_EXPANDED = 65536;

/**
 * From this many units sharing a goal, a group reads one `flowField` instead of running `findPath`
 * per unit (measured in astar.test.ts and recorded in CLAUDE.md, "Walking"): on a 256x256 map one
 * 8-way field costs about as much as 4 to 5 A* searches across the map, and it is cached per
 * terrain and goal. Fewer units, or a near goal, use A*.
 */
export const FLOW_GROUP_SIZE = 4;

export interface PathOptions {
  /** 4 (default) or 8. */
  readonly neighbourhood?: Neighbourhood;
  /** Give up (null) after expanding this many cells. Default `ASTAR_MAX_EXPANDED`. */
  readonly maxExpanded?: number;
}

/** An A* result: the cells to enter in order (not the start), their total cost, and the work done. */
export interface Path {
  readonly cells: readonly Cell[];
  readonly cost: number;
  /** How many cells the search expanded (closed). */
  readonly expanded: number;
}

/** The steps of a neighbourhood, in tie order. */
export function stepsOf(neighbourhood: Neighbourhood): readonly Cell[] {
  return neighbourhood === 8 ? STEPS_8 : STEPS;
}

/**
 * The cost of stepping from (x, y) by `step`, or null when that move is not allowed: the cell
 * entered is impassable or off the grid, or the step is diagonal and cuts a corner (one of the two
 * straight cells beside it is impassable). 4-way costs are the cell's cost (as in
 * `distanceField`); 8-way costs are scaled by `STRAIGHT_COST` or `DIAGONAL_COST`.
 */
export function stepCost(
  t: TerrainData,
  x: number,
  y: number,
  step: Cell,
  neighbourhood: Neighbourhood,
): number | null {
  const enter = moveCost(t, x + step.x, y + step.y);
  if (enter === null) return null;
  if (neighbourhood === 4) return enter;
  if (step.x !== 0 && step.y !== 0) {
    if (moveCost(t, x + step.x, y) === null || moveCost(t, x, y + step.y) === null) return null;
    return enter * DIAGONAL_COST;
  }
  return enter * STRAIGHT_COST;
}

// Results depend only on the terrain data (stored frozen, replaced on every change) and the
// arguments, so they are kept per terrain object, like distance fields. A terrain's path cache is
// emptied when it reaches PATH_CACHE_LIMIT entries; the cache never changes a result.
const PATH_CACHE_LIMIT = 4096;
const paths = new WeakMap<TerrainData, Map<string, Path | null>>();
const flows = new WeakMap<TerrainData, Map<string, FlowField>>();

/**
 * The cheapest way from `from` to `goal` by A*, or null when `from` or `goal` is impassable or off
 * the grid, when no way exists, or when none was found within `maxExpanded` expanded cells.
 * `from === goal` gives an empty path of cost 0.
 *
 * Ties are fixed, so the same terrain and arguments always give the same path: the open cell with
 * the lowest estimate (cost so far plus heuristic) is expanded first, then the one with the lowest
 * heuristic (nearer the goal), then the lowest cell index (row by row). A cell's way in is only
 * replaced by a strictly cheaper one, so among equal ways the first neighbour found in step order
 * (`STEPS` or `STEPS_8`) keeps it. The heuristic is the Manhattan (4-way) or octile (8-way)
 * distance times the cheapest passable cell cost, so it never overestimates and the path is
 * always a cheapest one.
 */
export function findPath(t: TerrainData, from: Cell, goal: Cell, options: PathOptions = {}): Path | null {
  const neighbourhood = options.neighbourhood ?? 4;
  const cap = options.maxExpanded ?? ASTAR_MAX_EXPANDED;
  let byKey = paths.get(t);
  if (!byKey) {
    byKey = new Map();
    paths.set(t, byKey);
  }
  const key = `${from.x},${from.y},${goal.x},${goal.y},${neighbourhood},${cap}`;
  const cached = byKey.get(key);
  if (cached !== undefined) return cached;
  const result = search(t, from, goal, neighbourhood, cap);
  if (byKey.size >= PATH_CACHE_LIMIT) byKey.clear();
  byKey.set(key, result);
  return result;
}

function search(
  t: TerrainData,
  from: Cell,
  goal: Cell,
  neighbourhood: Neighbourhood,
  cap: number,
): Path | null {
  if (moveCost(t, from.x, from.y) === null || moveCost(t, goal.x, goal.y) === null) return null;
  if (from.x === goal.x && from.y === goal.y)
    return Object.freeze({ cells: Object.freeze([]), cost: 0, expanded: 0 });

  const w = t.width;
  const size = w * t.height;
  const steps = stepsOf(neighbourhood);
  const minCost = cheapestCost(t);
  const heuristic = (x: number, y: number): number => {
    const dx = x > goal.x ? x - goal.x : goal.x - x;
    const dy = y > goal.y ? y - goal.y : goal.y - y;
    if (neighbourhood === 4) return minCost * (dx + dy);
    const long = dx > dy ? dx : dy;
    const short = dx > dy ? dy : dx;
    return minCost * (STRAIGHT_COST * (long - short) + DIAGONAL_COST * short);
  };

  const g = new Int32Array(size).fill(UNREACHABLE);
  const parent = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const start = from.y * w + from.x;
  const end = goal.y * w + goal.x;
  const heap = new MinHeap();
  g[start] = 0;
  const h0 = heuristic(from.x, from.y);
  heap.push(h0, start, h0);

  let expanded = 0;
  while (heap.size > 0) {
    const [, u] = heap.pop();
    if (closed[u]) continue;
    if (expanded >= cap) return null;
    closed[u] = 1;
    expanded++;
    if (u === end) break;
    const ux = u % w;
    const uy = (u - ux) / w;
    const gu = g[u] as number;
    for (const s of steps) {
      const cost = stepCost(t, ux, uy, s, neighbourhood);
      if (cost === null) continue;
      const cx = ux + s.x;
      const cy = uy + s.y;
      const c = cy * w + cx;
      if (closed[c]) continue;
      const ng = gu + cost;
      const old = g[c] as number;
      if (old === UNREACHABLE || ng < old) {
        g[c] = ng;
        parent[c] = u;
        const h = heuristic(cx, cy);
        heap.push(ng + h, c, h);
      }
    }
  }
  if (!closed[end]) return null;

  const cells: Cell[] = [];
  for (let c = end; c !== start; c = parent[c] as number) {
    const x = c % w;
    cells.push(Object.freeze({ x, y: (c - x) / w }));
  }
  cells.reverse();
  return Object.freeze({ cells: Object.freeze(cells), cost: g[end] as number, expanded });
}

/** The lowest cost of any passable cell type (1 when no type is passable). */
function cheapestCost(t: TerrainData): number {
  let min = 0;
  for (const type of t.types) if (type.passable && (min === 0 || type.cost < min)) min = type.cost;
  return min === 0 ? 1 : min;
}

/** A group's shared field: the cheapest cost from every cell to the goal (`UNREACHABLE` = no way). */
export interface FlowField {
  readonly neighbourhood: Neighbourhood;
  readonly goal: Cell;
  readonly near: boolean;
  /** Row by row; 4-way it is exactly `distanceField(t, goal, near)`. */
  readonly dist: Int32Array;
}

export interface FlowOptions {
  /** 4 (default) or 8. */
  readonly neighbourhood?: Neighbourhood;
  /** The goal is the cell or any passable cell next to it (in the neighbourhood). Default false. */
  readonly near?: boolean;
}

/**
 * The flow field to `goal` for a group: every unit steps by `flowStep` on the same field. 4-way it
 * reuses `distanceField` (same values, same cache); 8-way it is a Dijkstra from the goal with the
 * 8-way step costs, cached per terrain object and goal the same way.
 */
export function flowField(t: TerrainData, goal: Cell, options: FlowOptions = {}): FlowField {
  const neighbourhood = options.neighbourhood ?? 4;
  const near = options.near ?? false;
  let byKey = flows.get(t);
  if (!byKey) {
    byKey = new Map();
    flows.set(t, byKey);
  }
  const key = `${goal.x},${goal.y},${near ? 1 : 0},${neighbourhood}`;
  const cached = byKey.get(key);
  if (cached) return cached;
  const dist = neighbourhood === 4 ? distanceField(t, goal, near) : field8(t, goal, near);
  const field: FlowField = Object.freeze({
    neighbourhood,
    goal: Object.freeze({ x: goal.x, y: goal.y }),
    near,
    dist,
  });
  byKey.set(key, field);
  return field;
}

/** The 8-way distance field: Dijkstra backwards from the goal (cells), with `stepCost`. */
function field8(t: TerrainData, goal: Cell, near: boolean): Int32Array {
  const w = t.width;
  const dist = new Int32Array(w * t.height).fill(UNREACHABLE);
  const heap = new MinHeap();
  const seed = (x: number, y: number): void => {
    if (moveCost(t, x, y) === null) return;
    const i = y * w + x;
    if (dist[i] === 0) return;
    dist[i] = 0;
    heap.push(0, i);
  };
  seed(goal.x, goal.y);
  if (near) for (const s of STEPS_8) seed(goal.x + s.x, goal.y + s.y);

  const done = new Uint8Array(w * t.height);
  while (heap.size > 0) {
    const [d, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    const ux = u % w;
    const uy = (u - ux) / w;
    for (const s of STEPS_8) {
      const cx = ux + s.x;
      const cy = uy + s.y;
      if (moveCost(t, cx, cy) === null) continue;
      // The move is from c back to u, so the step is -s (the corner cells are the same either way).
      const cost = stepCost(t, cx, cy, { x: -s.x, y: -s.y }, 8);
      if (cost === null) continue;
      const c = cy * w + cx;
      const nd = d + cost;
      const old = dist[c] as number;
      if (old === UNREACHABLE || nd < old) {
        dist[c] = nd;
        heap.push(nd, c);
      }
    }
  }
  return dist;
}

/**
 * The cell to step into from `from` on the cheapest way to the field's goal, or null when `from`
 * is at the goal or no way leads there. Ties go to the first in step order (`STEPS` or `STEPS_8`);
 * 4-way it is the same step as `nextStep`.
 */
export function flowStep(t: TerrainData, field: FlowField, from: Cell): Cell | null {
  const here = moveCost(t, from.x, from.y) === null ? UNREACHABLE : field.dist[from.y * t.width + from.x];
  if (here === 0) return null;
  let best: Cell | null = null;
  let bestCost = 0;
  for (const s of stepsOf(field.neighbourhood)) {
    const cost = stepCost(t, from.x, from.y, s, field.neighbourhood);
    if (cost === null) continue;
    const x = from.x + s.x;
    const y = from.y + s.y;
    const rest = field.dist[y * t.width + x] as number;
    if (rest === UNREACHABLE) continue;
    const total = cost + rest;
    if (best === null || total < bestCost) {
      best = { x, y };
      bestCost = total;
    }
  }
  return best;
}
