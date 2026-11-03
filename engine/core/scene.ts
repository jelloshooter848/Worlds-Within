import type { HeadlessGame } from './headless';
import type { InputFrame } from './input/input-manager';
import { MergedInput } from './input/merged-input';
import type { Renderer } from './gfx/renderer';
import type { TouchLabels } from './input/touch';
import type { DpadZoneId } from './input/touch-logic';

export interface Scene {
  enter?(): void;
  exit?(): void;
  /** `input` is player 1; `inputs` carries every player's frame for scenes that need them. */
  update(input: InputFrame, inputs: InputFrame[]): void;
  render(r: Renderer): void;
  /** When true the scene below keeps rendering (pause menu over the level). */
  readonly translucent?: boolean;
  /**
   * What the on-screen touch buttons say while this scene is on top (null hides a button). Keys
   * left out keep the menu defaults (main.ts, MENU_TOUCH_LABELS). Touch drives player 1 only.
   */
  touchLabels?(): TouchLabels;
  /** Which zones the touch d-pad reads while this scene is on top; absent: 'default'. */
  touchDpad?(): DpadZoneId;
  /**
   * The confirm action that must run inside the player's own input event (sharing, the
   * clipboard: iOS allows them only there), while the cursor sits on it; null or absent: none.
   * The input handlers run it in the event (engine/core/input/gesture.ts); the scene's frame then
   * skips the same press when GestureGate.take() says it was handled.
   */
  gesture?(): (() => void) | null;
  /**
   * Called as the scene is pushed, with the scene it goes over (undefined on an empty stack),
   * before enter(): a page can take its look from the page it opens over (the Classic pause's
   * boxes, MenuScene.pushedOver).
   */
  pushedOver?(below: Scene | undefined): void;
  /**
   * The headless game this scene plays (Engine 0.14 T8, gap G31), or null: the page's step hook
   * (`shell/debug.ts`) hashes, snapshots and replays a run file through the topmost scene that
   * reports one. `HostScene` given a `game` does; leave it out otherwise.
   */
  headless?(): HeadlessGame | null;
  /**
   * Ticks a second this scene steps at (Engine 0.15, gap D2; docs/BUILD-LOG.md, Engine 0.15,
   * decision 5, item 282), at most the loop's (`LOOP_HZ`, 60); left out, every loop step. The
   * stack steps it only on its ticks and hands it the steps' input merged (`MergedInput`: an
   * action pressed on any step since its last tick counts as pressed and held on the tick, and
   * every step's taps arrive). Per scene, so a battle at 10 ticks a second and a round pushed
   * over it at 60 play in one page. Headless runs step every tick and never read it.
   */
  readonly tickRate?: number;
}

/** The loop's steps a second (`FixedLoop` in the shell runs at 60). */
export const LOOP_HZ = 60;

/** A paced scene's clock and the input of the steps since its last tick. */
interface Pace {
  /** Ticks owed, in loop-steps-a-second units: a tick is due at `LOOP_HZ`. */
  acc: number;
  input: MergedInput;
}

export class SceneStack {
  private readonly stack: Scene[] = [];
  private readonly paces = new WeakMap<Scene, Pace>();

  /** `loopHz`: the loop steps a second `update` is called at (a scene's `tickRate` is paced on it). */
  constructor(private readonly loopHz = LOOP_HZ) {}

  get top(): Scene | undefined {
    return this.stack[this.stack.length - 1];
  }
  get depth(): number {
    return this.stack.length;
  }

  push(s: Scene): void {
    const below = this.top;
    this.stack.push(s);
    s.pushedOver?.(below);
    s.enter?.();
  }
  pop(): Scene | undefined {
    const s = this.stack.pop();
    s?.exit?.();
    return s;
  }
  replace(s: Scene): void {
    this.pop();
    this.push(s);
  }
  clear(): void {
    while (this.stack.length) this.pop();
  }

  /** The topmost scene `pred` accepts, or undefined. */
  find(pred: (s: Scene) => boolean): Scene | undefined {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const s = this.stack[i] as Scene;
      if (pred(s)) return s;
    }
    return undefined;
  }

  /**
   * One loop step: the top scene steps with player 1's frame, or, with a `tickRate` below the
   * loop's, merges it and steps only when its tick is due (then with the merged frame).
   */
  update(inputs: InputFrame[]): void {
    const first = inputs[0];
    const top = this.top;
    if (!first || !top) return;
    const rate = top.tickRate;
    if (rate === undefined || rate >= this.loopHz) {
      top.update(first, inputs);
      return;
    }
    if (!(rate > 0)) throw new Error(`a scene's tickRate must be above 0 (got ${rate})`);
    let pace = this.paces.get(top);
    if (pace === undefined) {
      pace = { acc: 0, input: new MergedInput() };
      this.paces.set(top, pace);
    }
    pace.input.add(first);
    pace.acc += rate;
    if (pace.acc < this.loopHz) return;
    pace.acc -= this.loopHz;
    top.update(pace.input, [pace.input, ...inputs.slice(1)]);
    pace.input.clear();
  }

  /** Draws the nearest opaque scene, then only the topmost overlay (stacked menus don't bleed through). */
  render(r: Renderer): void {
    const top = this.stack.length - 1;
    let base = top;
    while (base > 0 && this.stack[base]?.translucent) base--;
    this.stack[base]?.render(r);
    if (top !== base) this.stack[top]?.render(r);
  }
}
