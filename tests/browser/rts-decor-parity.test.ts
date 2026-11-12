import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import type { PresentFrame } from '@engine/core/present';
import { presentWorld, readWorld } from '@kits/rts';
import { battleSnapshot } from '../../kits/rts/__fixtures__/world';
import { browserMissing, launch, listen, ROOT } from './serve';

// An RTS map's decoration on both 2D backends (Engine 0.16 polish Q, Q5). The kit's own frames
// (`presentWorld` over the kit's battle fixture, 8 x 6 cells of 16 px, with fog on) are drawn by a
// one-page Vite build (written here, not a game) through Canvas2D's `SkinnedCanvasPresenter` on a
// 2D canvas and through `pixiDisplay` (WebGL on SwiftShader) on another, and their pixels compared
// with the parity harness's strict bound (`pixi-parity.test.ts`: a pixel differs when R, G or B
// differs by more than 8; at most 0.1% may). One frame has a decoration grid (the map layer
// `decor`, its characters drawn by the skin's `tiles` as flat colours), the other none. The
// decoration shows over the ground, under a unit standing on it, and under the fog: one decorated
// cell's fog is set unexplored here, so it must be black. Skipped where Chromium is not installed
// (never in CI).

const missing = await browserMissing();
if (missing) console.warn(`skipping the RTS decoration parity test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-rts-decor-parity-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const W = 128;
const H = 96;

/** The decoration: flowers at (0, 5), a tree under the soldier at (1, 3), a rock at (5, 2), reeds at (7, 5). */
const DECOR = ['........', '........', '.....r..', '.T......', '........', 'f......|'];

function frame(decor: boolean): PresentFrame {
  const view = readWorld(battleSnapshot({ tick: 5 }));
  const out = presentWorld(view, {
    faction: 'red',
    size: { width: W, height: H },
    fog: true,
    ...(decor && { decor: DECOR }),
  });
  // The reeds' cell, unexplored: the fog must hide the decoration as it hides the ground.
  const cells = out.fog!.cells.map((r, y) => (y === 5 ? `${r.slice(0, 7)}0` : r));
  return { ...out, fog: { ...out.fog!, cells } };
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; background: #000; }
canvas { display: block; width: ${W}px; height: ${H}px; }
</style></head>
<body><canvas id="c2d" width="${W}" height="${H}"></canvas><canvas id="pixi"></canvas>
<script type="module" src="./main.ts"></script></body></html>
`;

const SKIN = {
  backend: 'canvas2d',
  background: '#000000',
  kinds: {
    'unit:soldier': { frames: { idle: 'none' }, fallbackColor: '#f83800' },
    'unit:worker': { frames: { idle: 'none' }, fallbackColor: '#fca044' },
    'building:hall': { frames: { idle: 'none' }, fallbackColor: '#c84c0c' },
    'building:barracks': { frames: { idle: 'none' }, fallbackColor: '#881400' },
    'resource:gold': { frames: { idle: 'none' }, fallbackColor: '#fcbc3c' },
  },
  tiles: {
    '0': { frame: 'none', fallbackColor: '#7c7c7c' },
    '1': { frame: 'none', fallbackColor: '#00a800' },
    T: { frame: 'none', fallbackColor: '#005800' },
    r: { frame: 'none', fallbackColor: '#bcbcbc' },
    f: { frame: 'none', fallbackColor: '#f878f8' },
    '|': { frame: 'none', fallbackColor: '#fcfc00' },
  },
  fog: { unexplored: { color: '#000000', alpha: 1 }, explored: { color: '#101010', alpha: 0.5 } },
};

const MAIN = `
import { freezeFrame } from '@engine/core/present';
import { SkinnedCanvasPresenter } from '@engine/backends/canvas2d';
const screen = { width: ${W}, height: ${H} };
const skin = ${JSON.stringify(SKIN)};
const frames = ${JSON.stringify({ dressed: frame(true), plain: frame(false) })};
function read(canvas) {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  return Array.from(ctx.getImageData(0, 0, copy.width, copy.height).data);
}
window.__decorResult = (async () => {
  const { pixiDisplay } = await import('@engine/backends/pixi');
  const c2d = document.getElementById('c2d');
  const pixiCanvas = document.getElementById('pixi');
  const display = await pixiDisplay(pixiCanvas, { screen, skin, sheet: () => null, preserveDrawingBuffer: true });
  if (typeof display === 'string') return { error: display };
  display.fit({ fit: {} });
  const out = {};
  for (const name of ['dressed', 'plain']) {
    // The decoration is in the map's version, so each backend redraws its cached map for it.
    new SkinnedCanvasPresenter(c2d.getContext('2d'), skin, () => null).present(freezeFrame(frames[name]));
    display.presenter.present(freezeFrame(frames[name]));
    display.present();
    out[name] = { canvas: read(c2d), pixi: read(pixiCanvas), size: [pixiCanvas.width, pixiCanvas.height] };
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

describe.skipIf(missing !== null)('an RTS map’s decoration on Canvas2D and PixiJS (polish Q, Q5)', () => {
  it('draws the same decorated picture on both backends, over the ground and under units and fog', async () => {
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
        () => (window as unknown as { __decorResult: Promise<unknown> }).__decorResult,
      )) as Record<'dressed' | 'plain', { canvas: Rgba; pixi: Rgba; size: number[] }> & { error?: string };
      expect(result.error).toBeUndefined();
      expect(errors).toEqual([]);
      const { dressed, plain } = result;
      expect(dressed.size).toEqual([W, H]);
      expect(share(dressed.canvas, dressed.pixi)).toBeLessThanOrEqual(0.001);
      expect(share(plain.canvas, plain.pixi)).toBeLessThanOrEqual(0.001);
      for (const p of [dressed.canvas, dressed.pixi]) {
        // Over the ground: the flowers (0, 5) and the rock (5, 2), where the plain map is grass.
        expect(pixel(p, 8, 88)).toEqual([248, 120, 248]);
        expect(pixel(p, 88, 40)).toEqual([188, 188, 188]);
        // Under the soldier on the tree's cell (1, 3).
        expect(pixel(p, 24, 56)).toEqual([248, 56, 0]);
        // Under the fog: the reeds' unexplored cell (7, 5) is black.
        expect(pixel(p, 120, 88)).toEqual([0, 0, 0]);
      }
      expect(pixel(plain.canvas, 8, 88)).toEqual([0, 168, 0]);
      expect(pixel(plain.canvas, 88, 40)).toEqual([0, 168, 0]);
      expect(pixel(plain.canvas, 120, 88)).toEqual([0, 0, 0]);
      // Only the three visible decorated cells differ from the plain map (the tree is under a unit).
      expect(share(dressed.canvas, plain.canvas, 0)).toBeCloseTo((2 * 16 * 16) / (W * H), 2);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 120_000);
});
