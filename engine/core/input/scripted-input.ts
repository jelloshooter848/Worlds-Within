import type { Action } from './actions';
import type { InputFrame } from './input-manager';

/** Scripted input: each step sets the held actions from `frame` onward (presses are edges of holds). */
export interface InputScript {
  steps: { frame: number; hold: Action[] }[];
}

/**
 * An InputFrame driven by a script or a controller instead of a player: headless tests, bots and
 * (later) missions the player delegates instead of playing.
 */
export class ScriptedInput implements InputFrame {
  private cur = new Set<Action>();
  private prev = new Set<Action>();
  private frame = -1;
  private jumpAt = -1000;
  private override: Action[] | null = null;
  constructor(private readonly script: InputScript) {}

  /** Replace the script for the next frame (used by controllers). */
  setHeld(actions: Action[]): void {
    this.override = actions;
  }

  next(): void {
    this.frame++;
    this.prev = this.cur;
    let held: Action[] = [];
    if (this.override) held = this.override;
    else for (const s of this.script.steps) if (s.frame <= this.frame) held = s.hold;
    this.cur = new Set(held);
    if (this.pressed('jump')) this.jumpAt = this.frame;
  }
  held(a: Action): boolean {
    return this.cur.has(a);
  }
  pressed(a: Action): boolean {
    return this.cur.has(a) && !this.prev.has(a);
  }
  released(a: Action): boolean {
    return !this.cur.has(a) && this.prev.has(a);
  }
  bufferedJump(window: number): boolean {
    return this.frame - this.jumpAt < window;
  }
  consumeJumpBuffer(): void {
    this.jumpAt = -1000;
  }
  get dirX(): -1 | 0 | 1 {
    const l = this.cur.has('left');
    const r = this.cur.has('right');
    return l && !r ? -1 : r && !l ? 1 : 0;
  }
}
