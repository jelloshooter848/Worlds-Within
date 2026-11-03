import { describe, expect, it } from 'vitest';
import type { Scene } from '../scene';
import { SceneStack } from '../scene';
import { frameTaps, InputManager, NO_INPUT, type InputFrame, type InputSource } from './input-manager';
import { MergedInput } from './merged-input';
import { ScriptedInput } from './scripted-input';

// Engine 0.15, gaps D1 and D2: taps as frame input (`ScriptedInput`'s `taps`), the shell's merged
// input for a scene with a `tickRate` (`MergedInput`, paced by `SceneStack`), and a page button's
// press (`InputManager.press`).

/** A scene that keeps the frames it was stepped with, as what they held, pressed and tapped. */
function recordingScene(tickRate?: number) {
  const seen: { held: boolean; pressed: boolean; taps: number }[] = [];
  const scene: Scene = {
    ...(tickRate !== undefined && { tickRate }),
    update(input: InputFrame) {
      seen.push({ held: input.held('jump'), pressed: input.pressed('jump'), taps: frameTaps(input).length });
    },
    render() {},
  };
  return { scene, seen };
}

/** One scripted frame: `hold` held (pressed when new), plus `taps` taps. */
function frames(script: { hold: boolean; taps?: number }[]): ScriptedInput {
  return new ScriptedInput({
    steps: script.map((s, frame) => ({ frame, hold: s.hold ? ['jump'] : [] })),
    taps: script.flatMap((s, frame) =>
      Array.from({ length: s.taps ?? 0 }, () => ({ frame, x: frame, y: 0 })),
    ),
  });
}

describe('ScriptedInput taps', () => {
  it('gives each frame its taps, primary by default, and none to a frame without', () => {
    const input = new ScriptedInput({
      steps: [],
      taps: [
        { frame: 1, x: 10, y: 20 },
        { frame: 1, x: 11, y: 21, button: 'secondary' },
        { frame: 3, x: 5, y: 6 },
      ],
    });
    const got = [0, 1, 2, 3].map(() => (input.next(), input.taps()));
    expect(got).toEqual([
      [],
      [
        { x: 10, y: 20, button: 'primary' },
        { x: 11, y: 21, button: 'secondary' },
      ],
      [],
      [{ x: 5, y: 6, button: 'primary' }],
    ]);
    expect(frameTaps(NO_INPUT)).toEqual([]);
  });
});

describe('MergedInput', () => {
  it("counts a press on any step since the last tick, and every step's taps", () => {
    const merged = new MergedInput();
    const input = frames([{ hold: true, taps: 1 }, { hold: false }, { hold: false, taps: 2 }]);
    for (let i = 0; i < 3; i++) {
      input.next();
      merged.add(input);
    }
    expect(merged.pressed('jump')).toBe(true);
    expect(merged.held('jump')).toBe(true);
    expect(merged.bufferedJump()).toBe(true);
    expect(merged.taps().map((t) => t.x)).toEqual([0, 2, 2]);
    merged.clear();
    expect(merged.pressed('jump')).toBe(false);
    expect(merged.held('jump')).toBe(false);
    expect(merged.taps()).toEqual([]);
  });
});

describe("SceneStack and a scene's tickRate (gap D2)", () => {
  it('steps a 30-a-second scene every second loop step with the steps merged', () => {
    const stack = new SceneStack();
    const { scene, seen } = recordingScene(30);
    stack.push(scene);
    // A press on the first step of a tick, released on the tick's own step: still pressed there.
    const input = frames([
      { hold: true, taps: 1 },
      { hold: false },
      { hold: false },
      { hold: false, taps: 1 },
    ]);
    for (let i = 0; i < 4; i++) {
      input.next();
      stack.update([input]);
    }
    expect(seen).toEqual([
      { held: true, pressed: true, taps: 1 },
      { held: false, pressed: false, taps: 1 },
    ]);
  });

  it('paces a rate that does not divide the loop, and steps every loop step without one', () => {
    const stack = new SceneStack();
    const slow = recordingScene(24);
    stack.push(slow.scene);
    for (let i = 0; i < 60; i++) stack.update([NO_INPUT]);
    expect(slow.seen.length).toBe(24);
    const fast = recordingScene();
    stack.push(fast.scene);
    for (let i = 0; i < 7; i++) stack.update([NO_INPUT]);
    expect(fast.seen.length).toBe(7);
    // The slow scene under it waits, and keeps its own clock when it is on top again.
    stack.pop();
    for (let i = 0; i < 5; i++) stack.update([NO_INPUT]);
    expect(slow.seen.length).toBe(26);
  });

  it('refuses a tick rate of 0', () => {
    const stack = new SceneStack();
    stack.push(recordingScene(0).scene);
    expect(() => stack.update([NO_INPUT])).toThrow(/tickRate/);
  });
});

describe('InputManager.press (a page button)', () => {
  it('holds the action on the next frame only, then releases it', () => {
    const manager = new InputManager(1);
    const none: InputSource = { poll: () => new Set() };
    manager.addSource('keyboard', none);
    manager.press('start');
    manager.beginFrame();
    expect(manager.player(0).pressed('start')).toBe(true);
    manager.beginFrame();
    expect(manager.player(0).held('start')).toBe(false);
    expect(manager.player(0).released('start')).toBe(true);
  });

  it('carries frame taps the shell adds, for that frame only', () => {
    const manager = new InputManager(1);
    manager.beginFrame();
    manager.player(0).addTaps([{ x: 1, y: 2, button: 'primary' }]);
    expect(manager.player(0).taps()).toEqual([{ x: 1, y: 2, button: 'primary' }]);
    manager.beginFrame();
    expect(manager.player(0).taps()).toEqual([]);
  });
});
