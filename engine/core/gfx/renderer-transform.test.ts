import { describe, expect, it } from 'vitest';
import { OffsetRenderer, transformed, type Renderer } from './renderer';
import type { SpriteSheet } from './spritesheet';

// 0.4.73: Renderer.transform. A renderer without it (the null and recording ones) only moves the
// origin; the canvas side is tested in engine/backends/canvas2d.

const sheet = { frames: new Map([['f', { x: 0, y: 0, w: 8, h: 4 }]]), image: {} } as unknown as SpriteSheet;

/** A renderer that draws nothing and has none of the optional calls (like the null backend). */
function noop(): Renderer {
  const none = (): void => {};
  return { clear: none, rect: none, sprite: none, text: none, debugText: none, line: none };
}

function recorder() {
  const at: string[] = [];
  const r: Renderer = Object.assign(noop(), {
    sprite: (_s: SpriteSheet, f: string, x: number, y: number) => void at.push(`${f}@${x},${y}`),
  });
  return { r, at };
}

describe('transformed without Renderer.transform', () => {
  it('a renderer without it (the recording ones) only moves the origin', () => {
    const { r, at } = recorder();
    transformed(r, 100, 50, 1.2, 0.1, 3, (l) => l.sprite(sheet, 'f', -4, -2));
    expect(at).toEqual(['f@96,48']);
  });

  it('through an offset renderer: the offset is added to the point', () => {
    const { r, at } = recorder();
    transformed(new OffsetRenderer(r, 5, 7), 100, 50, 0, 1, 1, (l) => l.sprite(sheet, 'f', 0, 0));
    expect(at).toEqual(['f@105,57']);
  });
});
