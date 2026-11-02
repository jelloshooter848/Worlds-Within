import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCREEN } from '@engine/core/gfx/screen';
import { Viewport } from './viewport';

/** A 2D context that records drawImage calls; everything else is a no-op. */
function fakeCtx() {
  const draws: number[][] = [];
  return {
    draws,
    imageSmoothingEnabled: true,
    fillStyle: '',
    fillRect() {},
    drawImage(_img: unknown, ...box: number[]) {
      draws.push(box);
    },
  };
}

class FakeOffscreen {
  readonly ctx = fakeCtx();
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext() {
    return this.ctx;
  }
}

function setup(cssW: number, cssH: number, dpr = 1) {
  vi.stubGlobal('OffscreenCanvas', FakeOffscreen);
  vi.stubGlobal('window', {
    devicePixelRatio: dpr,
    innerWidth: cssW,
    innerHeight: cssH,
    addEventListener() {},
  });
  const ctx = fakeCtx();
  const display = {
    clientWidth: cssW,
    clientHeight: cssH,
    width: 0,
    height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as HTMLCanvasElement;
  return { display, ctx };
}

afterEach(() => vi.unstubAllGlobals());

describe('Viewport', () => {
  it('makes a 256x240 backbuffer when no size is given', () => {
    const { display } = setup(1280, 800);
    const v = new Viewport(display, { integerScale: true });
    expect(v.size).toEqual(DEFAULT_SCREEN);
    expect(v.back).toMatchObject({ width: 256, height: 240 });
    expect(v.scale).toBe(3);
  });

  it('uses the size it is given: 320x180 at a whole-number scale, letterboxed', () => {
    const { display, ctx } = setup(1280, 800);
    const v = new Viewport(display, { integerScale: true }, { width: 320, height: 180 });
    expect(v.back).toMatchObject({ width: 320, height: 180 });
    expect(v.scale).toBe(4);
    expect([v.offsetX, v.offsetY]).toEqual([0, 40]);
    v.present();
    expect(ctx.draws).toEqual([[0, 40, 1280, 720]]);
    // A client point maps back into the 320x180 picture.
    expect(v.toScreen(1280 - 2, 800 - 40 - 2)).toEqual({ x: 319.5, y: 179.5 });
  });

  it('honours the device pixel ratio with a non-default size', () => {
    const { display } = setup(393, 759, 3);
    const v = new Viewport(display, { integerScale: true }, { width: 320, height: 180 });
    expect(display.width).toBe(1179);
    expect(v.scale).toBe(3);
    expect(v.offsetX).toBe(Math.floor((1179 - 960) / 2));
  });
});
