import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { browserMissing, launch, listen, ROOT } from './serve';

// Readable at every zoom on both 2D backends (Engine 0.16 part D, D4). A one-page Vite build
// (written here, not a game) draws the same fixture frames through Canvas2D's
// `SkinnedCanvasPresenter` and through `pixiDisplay` (WebGL on SwiftShader), both with their
// default `canvasRecolor`, and compares their pixels with the parity harness's strict bound
// (`pixi-parity.test.ts`: a pixel differs when R, G or B differs by more than 8; at most 0.1%
// may). The sprite sheet is drawn on a canvas in the page (no image file): an 8x8 unit with a
// magenta team mask, a red hue band and grey. The frames: one blue and one red unit from that one
// sprite with outlines (mask, hue and tint recolours), a plain box, and zoom-stable health bars,
// at zoom 0.5, 1 and 2 (parity at 1 and 2; at 0.5 the bar's size on both). Skipped where Chromium is not installed (never in CI).

const missing = await browserMissing();
if (missing) console.warn(`skipping the readability parity test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-readable-parity-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const W = 96;
const H = 64;

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; background: #000; }
canvas { display: block; width: ${W}px; height: ${H}px; }
</style></head>
<body><canvas id="c2d" width="${W}" height="${H}"></canvas><canvas id="pixi"></canvas>
<script type="module" src="./main.ts"></script></body></html>
`;

const MAIN = `
import { freezeFrame } from '@engine/core/present';
import { SkinnedCanvasPresenter } from '@engine/backends/canvas2d';
const screen = { width: ${W}, height: ${H} };
// The unit: a 6x6 core in an 8x8 frame; its top two rows magenta (the mask), the middle two a red
// band (the hue range), the bottom two grey.
const art = document.createElement('canvas');
art.width = 8;
art.height = 8;
const g = art.getContext('2d');
g.fillStyle = '#ff00ff'; g.fillRect(1, 1, 6, 2);
g.fillStyle = '#c03030'; g.fillRect(1, 3, 6, 2);
g.fillStyle = '#808080'; g.fillRect(1, 5, 6, 2);
const sheet = { id: 'units', image: art, frames: new Map([['unit', { x: 0, y: 0, w: 8, h: 8 }]]) };
const lookup = (id) => (id === 'units' ? sheet : null);
const skin = {
  backend: 'canvas2d',
  background: '#204020',
  sheets: { sheet: 'units' },
  kinds: {
    masked: { frames: { idle: 'unit' }, fallbackColor: '#ff0000', outline: '#000000',
      team: { colors: { blue: '#3c7cfc', red: '#f83800' }, mask: '#ff00ff' } },
    hued: { frames: { idle: 'unit' }, fallbackColor: '#ff0000', outline: 'team',
      team: { colors: { blue: '#3c7cfc', red: '#f83800' }, hue: { min: 340, max: 20 } } },
    tinted: { frames: { idle: 'unit' }, fallbackColor: '#ff0000', team: { colors: { blue: '#3c7cfc' } } },
    box: { frames: { idle: 'none' }, fallbackColor: '#808080', outline: '#fcfcfc' },
    bar: { frames: { idle: 'none' }, fallbackColor: '#00d800', screenScale: { min: 1, max: 1 } },
  },
};
const e = (id, kind, x, y, w, h, tags = []) => ({ id, kind, x, y, w, h, facing: 'down', anim: { state: 'idle', t: 0 }, tags });
function frame(zoom) {
  return freezeFrame({
    frame: zoom * 4,
    size: screen,
    entities: [
      e('a', 'masked', 30, 20, 8, 8, ['faction:blue']), e('b', 'masked', 42, 20, 8, 8, ['faction:red']),
      e('c', 'hued', 30, 34, 8, 8, ['faction:blue']), e('d', 'hued', 42, 34, 8, 8, ['faction:red']),
      e('t', 'tinted', 54, 34, 8, 8, ['faction:blue']), e('x', 'box', 54, 20, 8, 8),
      e('h', 'bar', 30, 17, 16, 2),
    ],
    events: [],
    status: {},
    camera: { x: 48, y: 32, zoom },
  });
}
function read(canvas) {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  return Array.from(ctx.getImageData(0, 0, copy.width, copy.height).data);
}
window.__readableResult = (async () => {
  const { pixiDisplay } = await import('@engine/backends/pixi');
  const c2d = document.getElementById('c2d');
  const pixiCanvas = document.getElementById('pixi');
  const display = await pixiDisplay(pixiCanvas, { screen, skin, sheet: lookup, preserveDrawingBuffer: true });
  if (typeof display === 'string') return { error: display };
  display.fit({ fit: {} });
  const out = {};
  const canvasPresenter = new SkinnedCanvasPresenter(c2d.getContext('2d'), skin, lookup);
  for (const zoom of [0.5, 1, 2]) {
    canvasPresenter.present(frame(zoom));
    display.presenter.present(frame(zoom));
    display.present();
    out[zoom] = { canvas: read(c2d), pixi: read(pixiCanvas), size: [pixiCanvas.width, pixiCanvas.height] };
  }
  return out;
})();
`;

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.map': 'application/json',
};

async function serve(): Promise<{ url: string; close(): Promise<void> }> {
  const src = join(temp, 'src');
  const out = join(temp, 'dist');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'index.html'), PAGE);
  writeFileSync(join(src, 'main.ts'), MAIN);
  const vite = await import('vite');
  await vite.build({
    configFile: false,
    root: src,
    base: '/',
    logLevel: 'silent',
    resolve: { alias: { '@engine': join(ROOT, 'engine') } },
    build: { outDir: out, emptyOutDir: true, target: 'es2022' },
  });
  const http = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const file = normalize(join(out, path === '/' ? 'index.html' : path));
    if (!file.startsWith(out) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  const url = await listen(http);
  return { url: `${url}/`, close: () => new Promise<void>((done) => http.close(() => done())) };
}

type Rgba = number[];
const pixel = (p: Rgba, x: number, y: number) => p.slice((y * W + x) * 4, (y * W + x) * 4 + 3);

/** The share of pixels whose R, G or B differs by more than `threshold`. */
function share(a: Rgba, b: Rgba, threshold = 8): number {
  let differing = 0;
  for (let i = 0; i < W * H; i++)
    for (let c = 0; c < 3; c++)
      if (Math.abs(a[i * 4 + c]! - b[i * 4 + c]!) > threshold) {
        differing++;
        break;
      }
  return differing / (W * H);
}

/** The bounding box [x0, y0, x1, y1] (inclusive) of the pixels of one colour. */
function bounds(p: Rgba, rgb: number[]): number[] | null {
  let box: number[] | null = null;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const q = pixel(p, x, y);
      if (q.some((v, i) => Math.abs(v - rgb[i]!) > 8)) continue;
      box = box
        ? [Math.min(box[0]!, x), Math.min(box[1]!, y), Math.max(box[2]!, x), Math.max(box[3]!, y)]
        : [x, y, x, y];
    }
  return box;
}

describe.skipIf(missing !== null)(
  'outlines, team colours and zoom-stable bars on Canvas2D and PixiJS (Engine 0.16 part D, D4)',
  () => {
    it('draws the same readable picture on both backends at zoom 0.5, 1 and 2', async () => {
      const server = await serve();
      const browser = await launch();
      try {
        const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => {
          if (m.type() === 'error') errors.push(m.text());
        });
        await page.goto(server.url);
        const result = (await page.evaluate(
          () => (window as unknown as { __readableResult: Promise<unknown> }).__readableResult,
        )) as Record<string, { canvas: Rgba; pixi: Rgba; size: number[] }> & { error?: string };
        expect(result.error).toBeUndefined();
        expect(errors).toEqual([]);
        for (const zoom of ['0.5', '1', '2']) {
          const shot = result[zoom]!;
          expect(shot.size).toEqual([W, H]);
          // Sprites shrunk to half size sample their texels differently on the two backends (nearest
          // neighbour from a canvas's pixel corner, from a texel centre on the GPU), as any sprite
          // does at zoom 0.5; at 1 and 2 the pictures agree within the strict bound.
          if (zoom !== '0.5') expect(share(shot.canvas, shot.pixi)).toBeLessThanOrEqual(0.001);
          // The zoom-stable bar is 16x2 picture px at every zoom, on both backends.
          for (const p of [shot.canvas, shot.pixi]) {
            const b = bounds(p, [0, 216, 0])!;
            expect([b[2]! - b[0]! + 1, b[3]! - b[1]! + 1]).toEqual([16, 2]);
          }
        }
        // At zoom 1 the camera's top-left is world (0, 0): the blue masked unit's mask rows are
        // blue, the red one's red, from one sprite; each outlined in black; the hued units' band
        // in their team colours, outlined in them; the tinted unit's grey row multiplied blue.
        for (const p of [result['1']!.canvas, result['1']!.pixi]) {
          expect(pixel(p, 32, 21)).toEqual([60, 124, 252]);
          expect(pixel(p, 44, 21)).toEqual([248, 56, 0]);
          expect(pixel(p, 32, 26)).toEqual([128, 128, 128]);
          expect(pixel(p, 30, 22)).toEqual([0, 0, 0]);
          expect(pixel(p, 29, 22)).toEqual([32, 64, 32]);
          expect(pixel(p, 30, 36)).toEqual([60, 124, 252]);
          expect(pixel(p, 42, 36)).toEqual([248, 56, 0]);
          expect(pixel(p, 56, 39)).toEqual([30, 62, 126]);
          expect(pixel(p, 53, 19)).toEqual([252, 252, 252]);
        }
      } finally {
        await browser.close();
        await server.close();
      }
    }, 120_000);
  },
);
