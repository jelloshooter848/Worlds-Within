import { describe, expect, it } from 'vitest';
import { KeyboardSource } from './keyboard';

function key(type: 'keydown' | 'keyup', code: string): Event {
  const e = new Event(type) as Event & { code: string; repeat: boolean };
  e.code = code;
  e.repeat = false;
  return e;
}

describe('KeyboardSource', () => {
  it('latches a tap shorter than one poll so it is seen once', () => {
    const target = new EventTarget();
    const kb = new KeyboardSource(target);
    target.dispatchEvent(key('keydown', 'Enter'));
    target.dispatchEvent(key('keyup', 'Enter'));
    expect(kb.poll().has('Enter')).toBe(true);
    expect(kb.poll().has('Enter')).toBe(false);
  });

  it('keeps held keys down across polls', () => {
    const target = new EventTarget();
    const kb = new KeyboardSource(target);
    target.dispatchEvent(key('keydown', 'KeyZ'));
    expect(kb.poll().has('KeyZ')).toBe(true);
    expect(kb.poll().has('KeyZ')).toBe(true);
    target.dispatchEvent(key('keyup', 'KeyZ'));
    expect(kb.poll().has('KeyZ')).toBe(false);
  });

  it('reports just-pressed codes once for remap capture', () => {
    const target = new EventTarget();
    const kb = new KeyboardSource(target);
    target.dispatchEvent(key('keydown', 'KeyA'));
    expect(kb.takeJustPressed()).toEqual(['KeyA']);
    expect(kb.takeJustPressed()).toEqual([]);
  });
});
