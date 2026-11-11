import { z } from 'zod';
import type { DeepReadonly } from './types';

/**
 * Neighbour-based tile frames (Engine 0.16 part B, T6): a skin's 2D tile entry may pick its frame
 * by which of its neighbours it joins, so ground drawn from one map character gets grass on top,
 * edges on its sides and corners where both meet, without a character per piece.
 *
 *   "#": {
 *     "frame": "dirt",
 *     "join": {
 *       "with": ["#", "?"],
 *       "frames": { "top": "grass-top", "top left": "grass-top-left", "left": "dirt-left",
 *                   "inner-top-left": "dirt-notch-top-left" }
 *     }
 *   }
 *
 * A side is **open** when the cell beside it is not one of `with` (default: the tile's own key);
 * a cell outside the map counts as joined (`edge: "join"`, the default) or open (`edge: "open"`).
 * An **inner corner** is open when both its sides are joined and the diagonal cell is not (the
 * inside of an L). A `frames` key lists the open sides, then the open inner corners, separated by
 * spaces in the order of {@link TILE_JOIN_WORDS}: `top`, `top left`, `top right bottom left`,
 * `inner-top-left`, `left inner-top-right`. The frame is the key for every open side and corner,
 * else the key for the open sides alone, else the entry's `frame` (also when nothing is open).
 * Pure: schema and lookups only; the Canvas2D presenter draws with it.
 */

/** The four sides, in key order. */
export const TILE_SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type TileSide = (typeof TILE_SIDES)[number];

/** The four inner corners, in key order, with the two sides each sits between. */
export const TILE_INNER_CORNERS = {
  'inner-top-left': ['top', 'left'],
  'inner-top-right': ['top', 'right'],
  'inner-bottom-right': ['bottom', 'right'],
  'inner-bottom-left': ['bottom', 'left'],
} as const satisfies Record<string, readonly [TileSide, TileSide]>;
export type TileInnerCorner = keyof typeof TILE_INNER_CORNERS;

/** Every word a `join.frames` key may use, in the order a key lists them. */
export const TILE_JOIN_WORDS = [...TILE_SIDES, ...(Object.keys(TILE_INNER_CORNERS) as TileInnerCorner[])];

/** How a cell outside the map counts: joined (the default) or open. */
export const TILE_JOIN_EDGES = ['join', 'open'] as const;

const STEP: Record<TileSide, { dc: number; dr: number }> = {
  top: { dc: 0, dr: -1 },
  right: { dc: 1, dr: 0 },
  bottom: { dc: 0, dr: 1 },
  left: { dc: -1, dr: 0 },
};

/**
 * Why a `join.frames` key is not one, or null when it is: words of {@link TILE_JOIN_WORDS}, each
 * once, in that order, and no inner corner beside an open side (it could never show).
 */
export function tileJoinKeyProblem(key: string): string | null {
  const words = key.split(' ');
  const order = TILE_JOIN_WORDS.join(' ');
  const at: number[] = [];
  for (const w of words) {
    const i = (TILE_JOIN_WORDS as readonly string[]).indexOf(w);
    if (i < 0) return `"${w}" is not a side or inner corner (${order})`;
    at.push(i);
  }
  for (let i = 1; i < at.length; i++) {
    if (at[i]! <= at[i - 1]!) {
      const fixed = [...new Set(words)].sort(
        (a, b) => TILE_JOIN_WORDS.indexOf(a as TileSide) - TILE_JOIN_WORDS.indexOf(b as TileSide),
      );
      return `list each side or corner once, in the order ${order}: "${fixed.join(' ')}"`;
    }
  }
  for (const w of words) {
    if (!Object.hasOwn(TILE_INNER_CORNERS, w)) continue;
    const sides = TILE_INNER_CORNERS[w as TileInnerCorner];
    const clash = sides.find((s) => words.includes(s));
    if (clash !== undefined) return `"${w}" can never be open beside an open "${clash}" side`;
  }
  return null;
}

export const tileJoinSchema = z
  .strictObject({
    with: z
      .array(z.string().min(1))
      .min(1)
      .exactOptional()
      .describe('the tile keys this tile joins (default: its own key only); any other cell is open'),
    edge: z
      .enum(TILE_JOIN_EDGES)
      .exactOptional()
      .describe('how a cell outside the map counts: `join` (the default) or `open`'),
    frames: z
      .record(z.string(), z.string().min(1))
      .describe(
        `open sides, then open inner corners, in the order ${TILE_JOIN_WORDS.join(' ')} -> the frame shown (\`"top left": "grass-corner"\`)`,
      ),
  })
  .superRefine((join, ctx) => {
    for (const key of Object.keys(join.frames)) {
      const problem = tileJoinKeyProblem(key);
      if (problem === null) continue;
      ctx.addIssue({
        code: 'custom',
        path: ['frames', key],
        message: problem,
        params: { code: 'bad_join_key' },
      });
    }
  })
  .describe(
    '2D: pick the frame by the neighbours this tile joins: `{ with?, edge?, frames: { "top left": frame, ... } }`',
  );

export type TileJoin = z.output<typeof tileJoinSchema>;

/**
 * Floor variety (Engine 0.16 part C T3): a 2D tile entry's `vary` `{ frames, weights?, period? }`
 * swaps the entry's own `frame` (the one shown when no `join` key matched) for one of `frames`,
 * picked by a hash of the cell's place: the same cell always shows the same frame, neighbours
 * differ. `weights` (one whole number per frame, default 1 each) make some frames rarer; `period`
 * `{ cols, rows }` takes the cell's place modulo it first, so a pattern repeats every room (the
 * top-down kit's room slide puts two rooms side by side in one map, and each keeps its look).
 */
/** A 2D tile's `vary` without its weights check (the skin's `vary` unions it with the 3D one). */
export const tileVaryShape = z.strictObject({
  frames: z.array(z.string().min(1)).min(1).describe('the frames to pick from'),
  weights: z
    .array(z.number().int().min(1))
    .exactOptional()
    .describe('one whole number per frame: how often it is picked (default 1 each)'),
  period: z
    .strictObject({
      cols: z.number().int().min(1).describe('columns before the pattern repeats'),
      rows: z.number().int().min(1).describe('rows before the pattern repeats'),
    })
    .exactOptional()
    .describe("the cell's place is taken modulo this first, so the pattern repeats (default: never)"),
});

/** `bad_weights` at `weights` when a 2D `vary` does not give one weight per frame. */
export function checkVaryWeights(
  vary: { readonly frames: readonly string[]; readonly weights?: readonly number[] | undefined },
  ctx: z.RefinementCtx,
): void {
  if (vary.weights !== undefined && vary.weights.length !== vary.frames.length)
    ctx.addIssue({
      code: 'custom',
      path: ['weights'],
      message: `${vary.weights.length} weights for ${vary.frames.length} frames: give one per frame`,
      params: { code: 'bad_weights' },
    });
}

export const tileVarySchema = tileVaryShape
  .superRefine(checkVaryWeights)
  .describe(
    "2D: vary the tile's own frame by the cell's place: `{ frames, weights?, period?: { cols, rows } }`",
  );

export type TileVary = z.output<typeof tileVarySchema>;

/** A small integer hash of a cell's place (the same on every machine). */
function cellHash(col: number, row: number): number {
  let h = Math.imul(col + 0x9e37, 0x85ebca6b) ^ Math.imul(row + 0x7f4a, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** The frame `vary` picks for the cell at (col, row). Pure. */
export function variedTileFrame(vary: DeepReadonly<TileVary>, col: number, row: number): string {
  const c = vary.period ? ((col % vary.period.cols) + vary.period.cols) % vary.period.cols : col;
  const r = vary.period ? ((row % vary.period.rows) + vary.period.rows) % vary.period.rows : row;
  const weights = vary.weights ?? vary.frames.map(() => 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let n = cellHash(c, r) % total;
  for (let i = 0; i < vary.frames.length; i++) {
    n -= weights[i]!;
    if (n < 0) return vary.frames[i]!;
  }
  return vary.frames[0]!;
}

/** The map's cells as a backend has them: text rows or rows of tile ids. */
export type TileGrid = readonly (string | readonly (string | number)[])[];

/** The key of the cell at (col, row), or undefined outside the grid. */
function cellKey(grid: TileGrid, col: number, row: number): string | undefined {
  if (row < 0 || row >= grid.length || col < 0) return undefined;
  const line = grid[row]!;
  if (col >= line.length) return undefined;
  return String(line[col]);
}

/**
 * The `join.frames` keys a cell would look up, most specific first: its open sides and open inner
 * corners, then its open sides alone (when a corner was open). Empty when nothing is open. Pure.
 */
export function tileJoinKeys(
  join: DeepReadonly<Pick<TileJoin, 'with' | 'edge'>>,
  own: string,
  grid: TileGrid,
  col: number,
  row: number,
): string[] {
  const joins = join.with ?? [own];
  const outside = (join.edge ?? 'join') === 'join';
  const joined = (dc: number, dr: number) => {
    const key = cellKey(grid, col + dc, row + dr);
    return key === undefined ? outside : joins.includes(key);
  };
  const open = new Set<TileSide>(TILE_SIDES.filter((s) => !joined(STEP[s].dc, STEP[s].dr)));
  const sides = TILE_SIDES.filter((s) => open.has(s));
  const corners = (Object.keys(TILE_INNER_CORNERS) as TileInnerCorner[]).filter((c) => {
    const [a, b] = TILE_INNER_CORNERS[c];
    if (open.has(a) || open.has(b)) return false;
    return !joined(STEP[a].dc + STEP[b].dc, STEP[a].dr + STEP[b].dr);
  });
  const keys: string[] = [];
  if (sides.length + corners.length > 0) keys.push([...sides, ...corners].join(' '));
  if (corners.length > 0 && sides.length > 0) keys.push(sides.join(' '));
  return keys;
}

/**
 * The frame a tile entry shows at (col, row) of `grid` ({@link tileJoinKeys}): the first of its
 * keys `join.frames` has, else the entry's `frame` (undefined when it gives none), or the one its
 * `vary` picks for the cell ({@link variedTileFrame}). Pure.
 */
export function resolveTileFrame(
  entry: {
    readonly frame?: string | undefined;
    readonly join?: DeepReadonly<TileJoin> | undefined;
    /** A 3D model tile's `vary` (`{ turn?, height?, tint? }`, no `frames`) picks no frame. */
    readonly vary?: DeepReadonly<TileVary> | object | undefined;
  },
  own: string,
  grid: TileGrid,
  col: number,
  row: number,
): string | undefined {
  const join = entry.join;
  if (join !== undefined) {
    for (const key of tileJoinKeys(join, own, grid, col, row)) {
      if (Object.hasOwn(join.frames, key)) return join.frames[key];
    }
  }
  const vary = entry.vary;
  return vary === undefined || !('frames' in vary)
    ? entry.frame
    : variedTileFrame(vary as DeepReadonly<TileVary>, col, row);
}
