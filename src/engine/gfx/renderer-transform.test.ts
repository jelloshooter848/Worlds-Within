import { describe, expect, it } from 'vitest';
import { CanvasRenderer, NullRenderer, OffsetRenderer, transformed, type Renderer } from './renderer';
import type { SpriteSheet } from './spritesheet';

// 0.4.73: Renderer.transform (the title's way back turns and scales the logo words about their
// centres). The canvas turns and scales; renderers without it only move the origin.

function fakeCtx() {
  const calls: string[] = [];
  const ctx = {
    canvas: { width: 256, height: 240 },
    imageSmoothingEnabled: true,
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    translate: (x: number, y: number) => calls.push(`translate ${x},${y}`),
    rotate: (r: number) => calls.push(`rotate ${r}`),
    scale: (x: number, y: number) => calls.push(`scale ${x},${y}`),
    drawImage: (...a: number[]) => calls.push(`draw ${a.slice(5).join(',')}`),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const sheet = { frames: new Map([['f', { x: 0, y: 0, w: 8, h: 4 }]]), image: {} } as unknown as SpriteSheet;

function recorder() {
  const at: string[] = [];
  const r: Renderer = Object.assign(new NullRenderer(), {
    sprite: (_s: SpriteSheet, f: string, x: number, y: number) => void at.push(`${f}@${x},${y}`),
  });
  return { r, at };
}

describe('Renderer.transform', () => {
  it('the canvas moves, turns and scales about the point, draws, then restores', () => {
    const { ctx, calls } = fakeCtx();
    const r = new CanvasRenderer(ctx);
    transformed(r, 100, 50, 0.5, 2, 0.5, (l) => l.sprite(sheet, 'f', -4, -2));
    expect(calls).toEqual([
      'save',
      'translate 100,50',
      'rotate 0.5',
      'scale 2,0.5',
      'draw -4,-2,8,4',
      'restore',
    ]);
  });

  it('no turn: no rotate call', () => {
    const { ctx, calls } = fakeCtx();
    transformed(new CanvasRenderer(ctx), 10, 20, 0, 1, 1, () => {});
    expect(calls).not.toContain('rotate 0');
  });

  it('restores even when the drawing throws', () => {
    const { ctx, calls } = fakeCtx();
    expect(() =>
      transformed(new CanvasRenderer(ctx), 0, 0, 1, 1, 1, () => {
        throw new Error('x');
      }),
    ).toThrow('x');
    expect(calls.at(-1)).toBe('restore');
  });

  it('a renderer without it (the recording ones) only moves the origin', () => {
    const { r, at } = recorder();
    transformed(r, 100, 50, 1.2, 0.1, 3, (l) => l.sprite(sheet, 'f', -4, -2));
    expect(at).toEqual(['f@96,48']);
  });

  it('through an offset renderer: the offset is added to the point', () => {
    const { r, at } = recorder();
    transformed(new OffsetRenderer(r, 5, 7), 100, 50, 0, 1, 1, (l) => l.sprite(sheet, 'f', 0, 0));
    expect(at).toEqual(['f@105,57']);
    const { ctx, calls } = fakeCtx();
    transformed(new OffsetRenderer(new CanvasRenderer(ctx), 5, 7), 100, 50, 0, 1, 1, (l) =>
      l.sprite(sheet, 'f', 0, 0),
    );
    expect(calls).toContain('translate 105,57');
    expect(calls).toContain('draw 0,0,8,4');
  });
});
