import { moveCost, type TerrainData } from './terrain';

/**
 * Walking on the terrain grid, in integers (see "Walking" in this folder's CLAUDE.md).
 *
 * Movement is 4-way (north, east, south, west). Entering a cell costs its type's `cost` (an
 * impassable cell or one off the grid cannot be entered). `distanceField` gives, for every cell,
 * the cheapest total cost of reaching a goal; `nextStep` picks the neighbour that is cheapest to go
 * on from, ties going to the first in `STEPS` order, so the same terrain and goal always give the
 * same route.
 *
 *   const field = distanceField(t, { x: 5, y: 2 }, false);   // goal: stand on (5, 2)
 *   nextStep(t, field, { x: 0, y: 0 });                       // { x: 1, y: 0 } (or null: no way on)
 */

/** A cell of the grid. */
export interface Cell {
  readonly x: number;
  readonly y: number;
}

/** The four steps, in the order ties are broken: north, east, south, west. */
export const STEPS: readonly Cell[] = Object.freeze([
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
]);

/** A cell's value in a distance field when the goal cannot be reached from it. */
export const UNREACHABLE = -1;

// Distance fields depend only on the terrain data (stored frozen, so replaced on every change) and
// the goal, so they are kept per terrain object. The cache never changes a result, only its speed.
const fields = new WeakMap<TerrainData, Map<string, Int32Array>>();

/**
 * The cheapest cost from every cell to the goal (row by row, `UNREACHABLE` where there is no way).
 * With `near` false the goal is standing on `goal`; with `near` true it is standing on `goal` or a
 * cell next to it (4-way), for reaching something that stands on a cell no one can enter. The goal
 * cells themselves are 0, and only passable cells get a distance.
 */
export function distanceField(t: TerrainData, goal: Cell, near: boolean): Int32Array {
  let byGoal = fields.get(t);
  if (!byGoal) {
    byGoal = new Map();
    fields.set(t, byGoal);
  }
  const key = `${goal.x},${goal.y},${near ? 1 : 0}`;
  const cached = byGoal.get(key);
  if (cached) return cached;

  const dist = new Int32Array(t.width * t.height).fill(UNREACHABLE);
  const heap = new MinHeap();
  const seed = (x: number, y: number): void => {
    if (moveCost(t, x, y) === null) return;
    const i = y * t.width + x;
    if (dist[i] === 0) return;
    dist[i] = 0;
    heap.push(0, i);
  };
  seed(goal.x, goal.y);
  if (near) for (const s of STEPS) seed(goal.x + s.x, goal.y + s.y);

  // Dijkstra from the goal backwards: from cell c next to u, going on via u costs cost(u) + dist[u].
  const done = new Uint8Array(t.width * t.height);
  while (heap.size > 0) {
    const [d, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    const ux = u % t.width;
    const uy = (u - ux) / t.width;
    const enter = moveCost(t, ux, uy) as number;
    for (const s of STEPS) {
      const cx = ux + s.x;
      const cy = uy + s.y;
      if (moveCost(t, cx, cy) === null) continue;
      const c = cy * t.width + cx;
      const nd = d + enter;
      const old = dist[c] as number;
      if (old === UNREACHABLE || nd < old) {
        dist[c] = nd;
        heap.push(nd, c);
      }
    }
  }
  byGoal.set(key, dist);
  return dist;
}

/**
 * The neighbour of `from` to step into on the cheapest way to the field's goal, or null when
 * `from` is already at the goal or no way leads there. Ties go to the first in `STEPS` order.
 */
export function nextStep(t: TerrainData, field: Int32Array, from: Cell): Cell | null {
  const here = moveCost(t, from.x, from.y) === null ? UNREACHABLE : field[from.y * t.width + from.x];
  if (here === 0) return null;
  let best: Cell | null = null;
  let bestCost = 0;
  for (const s of STEPS) {
    const x = from.x + s.x;
    const y = from.y + s.y;
    const enter = moveCost(t, x, y);
    if (enter === null) continue;
    const rest = field[y * t.width + x] as number;
    if (rest === UNREACHABLE) continue;
    const total = enter + rest;
    if (best === null || total < bestCost) {
      best = { x, y };
      bestCost = total;
    }
  }
  return best;
}

/** A binary min-heap of (priority, cell) pairs; equal priorities pop the lower cell first. */
class MinHeap {
  private readonly keys: number[] = [];
  private readonly cells: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, cell: number): void {
    this.keys.push(key);
    this.cells.push(cell);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.keys[0] as number, this.cells[0] as number];
    const lastKey = this.keys.pop() as number;
    const lastCell = this.cells.pop() as number;
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.cells[0] = lastCell;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.less(l, m)) m = l;
        if (r < this.keys.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    const ka = this.keys[a] as number;
    const kb = this.keys[b] as number;
    return ka < kb || (ka === kb && (this.cells[a] as number) < (this.cells[b] as number));
  }

  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b] as number, this.keys[a] as number];
    [this.cells[a], this.cells[b]] = [this.cells[b] as number, this.cells[a] as number];
  }
}
