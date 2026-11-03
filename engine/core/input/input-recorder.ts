import { Actions, type Action } from './actions';
import { frameTaps, type FrameTap, type InputFrame } from './input-manager';
import type { InputScript, ScriptedTap } from './scripted-input';

/**
 * Records held actions frame by frame as the shortest `ScriptedInput` script that replays them
 * (Engine 0.14 T9, gap M19): one step `{ frame, hold }` for each frame whose held set differs from
 * the frame before it, frame 0 the first frame recorded. A recording that starts with nothing held
 * has no step until something is (a `ScriptedInput` holds nothing before its first step). Holds are
 * written in `Actions` order, so the same frames always give the same text. Replaying the script
 * through a `ScriptedInput` gives exactly the recorded held actions at every frame
 * (`input-recorder.test.ts`). From Engine 0.15 (gap D1) a frame's pointer taps are recorded too,
 * as the script's `taps` (left out when there were none), so a tapped round replays. Pure (on `PURE_CORE`).
 */
export class InputRecorder {
  private readonly steps: { frame: number; hold: Action[] }[] = [];
  private readonly taps: ScriptedTap[] = [];
  private last = '';
  private frames = 0;

  /** The frames recorded so far. */
  get length(): number {
    return this.frames;
  }

  /** Records one frame's held actions (any order, repeats ignored) and its taps. */
  record(held: Iterable<Action>, taps: readonly FrameTap[] = []): void {
    for (const t of taps)
      this.taps.push(
        t.button === 'primary'
          ? { frame: this.frames, x: t.x, y: t.y }
          : { frame: this.frames, x: t.x, y: t.y, button: t.button },
      );
    const set = new Set(held);
    const hold = Actions.filter((a) => set.has(a));
    const key = hold.join(',');
    if (key !== this.last) this.steps.push({ frame: this.frames, hold });
    this.last = key;
    this.frames++;
  }

  /** Records what `frame` holds now (`heldActions`). */
  recordFrame(frame: InputFrame): void {
    this.record(heldActions(frame), frameTaps(frame));
  }

  /** The script so far: a copy, plain JSON. */
  script(): InputScript {
    const script: InputScript = { steps: this.steps.map((s) => ({ frame: s.frame, hold: [...s.hold] })) };
    if (this.taps.length > 0) script.taps = this.taps.map((t) => ({ ...t }));
    return script;
  }
}

/** The actions an input frame holds now, in `Actions` order. */
export function heldActions(frame: InputFrame): Action[] {
  return Actions.filter((a) => frame.held(a));
}
