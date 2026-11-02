import type { RuleSwitch } from '@engine/core/rules';
import { legendEntry, type CellKind, type Collision } from './legend';
import { levelSize, type LevelDef } from './level';

/**
 * A level's tiles as the world collides with them: one cell kind per tile, read from the map once.
 * Collision comes from the legend and the world's rules: with `solid-tiles` off nothing is solid,
 * with `one-way-platforms` off one-way tiles are open air. Outside the grid every tile is empty
 * (the level's left and right edges are the `level-bounds` rule's, not walls; below the last row is
 * a pit).
 */
export class TileGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly cells: CellKind[];
  private readonly collisions: Collision[];

  constructor(
    level: Pick<LevelDef, 'map'>,
    private readonly rules: RuleSwitch,
  ) {
    const size = levelSize(level);
    this.cols = size.cols;
    this.rows = size.rows;
    // A spawn character (not in the legend) stands on open air.
    const entries = level.map.flatMap((line) => [...line].map((ch) => legendEntry(ch)));
    this.cells = entries.map((e) => e?.cell ?? 'empty');
    this.collisions = entries.map((e) => e?.collision ?? 'empty');
  }

  /** The cell kind at a tile (`empty` outside the grid). */
  cellAt(col: number, row: number): CellKind {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return 'empty';
    return this.cells[row * this.cols + col] as CellKind;
  }

  /** How the tile at col/row collides, with the world's rules applied. */
  collisionAt(col: number, row: number): Collision {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return 'empty';
    const c = this.collisions[row * this.cols + col] as Collision;
    if (c === 'solid') return this.rules.isOn('solid-tiles') ? 'solid' : 'empty';
    if (c === 'one-way') return this.rules.isOn('one-way-platforms') ? 'one-way' : 'empty';
    return 'empty';
  }

  isSolid(col: number, row: number): boolean {
    return this.collisionAt(col, row) === 'solid';
  }
}
