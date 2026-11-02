import type { RuleSwitch } from '@engine/core/rules';
import { CELL_COLLISION, legendEntry, type CellKind, type Collision } from './legend';
import { levelSize, type LevelDef } from './level';

/** A cell the world changed since the level started (a coin taken, a block used, a brick broken). */
export interface ChangedCell {
  col: number;
  row: number;
  cell: CellKind;
}

/**
 * A level's tiles as the world collides with them: one cell kind per tile, read from the map once
 * and changed by the world as it plays (`setCell`). Collision comes from the cell kind
 * (`CELL_COLLISION`) and the world's rules: with `solid-tiles` off nothing is solid, with
 * `one-way-platforms` off one-way tiles are open air. Outside the grid every tile is empty (the
 * level's left and right edges are the `level-bounds` rule's, not walls; below the last row is a
 * pit).
 */
export class TileGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly cells: CellKind[];
  private readonly changes = new Map<number, CellKind>();

  constructor(
    level: Pick<LevelDef, 'map'>,
    private readonly rules: RuleSwitch,
  ) {
    const size = levelSize(level);
    this.cols = size.cols;
    this.rows = size.rows;
    // A spawn character (not in the legend) stands on open air.
    this.cells = level.map.flatMap((line) => [...line].map((ch) => legendEntry(ch)?.cell ?? 'empty'));
  }

  private inside(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows;
  }

  /** The cell kind at a tile (`empty` outside the grid). */
  cellAt(col: number, row: number): CellKind {
    if (!this.inside(col, row)) return 'empty';
    return this.cells[row * this.cols + col] as CellKind;
  }

  /** Changes the cell at a tile (outside the grid nothing happens). */
  setCell(col: number, row: number, cell: CellKind): void {
    if (!this.inside(col, row)) return;
    const i = row * this.cols + col;
    this.cells[i] = cell;
    this.changes.set(i, cell);
  }

  /** The cells changed since the level started, in reading order. */
  changed(): ChangedCell[] {
    return [...this.changes.keys()]
      .sort((a, b) => a - b)
      .map((i) => ({ col: i % this.cols, row: Math.floor(i / this.cols), cell: this.cells[i] as CellKind }));
  }

  /** How the tile at col/row collides, with the world's rules applied. */
  collisionAt(col: number, row: number): Collision {
    const c = CELL_COLLISION[this.cellAt(col, row)];
    if (c === 'solid') return this.rules.isOn('solid-tiles') ? 'solid' : 'empty';
    if (c === 'one-way') return this.rules.isOn('one-way-platforms') ? 'one-way' : 'empty';
    return 'empty';
  }

  isSolid(col: number, row: number): boolean {
    return this.collisionAt(col, row) === 'solid';
  }
}
