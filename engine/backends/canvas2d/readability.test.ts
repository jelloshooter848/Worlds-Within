import { describe, expect, it } from 'vitest';
import type { ImageRecolor } from '@engine/core/draw';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import type { PresentEntity, PresentFrame, SkinFile } from '@engine/core/present';
import { SkinnedCanvasPresenter } from './presenter';
import { CanvasRenderer } from './renderer';

// Readable at every zoom on Canvas2D (Engine 0.16 part D, D4): a kind's `outline`, `team` colour
// and `screenScale` drawn by the core walk through a `CanvasRenderer` onto a small software 2D
// context (fills, `drawImage` nearest neighbour with translate and scale, source-over alpha), so
// the tests read the picture's pixels. Sheet images here are plain RGBA buffers and the recolour
// copies them (what `canvasRecolor` does through a canvas in the browser).

interface FakeImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** A 2D context that fills rectangles and draws `FakeImage`s, into RGB pixels. */
function pixelCtx(width: number, height: number) {
  const px = new Float64Array(width * height * 3);
  let t = { tx: 0, ty: 0, sx: 1, sy: 1 };
  const stack: { t: typeof t; a: number }[] = [];
  const blend = (x: number, y: number, c: number[], a: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    for (let k = 0; k < 3; k++) {
      const i = (y * width + x) * 3 + k;
      px[i] = px[i]! * (1 - a) + c[k]! * a;
    }
  };
  const ctx = {
    canvas: { width, height },
    imageSmoothingEnabled: false,
    fillStyle: '#000000',
    globalAlpha: 1,
    save() {
      stack.push({ t: { ...t }, a: this.globalAlpha });
    },
    restore() {
      const s = stack.pop();
      if (s) {
        t = s.t;
        this.globalAlpha = s.a;
      }
    },
    translate(x: number, y: number) {
      t = { ...t, tx: t.tx + x * t.sx, ty: t.ty + y * t.sy };
    },
    scale(x: number, y: number) {
      t = { ...t, sx: t.sx * x, sy: t.sy * y };
    },
    fillRect(x: number, y: number, w: number, h: number) {
      const c = rgb(this.fillStyle);
      for (let py = y; py < y + h; py++)
        for (let qx = x; qx < x + w; qx++) blend(qx, py, c, this.globalAlpha);
    },
    drawImage(
      img: FakeImage,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ) {
      for (let j = 0; j < dh; j++)
        for (let i = 0; i < dw; i++) {
          const ix = sx + Math.floor((i * sw) / dw);
          const iy = sy + Math.floor((j * sh) / dh);
          const o = (iy * img.width + ix) * 4;
          const a = (img.data[o + 3]! / 255) * this.globalAlpha;
          if (a === 0) continue;
          // The pixel's centre through the transform (flips mirror it).
          const X = Math.floor(t.tx + (dx + i + 0.5) * t.sx);
          const Y = Math.floor(t.ty + (dy + j + 0.5) * t.sy);
          blend(X, Y, [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!], a);
        }
    },
  };
  const at = (x: number, y: number) => [0, 1, 2].map((c) => Math.round(px[(y * width + x) * 3 + c]!));
  return { ctx: ctx as unknown as CanvasRenderingContext2D, at };
}

/** A copy of the image with its pixels edited (the browser's `canvasRecolor` on a buffer). */
const bufferRecolor: ImageRecolor = (image, edit) => {
  const img = image as unknown as FakeImage;
  const data = new Uint8ClampedArray(img.data);
  edit(data, img.width, img.height);
  return { width: img.width, height: img.height, data } as unknown as CanvasImageSource;
};

/**
 * A 4x4 sprite, transparent round a 2x2 core: its top row magenta (the team mask), its bottom row
 * grey.
 */
function unitSheet(): SpriteSheet {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  const put = (x: number, y: number, c: number[]) => data.set([...c, 255], (y * 4 + x) * 4);
  put(1, 1, [255, 0, 255]);
  put(2, 1, [255, 0, 255]);
  put(1, 2, [128, 128, 128]);
  put(2, 2, [128, 128, 128]);
  const image = { width: 4, height: 4, data } as unknown as CanvasImageSource;
  return { id: 'units', image, frames: new Map([['unit', { x: 0, y: 0, w: 4, h: 4 }]]) };
}

function entity(
  id: string,
  kind: string,
  x: number,
  y: number,
  w: number,
  h: number,
  tags: string[] = [],
): PresentEntity {
  return { id, kind, x, y, w, h, facing: 'down', anim: { state: 'idle', t: 0 }, tags };
}

function frame(entities: PresentEntity[], camera?: PresentFrame['camera']): PresentFrame {
  return {
    frame: 0,
    size: { width: 12, height: 12 },
    entities,
    events: [],
    status: {},
    ...(camera !== undefined && { camera }),
  };
}

const UNIT_SKIN: SkinFile = {
  backend: 'canvas2d',
  background: '#000000',
  sheets: { sheet: 'units' },
  kinds: {
    unit: {
      frames: { idle: 'unit' },
      fallbackColor: '#ff0000',
      outline: '#ffff00',
      team: { colors: { blue: '#0000ff', red: '#ff0000' }, mask: '#ff00ff' },
    },
    tinted: {
      frames: { idle: 'unit' },
      fallbackColor: '#ff0000',
      outline: 'team',
      team: { colors: { blue: '#0000ff' } },
    },
    box: {
      frames: { idle: 'none' },
      fallbackColor: '#808080',
      outline: '#ffffff',
      team: { colors: { red: '#ff0000' } },
    },
  },
};

describe('outlines and team colours on Canvas2D (Engine 0.16 part D, D4)', () => {
  it("outlines the sprite's opaque pixels and recolours its mask in the team colour", () => {
    const sheet = unitSheet();
    const { ctx, at } = pixelCtx(12, 12);
    new SkinnedCanvasPresenter(new CanvasRenderer(ctx), UNIT_SKIN, () => sheet, {
      recolor: bufferRecolor,
    }).present(frame([entity('u', 'unit', 4, 4, 4, 4, ['faction:blue'])]));
    // The core: the mask row blue, the grey row as it was.
    expect(at(5, 5)).toEqual([0, 0, 255]);
    expect(at(6, 5)).toEqual([0, 0, 255]);
    expect(at(5, 6)).toEqual([128, 128, 128]);
    // One pixel of outline on each side of the core, none at the corners or further out.
    for (const [x, y] of [
      [4, 5],
      [4, 6],
      [7, 5],
      [7, 6],
      [5, 4],
      [6, 4],
      [5, 7],
      [6, 7],
    ] as const)
      expect(at(x, y)).toEqual([255, 255, 0]);
    expect(at(4, 4)).toEqual([0, 0, 0]);
    expect(at(3, 5)).toEqual([0, 0, 0]);
  });

  it('serves both sides from one sprite, and draws it as it is without a team tag', () => {
    const sheet = unitSheet();
    const { ctx, at } = pixelCtx(12, 12);
    new SkinnedCanvasPresenter(new CanvasRenderer(ctx), UNIT_SKIN, () => sheet, {
      recolor: bufferRecolor,
    }).present(
      frame([entity('r', 'unit', 0, 0, 4, 4, ['faction:red']), entity('n', 'unit', 6, 6, 4, 4, [])]),
    );
    expect(at(1, 1)).toEqual([255, 0, 0]);
    expect(at(7, 7)).toEqual([255, 0, 255]);
  });

  it('tints the whole sprite without a mask or hue, and outlines it in the team colour', () => {
    const sheet = unitSheet();
    const { ctx, at } = pixelCtx(12, 12);
    new SkinnedCanvasPresenter(new CanvasRenderer(ctx), UNIT_SKIN, () => sheet, {
      recolor: bufferRecolor,
    }).present(frame([entity('t', 'tinted', 4, 4, 4, 4, ['faction:blue'])]));
    expect(at(5, 5)).toEqual([0, 0, 255]); // magenta x blue
    expect(at(5, 6)).toEqual([0, 0, 128]); // grey x blue
    expect(at(4, 5)).toEqual([0, 0, 255]); // the outline, in the team colour
  });

  it('recolours each sheet once per colour, however many frames and entities', () => {
    const sheet = unitSheet();
    let made = 0;
    const counting: ImageRecolor = (image, edit) => {
      made++;
      return bufferRecolor(image, edit);
    };
    const { ctx } = pixelCtx(12, 12);
    const p = new SkinnedCanvasPresenter(new CanvasRenderer(ctx), UNIT_SKIN, () => sheet, {
      recolor: counting,
    });
    const f = frame([
      entity('a', 'unit', 0, 0, 4, 4, ['faction:blue']),
      entity('b', 'unit', 6, 0, 4, 4, ['faction:blue']),
    ]);
    for (let i = 0; i < 5; i++) p.present({ ...f, frame: i });
    expect(made).toBe(2); // the blue body and the yellow silhouette
  });

  it('outlines a box one pixel larger and fills it in the team colour', () => {
    const { ctx, at } = pixelCtx(12, 12);
    new SkinnedCanvasPresenter(new CanvasRenderer(ctx), UNIT_SKIN, () => null).present(
      frame([entity('b', 'box', 4, 4, 4, 4, ['faction:red'])]),
    );
    expect(at(3, 3)).toEqual([255, 255, 255]);
    expect(at(8, 8)).toEqual([255, 255, 255]);
    expect(at(4, 4)).toEqual([255, 0, 0]);
    expect(at(2, 2)).toEqual([0, 0, 0]);
  });

  it('draws sprites as before where nothing can recolour them (no canvas, headless)', () => {
    const sheet = unitSheet();
    const { ctx, at } = pixelCtx(12, 12);
    new SkinnedCanvasPresenter(new CanvasRenderer(ctx), UNIT_SKIN, () => sheet, {
      recolor: () => null,
    }).present(frame([entity('u', 'unit', 4, 4, 4, 4, ['faction:blue'])]));
    expect(at(5, 5)).toEqual([255, 0, 255]);
    expect(at(4, 5)).toEqual([0, 0, 0]);
  });
});

/** A renderer that records rects and sprites as text. */
function recorder() {
  const calls: string[] = [];
  const r: Renderer = {
    clear: () => {},
    rect: (x, y, w, h, c) => calls.push(`rect ${x},${y} ${w}x${h} ${c}`),
    sprite: (_sheet, f, x, y, _fx, _fy, _rot, scale = 1) => calls.push(`sprite ${f} ${x},${y} x${scale}`),
    text: () => {},
    debugText: () => {},
    line: () => {},
  };
  return { r, calls };
}

/** Parses a recorded rect: [x, y, w, h]. */
function box(call: string): [number, number, number, number] {
  const m = /^rect (-?\d+),(-?\d+) (\d+)x(\d+)/.exec(call)!;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

const BAR_SKIN: SkinFile = {
  backend: 'canvas2d',
  background: '#000000',
  kinds: {
    plain: { frames: { idle: 'none' }, fallbackColor: '#111111' },
    stable: { frames: { idle: 'none' }, fallbackColor: '#222222', screenScale: { min: 1, max: 1 } },
    floor: { frames: { idle: 'none' }, fallbackColor: '#333333', screenScale: { min: 1 } },
    ring: {
      frames: { idle: 'none' },
      fallbackColor: '#444444',
      screenScale: { min: 1, max: 1, anchor: 'bottom' },
    },
  },
};

describe('zoom-stable looks (Engine 0.16 part D, D4)', () => {
  // A 16x2 health bar at world (40, 30), seen at zoom 0.5, 1 and 2 with the camera on (48, 31).
  const bars = ['plain', 'stable', 'floor', 'ring'].map((k) => entity(k, k, 40, 30, 16, 2));
  const drawn = (zoom: number) => {
    const { r, calls } = recorder();
    new SkinnedCanvasPresenter(r, BAR_SKIN, () => null, { size: { width: 64, height: 48 } }).present({
      ...frame(bars, { x: 48, y: 31, zoom }),
      size: { width: 64, height: 48 },
    });
    const byColor = (c: string) => box(calls.find((s) => s.endsWith(c))!);
    return {
      plain: byColor('#111111'),
      stable: byColor('#222222'),
      floor: byColor('#333333'),
      ring: byColor('#444444'),
    };
  };

  it.each([0.5, 1, 2])('keeps a zoom-stable bar its configured size at zoom %s', (zoom) => {
    const d = drawn(zoom);
    expect(d.plain.slice(2)).toEqual([Math.round(16 * zoom), Math.max(1, Math.round(2 * zoom))]);
    // { min: 1, max: 1 }: 16x2 picture px at every zoom.
    expect(d.stable.slice(2)).toEqual([16, 2]);
    // { min: 1 }: never smaller than 16x2, but grows with a zoom in.
    expect(d.floor.slice(2)).toEqual(zoom < 1 ? [16, 2] : [16 * zoom, 2 * zoom]);
    // Centred where the plain bar's centre is (to a pixel).
    const centre = ([x, y, w, h]: number[]) => [x! + w! / 2, y! + h! / 2];
    const [px, py] = centre(d.plain);
    const [sx, sy] = centre(d.stable);
    expect(Math.abs(sx! - px!)).toBeLessThanOrEqual(1);
    expect(Math.abs(sy! - py!)).toBeLessThanOrEqual(1);
    // A bottom-anchored ring keeps its bottom edge on the plain one's.
    expect(Math.abs(d.ring[1] + d.ring[3] - (d.plain[1] + d.plain[3]))).toBeLessThanOrEqual(1);
  });

  it('draws a zoom-stable sprite at scale 1 whatever the zoom', () => {
    const sheet = unitSheet();
    const skin: SkinFile = {
      backend: 'canvas2d',
      sheets: { sheet: 'units' },
      kinds: {
        ring: { frames: { idle: 'unit' }, fallbackColor: '#ff0000', screenScale: { min: 1, max: 1 } },
      },
    };
    for (const zoom of [0.5, 1, 2]) {
      const { r, calls } = recorder();
      new SkinnedCanvasPresenter(r, skin, () => sheet).present(
        frame([entity('r', 'ring', 4, 4, 4, 4)], { x: 6, y: 6, zoom }),
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatch(/ x1$/);
    }
  });
});
