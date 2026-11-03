import type { Action } from './actions';
import type { FrameTap, InputFrame } from './input-manager';

/** One scripted tap: on input frame `frame`, at game screen pixel (x, y); `primary` when left out. */
export interface ScriptedTap {
  frame: number;
  x: number;
  y: number;
  button?: FrameTap['button'];
}

/**
 * Scripted input: each step sets the held actions from `frame` onward (presses are edges of holds).
 * From Engine 0.15 (gap D1) the optional `taps` are pointer taps, each on its own frame (in file
 * order within a frame), so a round played by tapping replays from a run file.
 */
export interface InputScript {
  steps: { frame: number; hold: Action[] }[];
  taps?: ScriptedTap[];
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
  private tapList: readonly FrameTap[] = [];
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
    this.tapList = (this.script.taps ?? [])
      .filter((t) => t.frame === this.frame)
      .map((t) => ({ x: t.x, y: t.y, button: t.button ?? 'primary' }));
    if (this.pressed('jump')) this.jumpAt = this.frame;
  }
  taps(): readonly FrameTap[] {
    return this.tapList;
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
