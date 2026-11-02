import { describe, expect, it } from 'vitest';
import { transformed, translucent, clipped, type Renderer } from '@engine/core/gfx/renderer';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import { freezeFrame, type PresentFrame, type Presenter } from '@engine/core/present';
import { NullPresenter, NullRenderer } from './index';

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

describe('NullPresenter', () => {
  const frame = (): PresentFrame => ({
    frame: 3,
    size: { width: 256, height: 240 },
    entities: [
      {
        id: 'a',
        kind: 'hero',
        x: 0,
        y: 0,
        w: 16,
        h: 16,
        facing: 'down',
        anim: { state: 'idle', t: 0 },
        tags: [],
      },
    ],
    events: [{ type: 'hit' }],
    status: { health: 3 },
  });

  it('takes frames, draws nothing and keeps the last one', () => {
    const p: Presenter = new NullPresenter();
    const f = freezeFrame(frame());
    expect(() => p.present(f)).not.toThrow();
    expect((p as NullPresenter).frames).toBe(1);
    expect((p as NullPresenter).last).toBe(f);
  });

  it('can freeze frames so later changes throw', () => {
    const f = frame();
    new NullPresenter({ freeze: true }).present(f);
    expect(Object.isFrozen(f.entities[0])).toBe(true);
    expect(() => {
      f.status['health'] = 0;
    }).toThrow(TypeError);
  });

  it('can validate frames, naming the bad field', () => {
    const bad = { ...frame(), frame: -1 };
    expect(() => new NullPresenter({ validate: true }).present(bad)).toThrow(/frame/);
    expect(() => new NullPresenter({ validate: true }).present(frame())).not.toThrow();
  });
});
