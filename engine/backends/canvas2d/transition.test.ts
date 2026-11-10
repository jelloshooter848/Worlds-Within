import { describe, expect, it } from 'vitest';
import { transitionAt, transitionShape, type TransitionShape } from '@engine/core/fx';
import { drawTransition, type TransitionCtx } from './transition';

const SCREEN = { width: 64, height: 40 };

/** A 2D context that records each call (and the style and alpha a fill used). */
function recorder() {
  const calls: string[] = [];
  const stops: [number, string][] = [];
  const ctx = {
    globalAlpha: 1,
    fillStyle: '' as unknown,
    globalCompositeOperation: 'source-over',
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => calls.push('beginPath'),
    rect: (x: number, y: number, w: number, h: number) => calls.push(`rect ${x},${y} ${w}x${h}`),
    arc: (x: number, y: number, r: number) => calls.push(`arc ${x},${y} r${r}`),
    fill: (rule?: string) => calls.push(`fill ${rule}`),
    fillRect(x: number, y: number, w: number, h: number) {
      const style = typeof this.fillStyle === 'string' ? this.fillStyle : 'gradient';
      calls.push(`fillRect ${x},${y} ${w}x${h} ${style} @${this.globalAlpha}`);
    },
    createLinearGradient: (x0: number, y0: number, x1: number, y1: number) => {
      calls.push(`gradient ${x0},${y0} -> ${x1},${y1}`);
      return { addColorStop: (t: number, c: string) => stops.push([t, c]) };
    },
  };
  return { ctx: ctx as unknown as TransitionCtx, calls, stops };
}

const shapeAt = (
  spec: Parameters<typeof transitionAt>[0],
  age: number,
  focus = null as { x: number; y: number } | null,
) => transitionShape(transitionAt(spec, age)!, SCREEN, focus)!;

describe('drawTransition (Engine 0.16 T5)', () => {
  it('fades: the colour over the whole picture at the coverage', () => {
    const { ctx, calls } = recorder();
    drawTransition(ctx, shapeAt({ kind: 'fade', ticks: 4, color: '#102030' }, 1), SCREEN);
    expect(calls).toEqual(['save', 'fillRect 0,0 64x40 #102030 @0.5', 'restore']);
  });

  it('wipes: a gradient along the travel, opaque between the soft edges', () => {
    const { ctx, calls, stops } = recorder();
    const shape = shapeAt({ kind: 'wipe', ticks: 8, direction: 'left', edge: 8 }, 3) as Extract<
      TransitionShape,
      { kind: 'wipe' }
    >;
    drawTransition(ctx, shape, SCREEN);
    // From the trail (8 px off the right side) to the lead, leftwards.
    expect(calls[1]).toBe(`gradient 72,0 -> ${64 - shape.lead},0`);
    expect(calls[2]).toBe('fillRect 0,0 64x40 gradient @1');
    expect(stops.map(([, c]) => c)).toEqual([
      'rgba(0, 0, 0, 0)',
      'rgba(0, 0, 0, 1)',
      'rgba(0, 0, 0, 1)',
      'rgba(0, 0, 0, 0)',
    ]);
  });

  it('irises: the picture covered but for a circle on the focus', () => {
    const { ctx, calls } = recorder();
    const shape = shapeAt({ kind: 'iris', ticks: 4, color: '#fff' }, 2, { x: 20, y: 10 });
    drawTransition(ctx, shape, SCREEN);
    expect(calls).toEqual([
      'save',
      'beginPath',
      'rect 0,0 64x40',
      `arc 20,10 r${(shape as { radius: number }).radius}`,
      'fill evenodd',
      'restore',
    ]);
  });
});
