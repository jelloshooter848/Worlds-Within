import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { browserMissing, launch, listen, ROOT } from './serve';

// The fog layer and the fuller minimap on both 2D backends (Engine 0.16 part D, D3). A one-page
// Vite build (written here, not a game) draws the same fixture frames through Canvas2D's
// `SkinnedCanvasPresenter` on a 2D canvas and through `pixiDisplay` (WebGL on SwiftShader) on
// another, both at the picture's size, and compares their pixels with the parity harness's strict
// bound (`pixi-parity.test.ts`: a pixel differs when R, G or B differs by more than 8; at most
// 0.1% may). The frames: a map with units under fog (unexplored, explored, a soft edge) at zoom 2,
// with a HUD minimap showing the fog, team dots and the camera's view; and the same frame without
// `fog`, which must show no fog on either backend. Skipped where Chromium is not installed (never
// in CI).

const missing = await browserMissing();
if (missing) console.warn(`skipping the fog parity test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-fog-parity-'));
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
const skin = {
  backend: 'canvas2d',
  background: '#000000',
  kinds: {
    unit: { frames: { idle: 'none' }, fallbackColor: '#fcfcfc' },
    hall: { frames: { idle: 'none' }, fallbackColor: '#c84c0c' },
  },
  tiles: {
    '.': { frame: 'none', fallbackColor: '#00a800' },
    '~': { frame: 'none', fallbackColor: '#0058f8' },
  },
  fog: { unexplored: { color: '#000000', alpha: 1 }, explored: { color: '#101010', alpha: 0.5 }, edge: 2 },
  hud: [{
    as: 'minimap', x: 60, y: 2, w: 32, h: 16, back: '#000000', border: '#fcfcfc',
    tiles: { '.': '#00a800', '~': '#0058f8' },
    dots: [{ kind: 'unit', color: '#fcfcfc' }, { kind: 'hall', color: '#fcfcfc', size: 3 }],
    fog: true, teams: { own: '#3cbcfc', enemy: '#f83800' }, view: '#fcfc00',
  }],
};
const unit = (id, x, y, tags, kind = 'unit') => ({ id, kind, x, y, w: 8, h: 8, facing: 'down', anim: { state: 'idle', t: 0 }, tags });
const rows = ['................', '.....~~~........', '.....~~~........', '................',
  '................', '..........~~....', '................', '................'];
const fogRows = ['2222211000000000', '2222221100000000', '2222222110000000', '2222222211000000',
  '2222221110000000', '2222211100000000', '2222111000000000', '2221110000000000'];
function frame(fog) {
  return freezeFrame({
    frame: 0,
    size: screen,
    entities: [unit('a', 8, 8, ['own']), unit('b', 24, 16, ['own']), unit('h', 4, 40, ['own'], 'hall'),
      unit('e', 64, 16, ['enemy']), unit('f', 100, 40, ['enemy'])],
    map: { id: 'm', version: 0, tileSize: 8, cols: 16, rows: 8, tiles: rows },
    events: [],
    status: {},
    camera: { x: 40, y: 32, zoom: 1.5 },
    ...(fog ? { fog: { cols: 16, rows: 8, cells: fogRows } } : {}),
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
window.__fogResult = (async () => {
  const { pixiDisplay } = await import('@engine/backends/pixi');
  const c2d = document.getElementById('c2d');
  const pixiCanvas = document.getElementById('pixi');
  const display = await pixiDisplay(pixiCanvas, { screen, skin, sheet: () => null, preserveDrawingBuffer: true });
  if (typeof display === 'string') return { error: display };
  display.fit({ fit: {} });
  const out = {};
  for (const fog of [true, false]) {
    new SkinnedCanvasPresenter(c2d.getContext('2d'), skin, () => null).present(frame(fog));
    display.presenter.present(frame(fog));
    display.present();
    out[fog ? 'fog' : 'plain'] = { canvas: read(c2d), pixi: read(pixiCanvas), size: [pixiCanvas.width, pixiCanvas.height] };
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

describe.skipIf(missing !== null)(
  'the fog layer and minimap on Canvas2D and PixiJS (Engine 0.16 part D, D3)',
  () => {
    it('draws the same fogged picture on both backends, and no fog without it', async () => {
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
          () => (window as unknown as { __fogResult: Promise<unknown> }).__fogResult,
        )) as Record<'fog' | 'plain', { canvas: Rgba; pixi: Rgba; size: number[] }> & { error?: string };
        expect(result.error).toBeUndefined();
        expect(errors).toEqual([]);
        const { fog, plain } = result;
        expect(fog.size).toEqual([W, H]);
        // Within the parity harness's strict bound, with and without fog.
        expect(share(fog.canvas, fog.pixi)).toBeLessThanOrEqual(0.001);
        expect(share(plain.canvas, plain.pixi)).toBeLessThanOrEqual(0.001);
        // The fog darkens the picture: unexplored cells black, explored ones half dark, the rest as
        // without fog. The camera's top-left is world (8, 10.67) at 1.5x: picture (8, 20) is world
        // (13, 24), visible grass; picture (90, 50) is world (68, 44), unexplored.
        for (const p of [fog.canvas, fog.pixi]) {
          expect(pixel(p, 8, 20)).toEqual(pixel(plain.canvas, 8, 20));
          expect(pixel(p, 90, 50)).toEqual([0, 0, 0]);
        }
        expect(share(fog.canvas, plain.canvas, 0)).toBeGreaterThan(0.3);
        // The minimap (60, 2) 32x16 at 2 px a tile: its unexplored right side is black, its camera
        // view outlined in yellow, an own dot blue.
        for (const p of [fog.canvas, fog.pixi]) {
          expect(pixel(p, 90, 10)).toEqual([0, 0, 0]);
          expect(pixel(plain.canvas, 90, 10)).toEqual([0, 168, 0]);
          expect(pixel(p, 62, 5)).toEqual([252, 252, 0]);
          expect(pixel(p, 63, 5)).toEqual([60, 188, 252]);
        }
      } finally {
        await browser.close();
        await server.close();
      }
    }, 120_000);
  },
);
