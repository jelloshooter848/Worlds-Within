import type { z } from 'zod';
import type { FieldPath, IssueParams } from './validate';

/**
 * Text grids: content drawn as rows of characters (room maps, pixel art). Every row has the same
 * width and every character is a key of a legend, which says what the character means:
 *
 *   rows   ['#..#', '#..#', '####']
 *   legend { '#': 'wall', '.': 'floor' }
 *
 * Rows and columns are 0-based (the row is the index in the array, the column the index in the
 * string), so they match the path in a {@link ContentError}: `map.2` is row 2.
 */
export type Legend<T> = Readonly<Record<string, T>>;

export type GridProblemCode = 'empty_grid' | 'ragged_row' | 'unknown_char';

export interface GridProblem {
  code: GridProblemCode;
  /** 0-based row. */
  row: number;
  /** 0-based column: the first column that differs (ragged rows) or the bad character. */
  col: number;
  message: string;
}

export interface TextGrid<T> {
  width: number;
  height: number;
  rows: readonly string[];
  /** `cells[row][col]` is the legend value of that character. */
  cells: readonly (readonly T[])[];
}

export type GridResult<T> =
  { ok: true; grid: TextGrid<T>; problems: [] } | { ok: false; problems: GridProblem[] };

/** Accepts a legend as an object or as the set of characters it allows. */
export type LegendKeys = Legend<unknown> | ReadonlySet<string>;

function hasChar(legend: LegendKeys, ch: string): boolean {
  return legend instanceof Set ? legend.has(ch) : Object.hasOwn(legend, ch);
}

/**
 * Splits a block of text into grid rows: one row per line, `\r` dropped, and blank lines at the
 * start and end removed (a grid is often written between blank lines). Inner blank lines stay, so
 * they are reported as ragged rows rather than silently dropped.
 */
export function gridRows(text: string): string[] {
  const rows = text.split('\n').map((r) => r.replace(/\r$/, ''));
  while (rows.length > 0 && rows[0]!.trim() === '') rows.shift();
  while (rows.length > 0 && rows[rows.length - 1]!.trim() === '') rows.pop();
  return rows;
}

/** Cells in a row: code points, so an emoji or other astral character counts as one cell. */
function cellCount(row: string): number {
  return [...row].length;
}

/** Every problem with `rows` against the legend, in row then column order; empty when the grid is good. */
export function gridProblems(rows: readonly string[], legend: LegendKeys): GridProblem[] {
  if (rows.length === 0 || rows[0] === '') {
    return [{ code: 'empty_grid', row: 0, col: 0, message: 'grid is empty' }];
  }
  const problems: GridProblem[] = [];
  const width = cellCount(rows[0]!);
  rows.forEach((row, r) => {
    const w = cellCount(row);
    if (w !== width) {
      problems.push({
        code: 'ragged_row',
        row: r,
        col: Math.min(w, width),
        message: `row ${r} is ${w} wide, expected ${width} (the width of row 0)`,
      });
    }
    let c = 0;
    for (const ch of row) {
      if (!hasChar(legend, ch)) {
        problems.push({
          code: 'unknown_char',
          row: r,
          col: c,
          message: `row ${r}, col ${c}: ${JSON.stringify(ch)} is not in the legend`,
        });
      }
      c++;
    }
  });
  return problems;
}

/**
 * Parses a grid (a block of text or an array of rows) against a legend. Legend keys must be single
 * characters; anything else is a programming error and throws.
 */
export function parseTextGrid<T>(input: string | readonly string[], legend: Legend<T>): GridResult<T> {
  for (const key of Object.keys(legend)) {
    if ([...key].length !== 1) throw new Error(`legend key ${JSON.stringify(key)} is not one character`);
  }
  const rows = typeof input === 'string' ? gridRows(input) : [...input];
  const problems = gridProblems(rows, legend);
  if (problems.length > 0) return { ok: false, problems };
  const cells = rows.map((row) => [...row].map((ch) => legend[ch] as T));
  return { ok: true, grid: { width: cellCount(rows[0]!), height: rows.length, rows, cells }, problems: [] };
}

/**
 * For schemas: adds one Zod issue per grid problem at `path` + the row index, carrying the content
 * code and the row and column (see `issuesToErrors` in `validate.ts`). Use inside `superRefine`.
 */
export function addGridIssues(
  ctx: z.RefinementCtx,
  rows: readonly string[],
  legend: LegendKeys,
  path: FieldPath,
): void {
  for (const p of gridProblems(rows, legend)) {
    const params: IssueParams = { code: p.code, row: p.row, col: p.col };
    ctx.addIssue({
      code: 'custom',
      message: p.message,
      path: p.code === 'empty_grid' ? [...path] : [...path, p.row],
      params,
    });
  }
}
