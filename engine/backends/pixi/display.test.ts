import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Container, Sprite } from 'pixi.js';
import { Graphics, RenderTexture } from 'pixi.js';
import { transitionAt } from '@engine/core/fx';
import { layoutScreen } from '@engine/core/input/touch-layout';
import { freezeFrame, type SkinFile } from '@engine/core/present';
import { buildFont, type FontLookup } from '@engine/core/ui';
import { pixiDisplayOn, type DisplayGpu } from './display';
import { PixiPresenter } from './presenter';
import { PixiRenderer } from './renderer';

// The PixiJS display (Engine 0.16 T13b-3) on a recording stand-in for the PixiJS renderer, so
// its passes, letterbox and pointer maths are checked in Node; the real WebGL start is the
// browser test's (tests/browser/pixi-display.test.ts).

function setup(cssW: number, cssH: number) {
  vi.stubGlobal('window', {
    devicePixelRatio: 1,
    innerWidth: cssW,
    innerHeight: cssH,
    addEventListener() {},
  });
  const passes: { container: Container; target: RenderTexture | undefined }[] = [];
  const sizes: string[] = [];
  const gpu: DisplayGpu = {
    render: (o) => void passes.push({ container: o.container, target: o.target }),
    resize: (w, h) => void sizes.push(`${w}x${h}`),
  };
  const canvas = {
    clientWidth: cssW,
    clientHeight: cssH,
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
  } as unknown as HTMLCanvasElement;
  return { gpu, canvas, passes, sizes };
}

afterEach(() => vi.unstubAllGlobals());

const SKIN: SkinFile = { backend: 'canvas2d', kinds: {} };
const screen = { width: 256, height: 240 };
const layout = (width: number, height: number) =>
  layoutScreen({
    width,
    height,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    dpr: 1,
    integerScale: false,
    touch: false,
    touchScale: 1,
    screen,
  });

describe('pixiDisplayOn', () => {
  it('renders the surfaces, then the picture into a backbuffer, then the backbuffer letterboxed', () => {
    const { gpu, canvas, passes, sizes } = setup(512, 600);
    const display = pixiDisplayOn(gpu, canvas, {
      screen,
      skin: SKIN,
      sheet: () => null,
      background: '#5c94fc',
    });
    expect(display.renderer).toBeInstanceOf(PixiRenderer);
    const r = display.renderer as PixiRenderer;
    display.fit(layout(512, 600));
    expect(sizes.at(-1)).toBe('512x600');
    display.presenter.present(
      freezeFrame({
        frame: 0,
        size: screen,
        map: { id: 'm', version: 0, tileSize: 16, cols: 2, rows: 2, tiles: ['..', '..'] },
        entities: [],
        events: [],
        status: {},
      }),
    );
    expect((r.stage.children[0] as Sprite).tint).toBe(0x5c94fc);
    display.present();
    // The map surface, then the picture (the stage and the transition cover), then the page.
    expect(passes).toHaveLength(3);
    expect(passes[0]!.target).toBeInstanceOf(RenderTexture);
    expect(passes[0]!.target!.frame.width).toBe(32);
    const picture = passes[1]!;
    expect(picture.container.children[0]).toBe(r.stage);
    expect(picture.container.children[1]).toBeInstanceOf(Graphics);
    expect([picture.target!.frame.width, picture.target!.frame.height]).toEqual([256, 240]);
    const page = passes[2]!;
    expect(page.target).toBeUndefined();
    const shown = page.container.children[0] as Sprite;
    expect(shown.texture).toBe(picture.target);
    // 256x240 stretched to 512 wide: 512x480, centred in 600 high.
    expect([shown.x, shown.y, shown.width, shown.height]).toEqual([0, 60, 512, 480]);
    // The surface is rendered once; the next present renders the picture and page only.
    display.present();
    expect(passes).toHaveLength(5);
  });

  it('maps client points to picture pixels and back through the letterbox', () => {
    const { gpu, canvas } = setup(512, 600);
    const display = pixiDisplayOn(gpu, canvas, { screen, skin: SKIN, sheet: () => null });
    display.fit(layout(512, 600));
    expect(display.toScreen!(10 + 256, 20 + 60 + 240)).toEqual({ x: 128, y: 120 });
    expect(display.toClient!(128, 120)).toEqual({ x: 266, y: 320 });
  });

  it('draws the transition over the picture and gives one UI painter and the effect settings', () => {
    const { gpu, canvas, passes } = setup(256, 240);
    const FONT = buildFont('f', { cell: { w: 2, h: 2 }, baseline: 2, glyphs: { L: { rows: ['#.', '##'] } } });
    const fonts: FontLookup = (id) => (id === 'f' ? FONT : null);
    const display = pixiDisplayOn(gpu, canvas, { screen, skin: SKIN, sheet: () => null, fonts });
    display.transition!(transitionAt({ kind: 'fade', ticks: 4, color: '#102030' }, 2));
    display.present();
    const cover = passes.at(-2)!.container.children[1] as Graphics;
    expect(cover.context.instructions).toHaveLength(1);
    display.transition!(null);
    display.present();
    expect(cover.context.instructions).toHaveLength(0);
    const painter = display.uiPainter!();
    expect(display.uiPainter!()).toBe(painter);
    painter.glyph({ kind: 'glyph', font: 'f', ch: 'L', x: 1, y: 1, color: '#f00' });
    passes.length = 0;
    display.present();
    // The glyph strip's surface is rendered before the picture.
    expect(passes.map((p) => p.target?.frame.width ?? 'page')).toEqual([3, 256, 'page']);
    expect(() => display.effectSettings!({ shakeScale: 0, reduceFlashing: true })).not.toThrow();
  });

  it("gives the game's own presenter as main, with the seed and particle cap asked for", () => {
    const { gpu, canvas } = setup(256, 240);
    const display = pixiDisplayOn(gpu, canvas, {
      screen,
      skin: SKIN,
      sheet: () => null,
      seed: 7,
      maxParticles: 6000,
    });
    expect(display.main).toBeInstanceOf(PixiPresenter);
    expect(display.main.particleCount).toBe(0);
    const opts = (display.main as unknown as { opts: { seed?: number; maxParticles?: number } }).opts;
    expect(opts).toMatchObject({ seed: 7, maxParticles: 6000 });
  });
});
