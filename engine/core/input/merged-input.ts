import { Actions, type Action } from './actions';
import { frameTaps, type FrameTap, type InputFrame } from './input-manager';

/**
 * The input of several loop steps as one tick's frame (Engine 0.15, gap D2; docs/BUILD-LOG.md,
 * Engine 0.15, decision 5, item 282; the tower-defense sample's `TickInput`, moved here): what the
 * shell hands a scene that steps slower than the loop (`Scene.tickRate`). `add(frame)` once per
 * loop step, read it on the scene's tick, then `clear()`:
 *
 * - an action held on the last step, or pressed on any step since the last tick, counts as held;
 * - one pressed on any of them counts as pressed (a release and a new press between two ticks
 *   read as one held press: no press falls between ticks);
 * - released is the last step's;
 * - the taps are every step's, in order.
 *
 * So one press held for one tick on the page is one press in a run file. Jump buffering is the
 * press: `bufferedJump` is true on a tick whose steps pressed jump. Pure (on `PURE_CORE`).
 */
export class MergedInput implements InputFrame {
  private readonly pressedSince = new Set<Action>();
  private readonly tapList: FrameTap[] = [];
  private last: InputFrame | null = null;

  /** One loop step's frame. */
  add(frame: InputFrame): void {
    this.last = frame;
    for (const a of Actions) if (frame.pressed(a)) this.pressedSince.add(a);
    this.tapList.push(...frameTaps(frame));
  }

  /** Called after the tick that read it: the next tick starts afresh. */
  clear(): void {
    this.pressedSince.clear();
    this.tapList.length = 0;
  }

  held(a: Action): boolean {
    return this.pressedSince.has(a) || (this.last?.held(a) ?? false);
  }
  pressed(a: Action): boolean {
    return this.pressedSince.has(a);
  }
  released(a: Action): boolean {
    return this.last?.released(a) ?? false;
  }
  bufferedJump(): boolean {
    return this.pressedSince.has('jump');
  }
  consumeJumpBuffer(): void {}
  get dirX(): -1 | 0 | 1 {
    const l = this.held('left');
    const r = this.held('right');
    return l && !r ? -1 : r && !l ? 1 : 0;
  }
  taps(): readonly FrameTap[] {
    return [...this.tapList];
  }
}
