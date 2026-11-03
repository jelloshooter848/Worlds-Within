import { describe, expect, it } from 'vitest';
import { Actions, type Action } from './actions';
import { heldActions, InputRecorder } from './input-recorder';
import { ScriptedInput, type InputScript } from './scripted-input';
import { Rng } from '../rng';

/** Every frame's held actions when `script` plays for `frames` frames. */
function replay(script: InputScript, frames: number): Action[][] {
  const input = new ScriptedInput(script);
  const out: Action[][] = [];
  for (let i = 0; i < frames; i++) {
    input.next();
    out.push(heldActions(input));
  }
  return out;
}

describe('InputRecorder', () => {
  it('writes one step per change, frame 0 the first frame, holds in Actions order', () => {
    const rec = new InputRecorder();
    rec.record(['up']);
    rec.record(['up']);
    rec.record(['attack', 'right']);
    rec.record([]);
    rec.record([]);
    expect(rec.length).toBe(5);
    expect(rec.script()).toEqual({
      steps: [
        { frame: 0, hold: ['up'] },
        { frame: 2, hold: ['right', 'attack'] },
        { frame: 3, hold: [] },
      ],
    });
  });

  it('writes no step for frames with nothing held before the first held one', () => {
    const rec = new InputRecorder();
    rec.record([]);
    rec.record([]);
    rec.record(['jump', 'jump']);
    expect(rec.script()).toEqual({ steps: [{ frame: 2, hold: ['jump'] }] });
    expect(new InputRecorder().script()).toEqual({ steps: [] });
  });

  it('gives a copy: recording on does not change a script already taken', () => {
    const rec = new InputRecorder();
    rec.record(['left']);
    const taken = rec.script();
    rec.record(['right']);
    expect(taken).toEqual({ steps: [{ frame: 0, hold: ['left'] }] });
  });

  it('replays to the same held actions at every frame (random holds, seeded)', () => {
    const rng = new Rng(7);
    for (let round = 0; round < 20; round++) {
      const frames: Action[][] = [];
      let held: Action[] = [];
      for (let f = 0; f < 300; f++) {
        if (rng.chance(0.1)) held = Actions.filter(() => rng.chance(0.25));
        frames.push(held);
      }
      const rec = new InputRecorder();
      for (const h of frames) rec.record(h);
      expect(replay(rec.script(), frames.length)).toEqual(frames);
      // Minimal: no two steps in a row hold the same set.
      const steps = rec.script().steps;
      for (let i = 1; i < steps.length; i++) expect(steps[i]!.hold).not.toEqual(steps[i - 1]!.hold);
    }
  });

  it('re-records a replayed script as the same script (recordFrame on a ScriptedInput)', () => {
    const script: InputScript = {
      steps: [
        { frame: 0, hold: ['up'] },
        { frame: 11, hold: ['right'] },
        { frame: 13, hold: ['attack'] },
        { frame: 14, hold: [] },
      ],
    };
    const input = new ScriptedInput(script);
    const rec = new InputRecorder();
    for (let f = 0; f < 20; f++) {
      input.next();
      rec.recordFrame(input);
    }
    expect(rec.script()).toEqual(script);
  });

  it('records taps beside the holds, and a script without taps has none (gap D1)', () => {
    const script: InputScript = {
      steps: [{ frame: 2, hold: ['jump'] }],
      taps: [
        { frame: 0, x: 8, y: 9 },
        { frame: 4, x: 1.5, y: 2, button: 'secondary' },
        { frame: 4, x: 3, y: 4 },
      ],
    };
    const input = new ScriptedInput(script);
    const rec = new InputRecorder();
    for (let f = 0; f < 6; f++) {
      input.next();
      rec.recordFrame(input);
    }
    expect(rec.script()).toEqual(script);
    const keys = new InputRecorder();
    keys.record(['up']);
    expect(keys.script()).toEqual({ steps: [{ frame: 0, hold: ['up'] }] });
  });
});
