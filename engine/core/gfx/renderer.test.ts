import { describe, expect, it } from 'vitest';
import { OffsetRenderer, type Renderer } from './renderer';
import type { SpriteSheet } from './spritesheet';

const sheet = { frames: new Map([['f', { x: 0, y: 0, w: 8, h: 4 }]]), image: {} } as unknown as SpriteSheet;

describe('OffsetRenderer', () => {
  it('the offset renderer passes the turn through', () => {
    const seen: unknown[] = [];
    const inner = { sprite: (...a: unknown[]) => seen.push(a) } as unknown as Renderer;
    new OffsetRenderer(inner, 1, 2).sprite(sheet, 'f', 3, 4, false, true, 270);
    expect(seen[0]).toEqual([sheet, 'f', 4, 6, false, true, 270]);
  });
});
