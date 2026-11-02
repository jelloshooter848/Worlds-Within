import { describe, expect, it } from 'vitest';
import { PointerSource } from './pointer';

/** A fake canvas: records listeners, so a test can dispatch plain objects as events. */
function fakeCanvas() {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const captured: number[] = [];
  const el = {
    style: {} as Record<string, string>,
    addEventListener: (type: string, fn: (e: unknown) => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type: string, fn: (e: unknown) => void) =>
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((f) => f !== fn),
      ),
    setPointerCapture: (id: number) => captured.push(id),
  };
  const fire = (type: string, e: Record<string, unknown>) => {
    let prevented = false;
    const ev = { timeStamp: 0, preventDefault: () => (prevented = true), ...e };
    for (const fn of listeners.get(type) ?? []) fn(ev);
    return prevented;
  };
  return { el: el as unknown as HTMLElement, fire, captured, listeners };
}

/** Client px to picture px: the picture is drawn at 2x from (10, 20). */
const toScreen = (x: number, y: number) => ({ x: (x - 10) / 2, y: (y - 20) / 2 });

describe('PointerSource', () => {
  it('turns pointer events into gestures in picture pixels, one game step at a time', () => {
    const c = fakeCanvas();
    const src = new PointerSource(c.el, toScreen, { screen: { width: 320, height: 240 } });
    expect(c.el.style.touchAction).toBe('none');
    const p = { pointerId: 7, pointerType: 'mouse', button: 0 };
    expect(c.fire('pointerdown', { ...p, clientX: 110, clientY: 120, timeStamp: 0 })).toBe(true);
    expect(c.captured).toEqual([7]);
    c.fire('pointerup', { ...p, clientX: 110, clientY: 120, timeStamp: 50 });
    expect(src.gestures()).toEqual([]);
    src.beginFrame(60);
    expect(src.gestures()).toEqual([{ type: 'tap', button: 'primary', x: 50, y: 50, kind: 'mouse' }]);
    // Not read in that step: gone in the next.
    src.beginFrame(76);
    expect(src.gestures()).toEqual([]);
  });

  it('maps the right button, pens and touches, and a wheel in lines', () => {
    const c = fakeCanvas();
    const src = new PointerSource(c.el, toScreen, { screen: { width: 320, height: 240 } });
    c.fire('pointerdown', { pointerId: 1, pointerType: 'pen', button: 2, clientX: 10, clientY: 20 });
    c.fire('pointerup', { pointerId: 1, pointerType: 'pen', button: 2, clientX: 10, clientY: 20 });
    c.fire('pointerdown', { pointerId: 2, pointerType: 'touch', button: 0, clientX: 30, clientY: 40 });
    c.fire('pointerup', {
      pointerId: 2,
      pointerType: 'touch',
      button: 0,
      clientX: 30,
      clientY: 40,
      timeStamp: 10,
    });
    expect(c.fire('wheel', { clientX: 10, clientY: 20, deltaY: -1, deltaMode: 1 })).toBe(true);
    expect(c.fire('contextmenu', {})).toBe(true);
    src.beginFrame(20);
    expect(src.gestures()).toEqual([
      { type: 'tap', button: 'secondary', x: 0, y: 0, kind: 'pen' },
      { type: 'tap', button: 'primary', x: 10, y: 10, kind: 'touch' },
      { type: 'zoom', factor: 2 ** (16 / 500), x: 0, y: 0, source: 'wheel' },
    ]);
  });

  it('edge-scrolls while the mouse hovers at an edge, until it leaves; dispose removes every listener', () => {
    const c = fakeCanvas();
    const src = new PointerSource(c.el, toScreen, { screen: { width: 320, height: 240 } });
    c.fire('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 200 });
    expect(src.cursor()).toEqual({ x: 0, y: 90 });
    src.beginFrame(0);
    expect(src.gestures()).toEqual([{ type: 'pan', dx: 4, dy: 0, source: 'edge' }]);
    c.fire('pointerleave', { pointerId: 1, pointerType: 'mouse' });
    src.beginFrame(16);
    expect(src.gestures()).toEqual([]);
    src.dispose();
    expect([...c.listeners.values()].every((l) => l.length === 0)).toBe(true);
  });
});
