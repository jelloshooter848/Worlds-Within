import type { Action } from '@engine/core/input/actions';
import type { TdGame } from './game';

/**
 * A small deterministic player for tests and tuning: it plays a plan through the same buttons a
 * person presses (`TdControls`), one press at a time with a released frame between presses, so a
 * round it plays is plain frame input (`ScriptedInput.setHeld`) and replays as a run file would.
 *
 * Steps, in order: `place` (cycle to the tower type with `attack`, walk the cursor to the cell,
 * then `jump`), `sell` (walk there, then `special`), `upgrade` (walk there, then `jump`, which
 * upgrades the tower there; Engine 0.16 E3), `wave` (`start`), `wait` (do nothing for
 * `ticks` steps) and `clear` (wait until no enemy of a started wave is left). After the last step
 * it holds nothing.
 */
export type TdBotStep =
  | { do: 'place'; tower: string; col: number; row: number }
  | { do: 'sell'; col: number; row: number }
  | { do: 'upgrade'; col: number; row: number }
  | { do: 'wave' }
  | { do: 'wait'; ticks: number }
  | { do: 'clear' };

export class TdBot {
  private at = 0;
  private waited = 0;
  private pressedLast = false;

  constructor(readonly plan: readonly TdBotStep[]) {}

  /** True once every step is done. */
  get done(): boolean {
    return this.at >= this.plan.length;
  }

  /** The actions to hold on the coming step of `game`. */
  next(game: TdGame): Action[] {
    if (this.pressedLast) {
      this.pressedLast = false;
      return [];
    }
    const step = this.plan[this.at];
    if (step === undefined) return [];
    const press = (a: Action, finished = false): Action[] => {
      this.pressedLast = true;
      if (finished) this.at++;
      return [a];
    };
    const c = game.controls;
    const walk = (col: number, row: number): Action | null =>
      c.col < col ? 'right' : c.col > col ? 'left' : c.row < row ? 'down' : c.row > row ? 'up' : null;
    switch (step.do) {
      case 'place': {
        if (c.tower !== step.tower) return press('attack');
        const dir = walk(step.col, step.row);
        return dir === null ? press('jump', true) : press(dir);
      }
      case 'sell': {
        const dir = walk(step.col, step.row);
        return dir === null ? press('special', true) : press(dir);
      }
      case 'upgrade': {
        const dir = walk(step.col, step.row);
        return dir === null ? press('jump', true) : press(dir);
      }
      case 'wave':
        return press('start', true);
      case 'wait':
        if (this.waited++ >= step.ticks) {
          this.waited = 0;
          this.at++;
          return this.next(game);
        }
        return [];
      case 'clear': {
        const w = game.world;
        let left = 0;
        for (let n = 1; n <= w.wavesStarted; n++) left += w.waveLeft(n);
        if (left === 0 || w.outcome !== 'playing') {
          this.at++;
          return this.next(game);
        }
        return [];
      }
    }
  }
}
