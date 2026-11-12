import { speedsProblem } from '../ui/menus';

/**
 * The game speed control (Engine 0.16 E5): the speeds a page offers (`[1, 2, 3]`) and the one
 * chosen. The browser shell (`boot.ts`) steps its `SceneStack` `speed` times a loop step
 * (`SceneStack.advance`), each step with its own input frame, so a sped-up page plays the very
 * ticks, and state hashes, of normal speed, only more of them a second. The speed is presentation:
 * it lives on the page, never in a game's state, snapshot, save or run file, and a page in
 * manual-loop mode (`?debug=step`) or replaying a run file steps at 1x whatever is chosen. Pure.
 */

/** The keys that cycle the speed (F: "fast"); a `keydown` on `window`, not from a text field. */
export const SPEED_CODES: readonly string[] = ['KeyF'];
/** The gamepad button that cycles the speed (standard mapping: RT). */
export const SPEED_PAD_BUTTON = 7;
/** The on-screen speed button's id (in the shell's control strip, under the pause button). */
export const SPEED_BUTTON_ID = 'ww-speed';
/** The frame status key the speed is shown under (`speed`: 1, 2, 3), for a skin's HUD. */
export const SPEED_STATUS = 'speed';

/** The speeds a page offers and the one chosen (the first, 1, at the start). */
export class GameSpeed {
  readonly speeds: readonly number[];
  private index = 0;

  constructor(speeds: readonly number[]) {
    const problem = speedsProblem(speeds);
    if (problem !== null) throw new Error(problem);
    this.speeds = [...speeds];
  }

  /** The speed chosen now. */
  get speed(): number {
    return this.speeds[this.index]!;
  }

  /** Moves to the next speed, back to 1 after the fastest; returns it. */
  cycle(): number {
    this.index = (this.index + 1) % this.speeds.length;
    return this.speed;
  }

  /** Chooses `speed` when the list has it (true), else changes nothing (false). */
  set(speed: number): boolean {
    const i = this.speeds.indexOf(speed);
    if (i < 0) return false;
    this.index = i;
    return true;
  }

  /** The speed as the button shows it: `1x`, `2x`. */
  get label(): string {
    return `${this.speed}x`;
  }
}
