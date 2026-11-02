import { describe, expect, it } from 'vitest';
import { bindGestureKeys, GestureGate } from './gesture';

// iOS lets a page share or use the clipboard only inside the player's own input event: the
// gate runs the top scene's action in the keydown (or the touch button's release) itself.

function keydown(code: string, extra: Record<string, unknown> = {}): Event {
  const e = new Event('keydown');
  for (const [k, v] of Object.entries({ code, repeat: false, ...extra }))
    Object.defineProperty(e, k, { value: v });
  return e;
}

describe('GestureGate', () => {
  it('a confirm key runs the action inside its keydown; the frame then finds the press taken', () => {
    const log: string[] = [];
    let inEvent = false;
    const gate = new GestureGate(() => () => log.push(inEvent ? 'in event' : 'later'));
    const target = new EventTarget();
    bindGestureKeys(gate, target, (c) => c === 'KeyZ' || c === 'Enter');
    target.addEventListener('keydown', () => (inEvent = false));
    inEvent = true;
    target.dispatchEvent(keydown('KeyZ'));
    expect(log).toEqual(['in event']);
    expect(gate.take()).toBe(true);
    expect(gate.take()).toBe(false);
  });

  it('other keys, held repeats and keys typed into a text box do nothing', () => {
    let ran = 0;
    const gate = new GestureGate(() => () => ran++);
    const target = new EventTarget();
    bindGestureKeys(gate, target, (c) => c === 'KeyZ');
    target.dispatchEvent(keydown('ArrowDown'));
    target.dispatchEvent(keydown('KeyZ', { repeat: true }));
    target.dispatchEvent(keydown('KeyZ', { target: { tagName: 'TEXTAREA' } }));
    expect(ran).toBe(0);
    expect(gate.take()).toBe(false);
  });

  it('with no action offered, the frame handles the press (a gamepad, or an ordinary item)', () => {
    const gate = new GestureGate(() => null);
    expect(gate.key()).toBe(false);
    gate.touchDown();
    expect(gate.take()).toBe(false);
    expect(gate.touchUp()).toBe(false);
  });

  it('a touch button claims the press going down and runs the action as it lifts', () => {
    let ran = 0;
    const gate = new GestureGate(() => () => ran++);
    gate.touchDown();
    expect(ran).toBe(0);
    expect(gate.take()).toBe(true); // the frame between: nothing to do
    expect(gate.touchUp()).toBe(true);
    expect(ran).toBe(1);
    expect(gate.touchUp()).toBe(false); // once
  });

  it('a touch whose scene moved on before the lift runs nothing', () => {
    let offered = true;
    let ran = 0;
    const gate = new GestureGate(() => (offered ? () => ran++ : null));
    gate.touchDown();
    offered = false;
    expect(gate.touchUp()).toBe(false);
    expect(ran).toBe(0);
  });

  it('a claim nobody asked about is dropped after the frame', () => {
    const gate = new GestureGate(() => () => undefined);
    gate.key();
    gate.endFrame();
    expect(gate.take()).toBe(false);
  });
});
