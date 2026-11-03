/**
 * The `td-map` text format and its path: what each character of a map's `.map.txt` grid means,
 * and the one walk enemies take from the entry to the exit.
 *
 * One character is one cell; row 0 is the top, column 0 the left edge. The kit's `LEGEND` gives the
 * five cell kinds a character can mean; a map's header can add characters of its own (`legend`,
 * such as `W` for a wall a game builds on), each meaning one of the same kinds. The legend is the
 * format, not a map: real maps live in games.
 *
 * The path is every `path`, `entry` and `exit` cell. A map has exactly one entry and one exit, and
 * the path is one walk from the entry to the exit with no branches and no cells off it (no
 * branching paths in Engine 0.12: docs/BUILD-LOG.md, Engine 0.12, decision 2). Neighbours are the
 * four cells sharing an edge.
 */

/** What a cell is: off-limits ground, part of the path, a cell towers go on, or a path end. */
export type CellKind = 'blocked' | 'path' | 'build' | 'entry' | 'exit';

export const CELL_KINDS: readonly CellKind[] = ['blocked', 'path', 'build', 'entry', 'exit'];

export interface LegendEntry {
  readonly cell: CellKind;
  /** One line for docs and agents. */
  readonly meaning: string;
}

export const LEGEND: Readonly<Record<string, LegendEntry>> = {
  '.': { cell: 'blocked', meaning: 'ground nothing walks on or is built on' },
  '#': { cell: 'path', meaning: 'a path cell enemies walk' },
  B: { cell: 'build', meaning: 'a build cell: one tower can stand on it' },
  S: { cell: 'entry', meaning: 'the path entry, where enemies come in (exactly one)' },
  X: { cell: 'exit', meaning: 'the path exit: an enemy reaching it costs a life (exactly one)' },
};

/** One cell of a map grid. */
export interface Cell {
  readonly col: number;
  readonly row: number;
}

/** A problem with a map's grid, at a cell (row and col) or at the whole map. */
export interface MapProblem {
  code: string;
  message: string;
  row?: number;
  col?: number;
}

/** Is the cell kind walked by enemies? */
export function isPathKind(kind: CellKind): boolean {
  return kind === 'path' || kind === 'entry' || kind === 'exit';
}

/** Every cell's kind, `kinds[row][col]`, from the kit's legend and the header's own characters. */
export function cellKinds(
  rows: readonly string[],
  extra: Readonly<Record<string, CellKind>> = {},
): CellKind[][] {
  return rows.map((line) =>
    [...line].map((ch) => (Object.hasOwn(extra, ch) ? extra[ch]! : (LEGEND[ch]?.cell ?? 'blocked'))),
  );
}

/** The four neighbours of a cell, north, east, south, west, that are inside the grid. */
function neighbours(kinds: readonly CellKind[][], c: Cell): Cell[] {
  const out: Cell[] = [];
  for (const [dc, dr] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const) {
    const col = c.col + dc;
    const row = c.row + dr;
    if (row >= 0 && row < kinds.length && col >= 0 && col < (kinds[row]?.length ?? 0)) out.push({ col, row });
  }
  return out;
}

const at = (c: Cell): string => `row ${c.row} col ${c.col}`;

/** The path from entry to exit, or every problem that keeps the grid from having one. */
export function tracePath(
  kinds: readonly CellKind[][],
): { ok: true; path: Cell[] } | { ok: false; problems: MapProblem[] } {
  const problems: MapProblem[] = [];
  const of = (kind: CellKind): Cell[] =>
    kinds.flatMap((line, row) => line.flatMap((k, col) => (k === kind ? [{ col, row }] : [])));
  const ends = (kind: 'entry' | 'exit', none: string, two: string, what: string): Cell | undefined => {
    const found = of(kind);
    if (found.length === 0) problems.push({ code: none, message: `the map has no ${what}` });
    for (const extra of found.slice(1))
      problems.push({
        code: two,
        message: `a second ${what}; the first is at ${at(found[0]!)}`,
        row: extra.row,
        col: extra.col,
      });
    return found[0];
  };
  const entry = ends('entry', 'no_entry', 'two_entries', 'path entry (S)');
  const exit = ends('exit', 'no_exit', 'two_exits', 'path exit (X)');
  if (problems.length > 0 || entry === undefined || exit === undefined) return { ok: false, problems };

  const walkable = (c: Cell) => isPathKind(kinds[c.row]![c.col]!);
  const key = (c: Cell) => `${c.col},${c.row}`;
  const seen = new Set<string>([key(entry)]);
  const path: Cell[] = [entry];
  let here = entry;
  while (here.col !== exit.col || here.row !== exit.row) {
    const next = neighbours(kinds, here).filter((n) => walkable(n) && !seen.has(key(n)));
    if (next.length === 0) {
      problems.push({
        code: 'path_broken',
        message: `the path stops at ${at(here)} before reaching the exit at ${at(exit)}`,
        row: here.row,
        col: here.col,
      });
      return { ok: false, problems };
    }
    if (next.length > 1) {
      problems.push({
        code: 'path_branch',
        message: `the path branches at ${at(here)} (to ${next.map(at).join(' and ')}); it must be one walk`,
        row: here.row,
        col: here.col,
      });
      return { ok: false, problems };
    }
    here = next[0]!;
    seen.add(key(here));
    path.push(here);
  }
  kinds.forEach((line, row) =>
    line.forEach((k, col) => {
      if (isPathKind(k) && !seen.has(`${col},${row}`))
        problems.push({
          code: 'path_off_walk',
          message: `row ${row} col ${col} is a path cell off the walk from entry to exit`,
          row,
          col,
        });
    }),
  );
  return problems.length > 0 ? { ok: false, problems } : { ok: true, path };
}
