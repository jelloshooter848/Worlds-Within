import { describe, expect, it } from 'vitest';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import { CanvasRenderer } from './renderer';

/** A 2D context that records the calls a sprite makes and maps points through its transform. */
function fakeCtx() {
  const calls: string[] = [];
  // The current transform as a 2x3 matrix [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f.
  let m = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const mul = (n: number[]) => {
    const [a, b, c, d, e, f] = m as [number, number, number, number, number, number];
    const [A, B, C, D, E, F] = n as [number, number, number, number, number, number];
    m = [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
  };
  const corners: [number, number][] = [];
  const ctx = {
    canvas: { width: 256, height: 240 },
    imageSmoothingEnabled: true,
    save: () => stack.push([...m]),
    restore: () => (m = stack.pop() as number[]),
    translate: (x: number, y: number) => mul([1, 0, 0, 1, x, y]),
    rotate: (r: number) => mul([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]),
    scale: (x: number, y: number) => mul([x, 0, 0, y, 0, 0]),
    drawImage: (...a: number[]) => {
      const [dx, dy, dw, dh] = a.slice(5) as [number, number, number, number];
      calls.push('draw');
      // Where the frame's top-left texel (0,0) and its far corner land on the screen.
      for (const [x, y] of [
        [dx + 0.5, dy + 0.5],
        [dx + dw - 0.5, dy + dh - 0.5],
      ] as [number, number][]) {
        const [a0, b0, c0, d0, e0, f0] = m as [number, number, number, number, number, number];
        corners.push([
          Math.round((a0 * x + c0 * y + e0) * 2) / 2,
          Math.round((b0 * x + d0 * y + f0) * 2) / 2,
        ]);
      }
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, corners };
}

const sheet = { frames: new Map([['f', { x: 0, y: 0, w: 8, h: 4 }]]), image: {} } as unknown as SpriteSheet;

describe('CanvasRenderer quarter turns (Sophia III on walls and ceilings)', () => {
  it('turns an 8x4 frame clockwise inside the 4x8 box at (x, y)', () => {
    const cases: [0 | 90 | 180 | 270, [number, number], [number, number]][] = [
      // rotate, where texel (0,0) lands, where texel (7,3) lands (pixel centres)
      [0, [10.5, 20.5], [17.5, 23.5]],
      [90, [13.5, 20.5], [10.5, 27.5]],
      [180, [17.5, 23.5], [10.5, 20.5]],
      [270, [10.5, 27.5], [13.5, 20.5]],
    ];
    for (const [rot, first, last] of cases) {
      const { ctx, corners } = fakeCtx();
      new CanvasRenderer(ctx).sprite(sheet, 'f', 10, 20, false, false, rot);
      expect(corners, `rotate ${rot}`).toEqual([first, last]);
    }
  });

  it('flips before turning', () => {
    const { ctx, corners } = fakeCtx();
    new CanvasRenderer(ctx).sprite(sheet, 'f', 10, 20, true, false, 90);
    // Flipped, texel (0,0) is the right end; turned a quarter it lands bottom right.
    expect(corners[0]).toEqual([13.5, 27.5]);
  });
});

describe('CanvasRenderer radial gradients (Engine 0.16 part C T4)', () => {
  function gradCtx() {
    const calls: string[] = [];
    const ctx = {
      canvas: { width: 64, height: 32 },
      imageSmoothingEnabled: true,
      globalCompositeOperation: 'source-over',
      fillStyle: '' as unknown,
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      createRadialGradient: (x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) => {
        calls.push(`radial ${x0},${y0},${r0} ${x1},${y1},${r1}`);
        return { addColorStop: (at: number, c: string) => calls.push(`stop ${at} ${c}`) };
      },
      fillRect(x: number, y: number, w: number, h: number) {
        calls.push(`fill ${this.globalCompositeOperation} ${x},${y} ${w}x${h}`);
      },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }

  it("erases a light out of the light map with destination-out, inside the circle's square", () => {
    const { ctx, calls } = gradCtx();
    new CanvasRenderer(ctx).gradient({
      x: 10,
      y: 8,
      radius: 4,
      color: '#f80',
      stops: [
        { at: 0, alpha: 1 },
        { at: 1, alpha: 0 },
      ],
      mode: 'erase',
    });
    expect(calls).toEqual([
      'radial 10,8,0 10,8,4',
      'stop 0 rgba(255,136,0,1)',
      'stop 1 rgba(255,136,0,0)',
      'save',
      'fill destination-out 6,4 8x8',
      'restore',
    ]);
  });

  it("adds a glow with lighter, fills a vignette's box, and draws nothing at radius 0", () => {
    const { ctx, calls } = gradCtx();
    const r = new CanvasRenderer(ctx);
    r.gradient({ x: 0, y: 0, radius: 2, color: '#000', stops: [{ at: 0, alpha: 0.5 }], mode: 'add' });
    r.gradient({
      x: 32,
      y: 16,
      radius: 36,
      color: '#000',
      stops: [{ at: 1, alpha: 2 }],
      mode: 'normal',
      box: { x: 0, y: 0, w: 64, h: 32 },
    });
    r.gradient({ x: 0, y: 0, radius: 0, color: '#000', stops: [], mode: 'add' });
    expect(calls.filter((c) => c.startsWith('fill') || c.startsWith('stop'))).toEqual([
      'stop 0 rgba(0,0,0,0.5)',
      'fill lighter -2,-2 4x4',
      'stop 1 rgba(0,0,0,1)',
      'fill source-over 0,0 64x32',
    ]);
  });
});
