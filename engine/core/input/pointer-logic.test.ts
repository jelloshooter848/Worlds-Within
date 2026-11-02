import { describe, expect, it } from 'vitest';
import { boxRect, PointerGestures, type PointerGesture, type PointerSample } from './pointer-logic';

const SCREEN = { width: 320, height: 240 };

/** Feeds `samples` in order and returns every gesture they make. */
function run(samples: PointerSample[], g = new PointerGestures({ screen: SCREEN })): PointerGesture[] {
  return samples.flatMap((s) => g.feed(s));
}

const mouse = {
  down: (x: number, y: number, t = 0, button: 0 | 1 | 2 = 0): PointerSample => ({
    type: 'down',
    id: 1,
    kind: 'mouse',
    button,
    x,
    y,
    t,
  }),
  move: (x: number, y: number, t = 0): PointerSample => ({ type: 'move', id: 1, kind: 'mouse', x, y, t }),
  up: (x: number, y: number, t = 0): PointerSample => ({ type: 'up', id: 1, kind: 'mouse', x, y, t }),
};

const finger = (id: number) => ({
  down: (x: number, y: number, t = 0): PointerSample => ({
    type: 'down',
    id,
    kind: 'touch',
    button: 0,
    x,
    y,
    t,
  }),
  move: (x: number, y: number, t = 0): PointerSample => ({ type: 'move', id, kind: 'touch', x, y, t }),
  up: (x: number, y: number, t = 0): PointerSample => ({ type: 'up', id, kind: 'touch', x, y, t }),
});

describe('PointerGestures: mouse', () => {
  it('a left click is a primary tap at the point it went down, even with a little jitter', () => {
    expect(run([mouse.down(100, 50), mouse.move(102, 51), mouse.up(102, 51, 80)])).toEqual([
      { type: 'tap', button: 'primary', x: 100, y: 50, kind: 'mouse' },
    ]);
  });

  it('a right click is a secondary tap; a right drag is nothing', () => {
    expect(run([mouse.down(10, 20, 0, 2), mouse.up(10, 20, 50)])).toEqual([
      { type: 'tap', button: 'secondary', x: 10, y: 20, kind: 'mouse' },
    ]);
    expect(run([mouse.down(10, 20, 0, 2), mouse.move(40, 20), mouse.up(40, 20, 50)])).toEqual([]);
  });

  it('a left drag past the slop is a box: moves while held, then its end', () => {
    const out = run([
      mouse.down(10, 10),
      mouse.move(12, 12),
      mouse.move(30, 40),
      mouse.move(60, 5),
      mouse.up(60, 5),
    ]);
    expect(out).toEqual([
      { type: 'box', phase: 'move', x0: 10, y0: 10, x1: 30, y1: 40, kind: 'mouse' },
      { type: 'box', phase: 'move', x0: 10, y0: 10, x1: 60, y1: 5, kind: 'mouse' },
      { type: 'box', phase: 'end', x0: 10, y0: 10, x1: 60, y1: 5, kind: 'mouse' },
    ]);
    expect(boxRect(out[2] as Extract<PointerGesture, { type: 'box' }>)).toEqual({ x: 10, y: 5, w: 50, h: 5 });
  });

  it('a box the browser cancels is cancelled, not ended', () => {
    const out = run([mouse.down(10, 10), mouse.move(30, 30), { type: 'cancel', id: 1, t: 5 }]);
    expect(out.at(-1)).toEqual({
      type: 'box',
      phase: 'cancel',
      x0: 10,
      y0: 10,
      x1: 30,
      y1: 30,
      kind: 'mouse',
    });
  });

  it('a middle drag pans by each move, and is no tap', () => {
    expect(
      run([mouse.down(100, 100, 0, 1), mouse.move(110, 95), mouse.move(111, 95), mouse.up(111, 95)]),
    ).toEqual([
      { type: 'pan', dx: 10, dy: -5, source: 'drag' },
      { type: 'pan', dx: 1, dy: 0, source: 'drag' },
    ]);
  });

  it('the wheel zooms about the cursor: towards the user zooms in, 500 px doubles', () => {
    const out = run([
      { type: 'wheel', x: 40, y: 30, deltaY: -500, t: 0 },
      { type: 'wheel', x: 40, y: 30, deltaY: 100, t: 1 },
      { type: 'wheel', x: 40, y: 30, deltaY: 0, t: 2 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ type: 'zoom', factor: 2, x: 40, y: 30, source: 'wheel' });
    const out1 = out[1] as Extract<PointerGesture, { type: 'zoom' }>;
    expect(out1.factor).toBeCloseTo(2 ** -0.2, 10);
  });

  it('the hovering cursor at an edge scrolls each tick, not while a button is down or after it leaves', () => {
    const g = new PointerGestures({ screen: SCREEN });
    expect(g.tick(0)).toEqual([]);
    g.feed(mouse.move(160, 120));
    expect(g.tick(1)).toEqual([]);
    g.feed(mouse.move(319, 0));
    expect(g.tick(2)).toEqual([{ type: 'pan', dx: -4, dy: 4, source: 'edge' }]);
    g.feed(mouse.move(1, 200));
    expect(g.tick(3)).toEqual([{ type: 'pan', dx: 4, dy: 0, source: 'edge' }]);
    expect(g.cursor()).toEqual({ x: 1, y: 200 });
    g.feed(mouse.down(1, 200));
    expect(g.tick(4)).toEqual([]);
    g.feed(mouse.up(1, 200));
    g.feed({ type: 'leave', t: 5 });
    expect(g.tick(6)).toEqual([]);
    expect(g.cursor()).toBeNull();
  });

  it('edge scroll is off with a margin of 0', () => {
    const g = new PointerGestures({ screen: SCREEN, edgeMargin: 0 });
    g.feed(mouse.move(0, 0));
    expect(g.tick(0)).toEqual([]);
  });
});

describe('PointerGestures: touch', () => {
  const a = finger(1);
  const b = finger(2);

  it('a quick tap is primary; a hold is secondary on the tick it passes the long-press time', () => {
    expect(run([a.down(50, 60, 0), a.up(51, 60, 120)])).toEqual([
      { type: 'tap', button: 'primary', x: 50, y: 60, kind: 'touch' },
    ]);
    const g = new PointerGestures({ screen: SCREEN });
    g.feed(a.down(50, 60, 1000));
    expect(g.tick(1400)).toEqual([]);
    expect(g.tick(1500)).toEqual([{ type: 'tap', button: 'secondary', x: 50, y: 60, kind: 'touch' }]);
    expect(g.feed(a.up(50, 60, 1700))).toEqual([]);
  });

  it('a long hold lifted before any tick is still secondary', () => {
    expect(run([a.down(5, 6, 0), a.up(5, 6, 600)])).toEqual([
      { type: 'tap', button: 'secondary', x: 5, y: 6, kind: 'touch' },
    ]);
  });

  it('a one-finger drag is a box select, and never long-presses', () => {
    const g = new PointerGestures({ screen: SCREEN });
    const out = run([a.down(20, 20, 0), a.move(80, 70, 50)], g);
    expect(g.tick(900)).toEqual([]);
    out.push(...g.feed(a.up(90, 70, 1000)));
    expect(out).toEqual([
      { type: 'box', phase: 'move', x0: 20, y0: 20, x1: 80, y1: 70, kind: 'touch' },
      { type: 'box', phase: 'end', x0: 20, y0: 20, x1: 90, y1: 70, kind: 'touch' },
    ]);
  });

  it('two fingers dragged together pan by their midpoint (any zoom wobble between samples nets to 1)', () => {
    const out = run([
      a.down(100, 100),
      b.down(140, 100),
      a.move(110, 90),
      b.move(150, 90),
      a.up(110, 90),
      b.up(150, 90),
    ]);
    expect(out.filter((g) => g.type === 'pan')).toEqual([
      { type: 'pan', dx: 5, dy: -5, source: 'drag' },
      { type: 'pan', dx: 5, dy: -5, source: 'drag' },
    ]);
    let zoom = 1;
    for (const g of out) if (g.type === 'zoom') zoom *= g.factor;
    expect(zoom).toBeCloseTo(1, 10);
    expect(out.some((g) => g.type === 'tap' || g.type === 'box')).toBe(false);
  });

  it('two fingers spread apart zoom in about their midpoint (pinch), and give no tap', () => {
    const out = run([
      a.down(100, 100),
      b.down(120, 100),
      a.move(90, 100),
      b.move(130, 100),
      b.up(130, 100),
      a.up(90, 100),
    ]);
    expect(out).toEqual([
      // a moved left 10: the midpoint moves 5 left and the distance goes 20 -> 30.
      { type: 'pan', dx: -5, dy: 0, source: 'drag' },
      { type: 'zoom', factor: 1.5, x: 105, y: 100, source: 'pinch' },
      // b moved right 10: the midpoint comes back 5 and the distance goes 30 -> 40.
      { type: 'pan', dx: 5, dy: 0, source: 'drag' },
      { type: 'zoom', factor: 40 / 30, x: 110, y: 100, source: 'pinch' },
    ]);
    const zoom = out
      .filter((g) => g.type === 'zoom')
      .reduce((z, g) => z * (g.type === 'zoom' ? g.factor : 1), 1);
    expect(zoom).toBeCloseTo(2, 10);
  });

  it("a second finger cancels the first's box, and the finger left after a pinch does nothing", () => {
    const out = run([
      a.down(10, 10),
      a.move(50, 50),
      b.down(200, 200),
      b.up(200, 200),
      a.move(70, 80),
      a.up(70, 80),
    ]);
    expect(out).toEqual([
      { type: 'box', phase: 'move', x0: 10, y0: 10, x1: 50, y1: 50, kind: 'touch' },
      { type: 'box', phase: 'cancel', x0: 10, y0: 10, x1: 50, y1: 50, kind: 'touch' },
    ]);
  });

  it('touch does not hover, so it never edge-scrolls', () => {
    const g = new PointerGestures({ screen: SCREEN });
    g.feed(a.down(0, 0, 0));
    g.feed(a.up(0, 0, 10));
    expect(g.cursor()).toBeNull();
    expect(g.tick(20)).toEqual([]);
  });

  it('the same samples give the same gestures every time', () => {
    const samples = [a.down(1, 2), b.down(30, 40), a.move(3, 4), b.move(60, 80), a.up(3, 4), b.up(60, 80)];
    expect(run(samples)).toEqual(run(samples));
  });
});
