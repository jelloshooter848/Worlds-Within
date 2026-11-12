import type { Action } from '@engine/core/input/actions';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { MiniGameControl } from '@engine/core/minigame';
import { cameraView, clampCameraAxis, type DeepReadonly, type PresentFrame } from '@engine/core/present';
import type { Cell } from './map';
import type { TdCursorView } from './present';
import { TD_TILE_SIZE } from './present';
import type { TdCommand, TdWorld } from './world';

/**
 * The player's controls (Engine 0.12, docs/BUILD-LOG.md, decision 3, item 199): the shared
 * `Actions` drive a cursor over the grid, and each step's input becomes kit commands (`TdCommand`)
 * the round carries out at the start of its next step. Like the round it is deterministic and
 * whole-number, so a `ScriptedInput` run file replays a round exactly.
 *
 * - `left`, `right`, `up`, `down` move the cursor one cell on the press, then, held, once every
 *   `REPEAT_EVERY` ticks after `REPEAT_DELAY` ticks; it stays on the map.
 * - `jump` places the chosen tower type on the cursor's cell; on a cell whose tower can be upgraded
 *   (its type has `levels`) it upgrades that tower instead (Engine 0.16 E3). The cursor on a tower
 *   is that tower selected (`selectedTower`).
 * - `attack` cycles the chosen type through the map's `towers` list, in order.
 * - `start` starts the next wave.
 * - `special` sells the tower on the cursor's cell.
 *
 * A pointer tap (`tap`) is mapped to a cell through the frame's camera (`cellAtScreen`): a primary
 * tap moves the cursor there (on a tower: selects it), or on the cursor's own cell places (or
 * upgrades the selected tower); a secondary tap (right click,
 * long-press) moves the cursor there and sells. From Engine 0.15 (gap D1) taps are frame input
 * (`InputFrame.taps`, game screen pixels): `TdGame.step` reads them and calls `tap`, so a run file's
 * `input.taps` replays a round played by tapping. `screenAtCell` is `cellAtScreen`'s inverse.
 */

/**
 * The upgrade row of `TD_CONTROLS` (Engine 0.16 E3): `jump` or a second tap on a selected tower
 * upgrades it. A page whose towers have no `levels` (the classic road, a `td-defence` round
 * without `upgrades`) leaves it out of its hint (`TD_CONTROLS.filter((c) => c !== TD_UPGRADE_CONTROL)`).
 */
export const TD_UPGRADE_CONTROL: MiniGameControl = {
  actions: ['jump'],
  tap: 'a second tap on a tower',
  label: 'upgrade',
};

/**
 * The controls above as data (Engine 0.15 T10, lesson D14), for a page's key hint
 * (`controlsHint` in `engine/core/minigame.ts`, with the player's key names): the `td-defence`
 * round declares them (with "give up") and the tower-defense sample's page shows them.
 */
export const TD_CONTROLS: readonly MiniGameControl[] = [
  { actions: ['left', 'right', 'up', 'down'], tap: 'a tap', label: 'move' },
  { actions: ['jump'], tap: 'a tap on the cursor', label: 'build' },
  TD_UPGRADE_CONTROL,
  { actions: ['attack'], label: 'next tower' },
  { actions: ['special'], tap: 'a right click', label: 'sell' },
  { actions: ['start'], label: 'send the wave' },
];

/** Ticks a direction is held before it repeats. */
export const REPEAT_DELAY = 10;
/** Ticks between repeats while held. */
export const REPEAT_EVERY = 4;

const DIRS: readonly { action: Action; dc: number; dr: number }[] = [
  { action: 'left', dc: -1, dr: 0 },
  { action: 'right', dc: 1, dr: 0 },
  { action: 'up', dc: 0, dr: -1 },
  { action: 'down', dc: 0, dr: 1 },
];

/** The grid the cursor moves over: its size and the tower types in button order. */
export interface TdGrid {
  cols: number;
  rows: number;
  towers: readonly string[];
  /** Where the cursor starts (the first build cell in reading order, else 0, 0). */
  start: Cell;
  /**
   * Whether the cell holds a tower that can be upgraded (its type has `levels`, Engine 0.16 E3):
   * `jump` and a tap on the cursor upgrade it instead of placing. Left out, they always place.
   */
  upgradable?: (col: number, row: number) => boolean;
}

/** The grid of a round: its map's size, tower list and first build cell. */
export function gridOf(world: TdWorld): TdGrid {
  let start: Cell = { col: 0, row: 0 };
  search: for (let row = 0; row < world.kinds.length; row++)
    for (let col = 0; col < world.kinds[row]!.length; col++)
      if (world.kinds[row]![col] === 'build') {
        start = { col, row };
        break search;
      }
  return {
    cols: world.kinds[0]?.length ?? 0,
    rows: world.kinds.length,
    towers: world.map.towers,
    start,
    upgradable: (col, row) => {
      const t = world.towerAt(col, row);
      return t !== undefined && (world.towerTypes[t.type]?.levels?.length ?? 0) > 0;
    },
  };
}

/** What `TdControls.snapshot()` gives: JSON-safe, whole numbers. */
export interface TdControlsSnapshot {
  [key: string]: number | string | number[];
  col: number;
  row: number;
  tower: string;
  /** Ticks each of left, right, up, down has been held (0: up). */
  held: number[];
}

export class TdControls {
  col: number;
  row: number;
  /** The chosen tower type's index in the grid's `towers`. */
  choice = 0;
  private readonly held = [0, 0, 0, 0];

  constructor(readonly grid: TdGrid) {
    this.col = grid.start.col;
    this.row = grid.start.row;
  }

  /** The chosen tower type id. */
  get tower(): string {
    return this.grid.towers[this.choice]!;
  }

  /** The cursor and chosen type, for `presentWorld`'s `cursor`. */
  view(): TdCursorView {
    return { col: this.col, row: this.row, tower: this.tower };
  }

  /** Reads one step's input; returns the commands it makes, in the order above. */
  input(frame: InputFrame): TdCommand[] {
    DIRS.forEach((d, i) => {
      if (!frame.held(d.action)) {
        this.held[i] = 0;
        return;
      }
      const n = this.held[i]!;
      this.held[i] = n + 1;
      if (n === 0 || (n >= REPEAT_DELAY && (n - REPEAT_DELAY) % REPEAT_EVERY === 0)) this.moveBy(d.dc, d.dr);
    });
    if (frame.pressed('attack')) this.choice = (this.choice + 1) % this.grid.towers.length;
    const out: TdCommand[] = [];
    if (frame.pressed('jump')) out.push(this.buildHere());
    if (frame.pressed('special')) out.push({ type: 'sell', col: this.col, row: this.row });
    if (frame.pressed('start')) out.push({ type: 'start-wave' });
    return out;
  }

  /** Moves the cursor by a cell offset, staying on the grid. */
  moveBy(dc: number, dr: number): void {
    this.moveTo(this.col + dc, this.row + dr);
  }

  /** Puts the cursor on a cell (clamped to the grid). */
  moveTo(col: number, row: number): void {
    this.col = Math.max(0, Math.min(this.grid.cols - 1, col));
    this.row = Math.max(0, Math.min(this.grid.rows - 1, row));
  }

  /** Chooses a tower type by id; false when the map does not list it. */
  choose(tower: string): boolean {
    const i = this.grid.towers.indexOf(tower);
    if (i < 0) return false;
    this.choice = i;
    return true;
  }

  /**
   * A pointer tap at picture point (x, y) on `frame` (the frame it was shown on): primary moves the
   * cursor to the tapped cell, or places when it is the cursor's own; secondary moves there and
   * sells. A tap off the map does nothing.
   */
  tap(
    x: number,
    y: number,
    frame: DeepReadonly<Pick<PresentFrame, 'size' | 'camera'>>,
    button: 'primary' | 'secondary' = 'primary',
    tileSize = TD_TILE_SIZE,
  ): TdCommand[] {
    const cell = cellAtScreen(x, y, frame, this.grid, tileSize);
    if (cell === null) return [];
    if (button === 'secondary') {
      this.moveTo(cell.col, cell.row);
      return [{ type: 'sell', col: cell.col, row: cell.row }];
    }
    if (cell.col === this.col && cell.row === this.row) return [this.buildHere()];
    this.moveTo(cell.col, cell.row);
    return [];
  }

  /** The cursor and chosen type as plain data, for a game's snapshot. */
  snapshot(): TdControlsSnapshot {
    return { col: this.col, row: this.row, tower: this.tower, held: [...this.held] };
  }

  /** Whether the cursor is on a tower that can be upgraded: that tower is selected. */
  get onUpgradable(): boolean {
    return this.grid.upgradable?.(this.col, this.row) ?? false;
  }

  /** `jump` or a tap on the cursor: upgrade the selected tower, else place the chosen type. */
  private buildHere(): TdCommand {
    if (this.onUpgradable) return { type: 'upgrade', col: this.col, row: this.row };
    return { type: 'place', tower: this.tower, col: this.col, row: this.row };
  }
}

/**
 * The cell under picture point (x, y) of a frame, or null off the map: the camera's top-left as
 * the presenters frame it (the hint's centre and zoom, clamped to its `bounds`, else the map), then
 * the inverse of the Canvas2D presenter's `round(wx * zoom) - round(left * zoom)`.
 */
export function cellAtScreen(
  x: number,
  y: number,
  frame: DeepReadonly<Pick<PresentFrame, 'size' | 'camera'>>,
  grid: Pick<TdGrid, 'cols' | 'rows'>,
  tileSize = TD_TILE_SIZE,
): Cell | null {
  const zoom = frame.camera?.zoom ?? 1;
  const view = cameraView(frame.size, zoom);
  const area = frame.camera?.bounds ?? { x: 0, y: 0, w: grid.cols * tileSize, h: grid.rows * tileSize };
  const cx = frame.camera?.x ?? area.x + area.w / 2;
  const cy = frame.camera?.y ?? area.y + area.h / 2;
  const left = clampCameraAxis(Math.round(cx - view.width / 2), area.x, area.w, view.width);
  const top = clampCameraAxis(Math.round(cy - view.height / 2), area.y, area.h, view.height);
  const wx = (x + Math.round(left * zoom)) / zoom;
  const wy = (y + Math.round(top * zoom)) / zoom;
  const col = Math.floor(wx / tileSize);
  const row = Math.floor(wy / tileSize);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return null;
  return { col, row };
}

/**
 * The centre of `cell` as a picture point of a frame (Engine 0.15, gap D13): the exact inverse of
 * {@link cellAtScreen} for the frame's camera (the same top-left, then the cell's centre at the
 * zoom), so `cellAtScreen(...screenAtCell(cell))` is `cell`. A page script or browser test maps it
 * on to the page with the display's `toClient`. Off-map cells give points off the map too.
 */
export function screenAtCell(
  cell: Cell,
  frame: DeepReadonly<Pick<PresentFrame, 'size' | 'camera'>>,
  grid: Pick<TdGrid, 'cols' | 'rows'>,
  tileSize = TD_TILE_SIZE,
): { x: number; y: number } {
  const zoom = frame.camera?.zoom ?? 1;
  const view = cameraView(frame.size, zoom);
  const area = frame.camera?.bounds ?? { x: 0, y: 0, w: grid.cols * tileSize, h: grid.rows * tileSize };
  const cx = frame.camera?.x ?? area.x + area.w / 2;
  const cy = frame.camera?.y ?? area.y + area.h / 2;
  const left = clampCameraAxis(Math.round(cx - view.width / 2), area.x, area.w, view.width);
  const top = clampCameraAxis(Math.round(cy - view.height / 2), area.y, area.h, view.height);
  return {
    x: (cell.col + 0.5) * tileSize * zoom - Math.round(left * zoom),
    y: (cell.row + 0.5) * tileSize * zoom - Math.round(top * zoom),
  };
}
