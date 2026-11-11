import { describe, expect, it } from 'vitest';
import type { Renderer } from '@engine/core/gfx/renderer';
import { type PresentFrame, type SkinFile } from '@engine/core/present';
import { SkinnedCanvasPresenter } from './presenter';
import { CanvasRenderer } from './renderer';

// Fog of war on Canvas2D (Engine 0.16 part D, D3): the core walk's fog layer drawn through a
// `CanvasRenderer` onto a small software 2D context (fill rectangles with `globalAlpha`, source
// over, no anti-aliasing), so the test reads the picture's pixels. A frame without `fog` draws the
// same calls as before (the recorder below).

/** A 2D context that only fills rectangles, into RGB pixels (0-255), with `globalAlpha`. */
function pixelCtx(width: number, height: number) {
  const px = new Float64Array(width * height * 3);
  const stack: number[] = [];
  const ctx = {
    canvas: { width, height },
    imageSmoothingEnabled: false,
    fillStyle: '#000000',
    globalAlpha: 1,
    save() {
      stack.push(this.globalAlpha);
    },
    restore() {
      this.globalAlpha = stack.pop() ?? 1;
    },
    fillRect(x: number, y: number, w: number, h: number) {
      const hex = this.fillStyle.slice(1);
      const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
      const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
      const a = this.globalAlpha;
      for (let py = Math.max(0, y); py < Math.min(height, y + h); py++)
        for (let pxX = Math.max(0, x); pxX < Math.min(width, x + w); pxX++)
          for (let c = 0; c < 3; c++) {
            const i = (py * width + pxX) * 3 + c;
            px[i] = px[i]! * (1 - a) + rgb[c]! * a;
          }
    },
  };
  const at = (x: number, y: number) => [0, 1, 2].map((c) => Math.round(px[(y * width + x) * 3 + c]!));
  return { ctx: ctx as unknown as CanvasRenderingContext2D, at };
}

/** A renderer that records `rect` and `alpha` calls as text. */
function recorder() {
  const calls: string[] = [];
  const r: Renderer = {
    clear: (c) => calls.push(`clear ${c}`),
    rect: (x, y, w, h, c) => calls.push(`rect ${x},${y} ${w}x${h} ${c}`),
    sprite: () => {},
    text: () => {},
    debugText: () => {},
    line: () => {},
    alpha: (a, draw) => {
      calls.push(`alpha ${a}`);
      draw();
      calls.push('end');
    },
  };
  return { r, calls };
}

/** Grass tiles and a white unit; explored cells half dark. */
const SKIN: SkinFile = {
  backend: 'canvas2d',
  background: '#000000',
  kinds: { unit: { frames: { idle: 'none' }, fallbackColor: '#ffffff' } },
  tiles: { '.': { frame: 'none', fallbackColor: '#00c000' } },
  fog: { explored: { color: '#000000', alpha: 0.5 } },
};

/** A 4x2 map of 8 px tiles, a unit on tile (1, 0), and the fog if given. */
function frame(fog?: PresentFrame['fog']): PresentFrame {
  return {
    frame: 0,
    size: { width: 32, height: 16 },
    entities: [
      {
        id: 'u',
        kind: 'unit',
        x: 8,
        y: 0,
        w: 8,
        h: 8,
        facing: 'down',
        anim: { state: 'idle', t: 0 },
        tags: [],
      },
    ],
    map: { id: 'm', version: 0, tileSize: 8, cols: 4, rows: 2, tiles: ['....', '....'] },
    events: [],
    status: {},
    ...(fog !== undefined && { fog }),
  };
}

describe('the fog layer on Canvas2D (Engine 0.16 part D, D3)', () => {
  it('hides unexplored cells, darkens explored ones and leaves visible ones, over the entities', () => {
    const { ctx, at } = pixelCtx(32, 16);
    new SkinnedCanvasPresenter(new CanvasRenderer(ctx), SKIN, () => null).present(
      frame({ cols: 4, rows: 2, cells: ['0122', '2222'] }),
    );
    expect(at(2, 2)).toEqual([0, 0, 0]); // unexplored grass: hidden
    expect(at(10, 2)).toEqual([128, 128, 128]); // explored, over the white unit: half dark
    expect(at(18, 2)).toEqual([0, 192, 0]); // visible grass
    expect(at(26, 12)).toEqual([0, 192, 0]);
  });

  it('draws a frame without fog exactly as before, and an all-visible fog as nothing', () => {
    const plain = recorder();
    new SkinnedCanvasPresenter(plain.r, SKIN, () => null).present(frame());
    const clear = recorder();
    new SkinnedCanvasPresenter(clear.r, SKIN, () => null).present(
      frame({ cols: 4, rows: 2, cells: ['2222', '2222'] }),
    );
    expect(clear.calls).toEqual(plain.calls);
    expect(plain.calls.some((c) => c.startsWith('alpha'))).toBe(false);
  });

  it('places the fog with the camera and zoom, cut to the picture', () => {
    const { r, calls } = recorder();
    const f = { ...frame({ cols: 4, rows: 2, cells: ['1000', '2222'] }), camera: { x: 16, y: 8, zoom: 2 } };
    new SkinnedCanvasPresenter(r, SKIN, () => null).present(f);
    // The picture shows world (8, 4) to (24, 12) at 2x: the explored tile 0 is off the left; the
    // unexplored run (world 8 to 32) is cut to the picture's top half, opaque, after the unit.
    expect(calls.slice(calls.indexOf('rect 0,-8 16x16 #ffffff') + 1)).toEqual(['rect 0,0 32x8 #000000']);
  });
});
