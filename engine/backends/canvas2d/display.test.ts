import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutScreen } from '@engine/core/input/touch-layout';
import { freezeFrame, type SkinFile } from '@engine/core/present';
import { canvasDisplay } from './display';
import { CanvasRenderer } from './renderer';

/** A 2D context that records fills and drawImage boxes; any other call is a no-op. */
function fakeCtx() {
  const log: string[] = [];
  const target: Record<string, unknown> = {
    log,
    imageSmoothingEnabled: true,
    fillStyle: '',
    fillRect(x: number, y: number, w: number, h: number) {
      log.push(`fill ${String(target['fillStyle'])} ${x},${y} ${w}x${h}`);
    },
    drawImage(_img: unknown, ...box: number[]) {
      log.push(`image ${box.join(',')}`);
    },
  };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k as string] : () => undefined),
  }) as typeof target & {
    log: string[];
  };
}

function setup(cssW: number, cssH: number) {
  const back = fakeCtx();
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext() {
        return back;
      }
    },
  );
  vi.stubGlobal('window', {
    devicePixelRatio: 1,
    innerWidth: cssW,
    innerHeight: cssH,
    addEventListener() {},
  });
  const front = fakeCtx();
  const canvas = {
    clientWidth: cssW,
    clientHeight: cssH,
    width: 0,
    height: 0,
    getContext: () => front,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as HTMLCanvasElement;
  return { canvas, back, front };
}

afterEach(() => vi.unstubAllGlobals());

const SKIN: SkinFile = { backend: 'canvas2d', kinds: {} };

describe('canvasDisplay', () => {
  it('draws the scenes and the skin onto one backbuffer and copies it to the page, fitted', () => {
    const { canvas, back, front } = setup(512, 480);
    const screen = { width: 256, height: 240 };
    const display = canvasDisplay(canvas, { screen, skin: SKIN, sheet: () => null, background: '#5c94fc' });
    expect(display.renderer).toBeInstanceOf(CanvasRenderer);

    display.presenter.present(freezeFrame({ frame: 0, size: screen, entities: [], events: [], status: {} }));
    expect(back.log[0]).toMatch(/^fill #5c94fc 0,0 /);

    const layout = layoutScreen({
      width: 512,
      height: 480,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      dpr: 1,
      integerScale: false,
      touch: false,
      touchScale: 1,
      screen,
    });
    display.fit(layout);
    display.present();
    expect(front.log.at(-1)).toBe('image 0,0,512,480');
  });
});
