import { describe, expect, it } from 'vitest';
import { transformed, translucent, clipped, type Renderer } from '@engine/core/gfx/renderer';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import { NullRenderer } from './index';

const sheet = { frames: new Map([['f', { x: 0, y: 0, w: 8, h: 4 }]]), image: {} } as unknown as SpriteSheet;

describe('NullRenderer', () => {
  it('takes every call and draws nothing, without the optional ones', () => {
    const r: Renderer = new NullRenderer();
    expect(() => {
      r.clear('#000');
      r.rect(0, 0, 1, 1, '#fff');
      r.sprite(sheet, 'f', 0, 0, true, false, 90, 2);
      r.text(sheet, 'f', 0, 0);
      r.debugText('x', 0, 0);
      r.line(0, 0, 1, 1, '#fff');
    }).not.toThrow();
    expect(r.clip ?? r.alpha ?? r.transform).toBeUndefined();
  });

  it('the core helpers still run the drawing through it', () => {
    const r = new NullRenderer();
    let runs = 0;
    clipped(r, 0, 0, 8, 8, () => runs++);
    translucent(r, 0.5, () => runs++);
    transformed(r, 1, 2, 0.5, 1, 1, () => runs++);
    expect(runs).toBe(3);
  });
});
