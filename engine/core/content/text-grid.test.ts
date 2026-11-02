import { describe, expect, it } from 'vitest';
import { gridProblems, gridRows, parseTextGrid } from './text-grid';

const LEGEND = { '#': 'wall', '.': 'floor' } as const;

describe('parseTextGrid', () => {
  it('parses rows into cells through the legend', () => {
    const r = parseTextGrid(['#.#', '...'], LEGEND);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.grid.width).toBe(3);
    expect(r.grid.height).toBe(2);
    expect(r.grid.cells[0]).toEqual(['wall', 'floor', 'wall']);
    expect(r.grid.cells[1]?.[2]).toBe('floor');
  });

  it('parses a block of text, dropping \\r and blank lines around it', () => {
    const r = parseTextGrid('\n#.\r\n.#\r\n\n', LEGEND);
    expect(r.ok && r.grid.rows).toEqual(['#.', '.#']);
  });

  it('rejects a ragged row with its row and the first column that differs', () => {
    const r = parseTextGrid(['#..#', '#.', '#...#'], LEGEND);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([
      { code: 'ragged_row', row: 1, col: 2, message: 'row 1 is 2 wide, expected 4 (the width of row 0)' },
      { code: 'ragged_row', row: 2, col: 4, message: 'row 2 is 5 wide, expected 4 (the width of row 0)' },
    ]);
  });

  it('rejects unknown characters with row and column', () => {
    const r = parseTextGrid(['#..#', '#x.#', '##?#'], LEGEND);
    expect(r.problems.map((p) => [p.code, p.row, p.col])).toEqual([
      ['unknown_char', 1, 1],
      ['unknown_char', 2, 2],
    ]);
    expect(r.problems[0]?.message).toBe('row 1, col 1: "x" is not in the legend');
  });

  it('reports an inner blank line as a ragged row instead of dropping it', () => {
    expect(gridRows('##\n\n##')).toEqual(['##', '', '##']);
    expect(gridProblems(gridRows('##\n\n##'), LEGEND)[0]).toMatchObject({
      code: 'ragged_row',
      row: 1,
      col: 0,
    });
  });

  it('rejects an empty grid', () => {
    expect(parseTextGrid([], LEGEND).problems[0]?.code).toBe('empty_grid');
    expect(parseTextGrid('\n\n', LEGEND).problems[0]?.code).toBe('empty_grid');
  });

  it('counts an astral character as one cell', () => {
    const r = parseTextGrid(['🌲.', '.🌲'], { '🌲': 'tree', '.': 'grass' });
    expect(r.ok && r.grid.width).toBe(2);
  });

  it('accepts a set of allowed characters in gridProblems', () => {
    expect(gridProblems(['ab', 'ba'], new Set(['a', 'b']))).toEqual([]);
    expect(gridProblems(['ab', 'bc'], new Set(['a', 'b']))[0]).toMatchObject({ row: 1, col: 1 });
  });

  it('throws on a legend key that is not one character (a programming error)', () => {
    expect(() => parseTextGrid(['ab'], { ab: 1 })).toThrow(/not one character/);
  });
});
