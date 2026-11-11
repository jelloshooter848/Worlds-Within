import { z } from 'zod';
import type { DeepReadonly, PresentFog } from './types';

/**
 * Fog of war as presentation (Engine 0.16 part D, D3): a frame's optional `fog` grid (one cell
 * per map tile: unexplored, explored or visible) and a skin's `fog` look (the colour and alpha of
 * unexplored and explored cells, an optional soft edge). The fog is drawn over the map and the
 * entities, under the HUD, by the 2D walk (`engine/core/draw`), and on a HUD minimap by the UI kit.
 * It changes nothing in a world or a hash: a kit decides what is seen. Pure.
 */

/** A fog cell's character in `PresentFog.cells`. */
export const FOG_CELLS = { unexplored: '0', explored: '1', visible: '2' } as const;

/** A fog cell's state. */
export type FogState = keyof typeof FOG_CELLS;

/** The characters a fog row may hold. */
export const FOG_CELL_CHARS: readonly string[] = Object.values(FOG_CELLS);

/** The widest soft edge a skin may ask for, in world px. */
export const FOG_EDGE_MAX = 16;

const color = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  message: 'expected a colour like #fff or #ffffff',
});

const fogShadeSchema = z.strictObject({
  color: color.exactOptional().describe('the colour laid over the cell (default `#000000`)'),
  alpha: z.number().min(0).max(1).exactOptional().describe('its opacity, 0 (none) to 1 (the cell hidden)'),
});

/** A skin's `fog`: how unexplored and explored cells look, and the soft edge between states. */
export const fogLookSchema = z.strictObject({
  unexplored: fogShadeSchema
    .exactOptional()
    .describe('cells never seen: `{ color?, alpha? }` (default `#000000` at 1, hidden)'),
  explored: fogShadeSchema
    .exactOptional()
    .describe('cells seen before but not now: `{ color?, alpha? }` (default `#000000` at 0.5)'),
  edge: z
    .number()
    .int()
    .min(0)
    .max(FOG_EDGE_MAX)
    .exactOptional()
    .describe(
      `a soft edge, world px (0 to ${FOG_EDGE_MAX}, default 0): a cell's sides next to a lighter cell are drawn that wide halfway between the two, cut to half a tile`,
    ),
});

export type FogLook = z.output<typeof fogLookSchema>;

/** One shade with every default filled. */
export interface FogShade {
  color: string;
  alpha: number;
}

/** A skin's fog look with every default filled. */
export interface ResolvedFogLook {
  unexplored: FogShade;
  explored: FogShade;
  edge: number;
}

/** The look of a frame's fog when the skin gives no `fog`. */
export const DEFAULT_FOG_LOOK: ResolvedFogLook = {
  unexplored: { color: '#000000', alpha: 1 },
  explored: { color: '#000000', alpha: 0.5 },
  edge: 0,
};

/** A skin's `fog` (or none) with every default filled. */
export function resolveFogLook(look: DeepReadonly<FogLook> | undefined): ResolvedFogLook {
  const d = DEFAULT_FOG_LOOK;
  return {
    unexplored: {
      color: look?.unexplored?.color ?? d.unexplored.color,
      alpha: look?.unexplored?.alpha ?? d.unexplored.alpha,
    },
    explored: {
      color: look?.explored?.color ?? d.explored.color,
      alpha: look?.explored?.alpha ?? d.explored.alpha,
    },
    edge: look?.edge ?? d.edge,
  };
}

/**
 * The state of the cell at (`col`, `row`): a cell outside the grid, or a character that is not a
 * fog cell, is `visible` (nothing drawn over it).
 */
export function fogState(fog: DeepReadonly<PresentFog>, col: number, row: number): FogState {
  const ch = fog.cells[row]?.[col];
  if (ch === FOG_CELLS.unexplored) return 'unexplored';
  if (ch === FOG_CELLS.explored) return 'explored';
  return 'visible';
}

/** A state's shade (null for `visible`). */
export function fogShade(look: ResolvedFogLook, state: FogState): FogShade | null {
  return state === 'visible' ? null : look[state];
}

/** A translucent box laid over the picture, in world px. */
export interface FogBox {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  alpha: number;
}

/**
 * The fog's boxes in world px (tile `c` from `c * tileSize`), row by row. Without a soft edge,
 * each row's run of cells in one state is one box. With `edge` (cut to half a tile), a cell next
 * to a lighter cell (left, right, above or below; outside the grid counts as the same) is nine
 * boxes that never overlap: its middle at its own alpha, each side strip toward a lighter
 * neighbour `edge` px wide at the alpha halfway to the neighbour's, and each corner where two such
 * strips meet at the lower of their two alphas. Boxes with alpha 0 are left out.
 */
export function fogBoxes(fog: DeepReadonly<PresentFog>, look: ResolvedFogLook, tileSize: number): FogBox[] {
  const out: FogBox[] = [];
  const edge = Math.min(look.edge, Math.floor(tileSize / 2));
  const alphaAt = (c: number, r: number, own: number): number => {
    if (r < 0 || r >= fog.rows || c < 0 || c >= fog.cols) return own;
    return fogShade(look, fogState(fog, c, r))?.alpha ?? 0;
  };
  for (let row = 0; row < fog.rows; row++) {
    let run: FogBox | null = null;
    for (let col = 0; col < fog.cols; col++) {
      const shade = fogShade(look, fogState(fog, col, row));
      if (shade === null || shade.alpha <= 0) {
        run = null;
        continue;
      }
      const x = col * tileSize;
      const y = row * tileSize;
      const a = shade.alpha;
      // The alpha of each side's strip: halfway to a lighter neighbour, else none.
      const side = (c: number, r: number): number | null => {
        if (edge === 0) return null;
        const n = alphaAt(c, r, a);
        return n < a ? (a + n) / 2 : null;
      };
      const top = side(col, row - 1);
      const right = side(col + 1, row);
      const bottom = side(col, row + 1);
      const left = side(col - 1, row);
      if (top === null && right === null && bottom === null && left === null) {
        if (run !== null && run.color === shade.color && run.alpha === a && run.x + run.w === x) {
          run.w += tileSize;
        } else {
          run = { x, y, w: tileSize, h: tileSize, color: shade.color, alpha: a };
          out.push(run);
        }
        continue;
      }
      run = null;
      const l = left === null ? 0 : edge;
      const r = right === null ? 0 : edge;
      const t = top === null ? 0 : edge;
      const b = bottom === null ? 0 : edge;
      const box = (bx: number, by: number, bw: number, bh: number, alpha: number) => {
        if (bw > 0 && bh > 0 && alpha > 0)
          out.push({ x: bx, y: by, w: bw, h: bh, color: shade.color, alpha });
      };
      const corner = (p: number | null, q: number | null) => Math.min(p ?? a, q ?? a);
      const midW = tileSize - l - r;
      const midH = tileSize - t - b;
      box(x + l, y + t, midW, midH, a);
      box(x + l, y, midW, t, top ?? a);
      box(x + l, y + tileSize - b, midW, b, bottom ?? a);
      box(x, y + t, l, midH, left ?? a);
      box(x + tileSize - r, y + t, r, midH, right ?? a);
      box(x, y, l, t, corner(left, top));
      box(x + tileSize - r, y, r, t, corner(right, top));
      box(x, y + tileSize - b, l, b, corner(left, bottom));
      box(x + tileSize - r, y + tileSize - b, r, b, corner(right, bottom));
    }
  }
  return out;
}
