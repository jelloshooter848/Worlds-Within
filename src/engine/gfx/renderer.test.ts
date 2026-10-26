import { describe, expect, it } from 'vitest';
import { CanvasRenderer, OffsetRenderer, type Renderer } from './renderer';
import type { SpriteSheet } from './spritesheet';

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

  it('the offset renderer passes the turn through', () => {
    const seen: unknown[] = [];
    const inner = { sprite: (...a: unknown[]) => seen.push(a) } as unknown as Renderer;
    new OffsetRenderer(inner, 1, 2).sprite(sheet, 'f', 3, 4, false, true, 270);
    expect(seen[0]).toEqual([sheet, 'f', 4, 6, false, true, 270]);
  });
});
