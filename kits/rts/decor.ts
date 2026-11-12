import { z } from 'zod';
import type { KindIssue, TextReadResult, TextWriteResult } from '@engine/core/content/kinds';
import { addGridIssues, gridRows } from '@engine/core/content/text-grid';

/**
 * Map decoration as data (Engine 0.16 polish Q, Q5): the `rts-decor` content kind, an optional
 * text grid that dresses an RTS map with scenery, usually `maps/<id>.decor.txt` beside the map's
 * `maps/<id>.world.json` (the same entry name, `<id>`), one character per terrain cell:
 *
 *   ..T..r....
 *   .gg...|||.
 *   ..d..f..b.
 *
 * `.` is nothing; every other character is one of {@link RTS_DECOR} (trees, rocks, bushes,
 * flowers, stumps, grass tufts, ground marks and bank reeds). Presentation only: the grid never
 * enters the world (the map file stays a plain world scenario), so no hash depends on it.
 * `presentWorld`'s `decor` option adds it as the map layer `decor`, drawn over the terrain and
 * under the entities and the fog; a 2D skin's `tiles` map each character to a frame (a frame's
 * `anchor` stands a prop larger than a cell on it), as for a top-down room's decoration.
 */

/**
 * The decoration characters and what each stands for (the kit gives them no rule; a skin draws
 * them). No digit: an RTS map's own tiles are its terrain type indexes, keyed `0`, `1`, ... in a
 * skin's `tiles`, so a decoration character never clashes with one.
 */
export const RTS_DECOR: Readonly<Record<string, string>> = Object.freeze({
  '.': 'nothing',
  T: 'a tree',
  P: 'a pine',
  S: 'a stump',
  b: 'a bush',
  r: 'a rock',
  R: 'a boulder',
  p: 'pebbles',
  f: 'flowers',
  m: 'mushrooms',
  g: 'a grass tuft',
  d: 'a dirt patch',
  D: 'darker grass',
  l: 'lighter grass',
  '|': 'reeds (a river bank)',
});

/** The characters a decoration grid may hold: the keys of {@link RTS_DECOR}. */
export const RTS_DECOR_CHARS: ReadonlySet<string> = new Set(Object.keys(RTS_DECOR));

const charList = Object.entries(RTS_DECOR)
  .map(([ch, what]) => `\`${ch}\` ${what}`)
  .join(', ');

/** The `rts-decor` file shape: the grid's rows (a `.txt` file is read as these). */
export const rtsDecorSchema = z
  .strictObject({
    rows: z
      .array(z.string())
      .min(1)
      .describe(`one string per map row, one character per terrain cell: ${charList}`),
  })
  .superRefine((decor, ctx) => addGridIssues(ctx, decor.rows, RTS_DECOR_CHARS, ['rows']))
  .describe("an RTS map's decoration grid (presentation only)");
export type RtsDecor = z.infer<typeof rtsDecorSchema>;

/** Reads an `rts-decor` `.txt`: every line a row (blank lines at the start and end dropped). */
export function readRtsDecorText(text: string): TextReadResult {
  const lines = text.split('\n');
  let first = 0;
  while (first < lines.length && lines[first]!.trim() === '') first++;
  const rows = gridRows(text);
  const map: Record<string, number> = { '': first + 1 };
  rows.forEach((_, i) => (map[`/rows/${i}`] = first + i + 1));
  return { ok: true, data: { rows }, lines: map };
}

/** Writes an `rts-decor` back as text: one line per row. */
export function writeRtsDecorText(data: unknown): TextWriteResult {
  return { ok: true, text: `${(data as RtsDecor).rows.join('\n')}\n` };
}

/**
 * Problems with a decoration grid against its map's terrain (`rows`, the map's `terrain.rows`):
 * `size_mismatch` when it is not the map's size, at `rows`. A grid with ragged rows is left to
 * the schema's `ragged_row`.
 */
export function decorSizeIssues(name: string, decor: RtsDecor, terrain: readonly string[]): KindIssue[] {
  const width = (rows: readonly string[]) => [...(rows[0] ?? '')].length;
  const cols = width(decor.rows);
  if (cols === width(terrain) && decor.rows.length === terrain.length) return [];
  const message = `the decoration is ${cols}x${decor.rows.length} but the map is ${width(terrain)}x${terrain.length}`;
  return [{ name, path: ['rows'], code: 'size_mismatch', message }];
}

/**
 * The rows of the `decor` map layer for a map `cols` x `rows` cells: each decoration character
 * as it is and every empty cell (`.`, or past a short grid's edge) a space, which no skin lists,
 * so the layer never draws over the terrain where there is nothing. A longer grid is cut to the
 * map.
 */
export function decorLayerRows(decor: readonly string[], cols: number, rows: number): string[] {
  const out: string[] = [];
  for (let row = 0; row < rows; row++) {
    const line = [...(decor[row] ?? '')];
    let text = '';
    for (let col = 0; col < cols; col++) {
      const ch = line[col];
      text += ch === undefined || ch === '.' ? ' ' : ch;
    }
    out.push(text);
  }
  return out;
}
