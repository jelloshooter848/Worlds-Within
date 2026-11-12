import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { browserMissing, launch, listen, ROOT } from './serve';

// The tower defense's looks on both 2D backends (Engine 0.16 E6). A one-page Vite build (written
// here, not a game) draws the same fixture frames through Canvas2D's `SkinnedCanvasPresenter` and
// through `pixiDisplay` (WebGL on SwiftShader) and compares their pixels with the parity harness's
// strict bound (`pixi-parity.test.ts`: a pixel differs when R, G or B differs by more than 8; at
// most 0.1% may). The sheet is drawn on a canvas in the page (no image file). The frames: a tower
// with a ring from its `range:` tag, two enemies with health bars against their own `maxhp:` tags,
// a wave preview in the HUD (icons by kind and counts in an inline font), and two projectiles (an
// arrow frame and a lobbed square) shown in flight, then landing with a burst. Skipped where
// Chromium is not installed (never in CI).

const missing = await browserMissing();
if (missing) console.warn(`skipping the tower-defense looks parity test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-td-parity-'));
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
import { buildFont } from '@engine/core/ui';
import { SkinnedCanvasPresenter } from '@engine/backends/canvas2d';
const screen = { width: ${W}, height: ${H} };
// The sheet: an 8x8 grey tower, an 8x8 red runner, a 6x6 blue icon and a 6x2 orange arrow.
const art = document.createElement('canvas');
art.width = 32;
art.height = 8;
const g = art.getContext('2d');
g.fillStyle = '#808080'; g.fillRect(0, 0, 8, 8);
g.fillStyle = '#c03030'; g.fillRect(9, 1, 6, 6);
g.fillStyle = '#3c7cfc'; g.fillRect(16, 0, 6, 6);
g.fillStyle = '#f8b800'; g.fillRect(24, 0, 6, 2);
const sheet = { id: 'td', image: art, frames: new Map([
  ['tower', { x: 0, y: 0, w: 8, h: 8 }],
  ['runner', { x: 8, y: 0, w: 8, h: 8 }],
  ['icon', { x: 16, y: 0, w: 6, h: 6 }],
  ['arrow', { x: 24, y: 0, w: 6, h: 2 }],
]) };
const lookup = (id) => (id === 'td' ? sheet : null);
const block = { rows: ['##', '##', '##', '..'] };
const font = buildFont('small', { cell: { w: 2, h: 4 }, baseline: 3, glyphs: Object.fromEntries([...'0123456789x'].map((c) => [c, block])) });
const fonts = (id) => (id === 'small' ? font : null);
const skin = {
  backend: 'canvas2d',
  background: '#204020',
  sheets: { sheet: 'td', fallbackColor: '#ff00ff' },
  kinds: {
    tower: { frames: { idle: 'tower' }, ring: { tag: 'range:', per: 8, color: '#fcfcfc', alpha: 0.25, edge: '#fcfcfc' } },
    enemy: { frames: { walk: 'runner' } },
  },
  emitters: { burst: { burst: 6, life: 6, speed: [0.5, 1], even: true, size: 1, color: '#fcfcfc' } },
  events: {
    shot: { projectile: { frame: 'arrow', ticks: 6, impact: { emit: 'burst' } } },
    bolt: { projectile: { frame: 'arrow', ticks: 6, turn: true } },
    lob: { projectile: { ticks: 6, arc: 10, size: 2, color: '#fc7460', impact: { emit: 'burst' } } },
  },
  labels: { enemy: { from: { tag: 'hp:' }, as: 'bar', max: { tag: 'maxhp:' }, w: 10, h: 2, color: '#00d800', back: '#000000' } },
  hud: [{ status: 'nextWaveGroups', as: 'preview', x: 2, y: 2, frames: { runner: 'icon' }, font: 'small', format: 'x{value}', color: '#fcfcfc' }],
};
const e = (id, kind, x, y, tags, state = 'idle') => ({ id, kind, x, y, w: 8, h: 8, facing: 'down', anim: { state, t: 0 }, tags });
function frame(n, events = []) {
  return freezeFrame({
    frame: n,
    size: screen,
    entities: [
      e('t', 'tower', 20, 36, ['range:2']),
      e('a', 'enemy', 60, 36, ['hp:3', 'maxhp:4'], 'walk'),
      e('b', 'enemy', 76, 20, ['hp:3', 'maxhp:12'], 'walk'),
    ],
    events,
    status: { nextWaveGroups: 'runner:6,brute:2' },
    camera: { x: 48, y: 32 },
  });
}
const shots = [
  { type: 'shot', fromX: 24, fromY: 40, x: 64, y: 40 },
  { type: 'lob', fromX: 24, fromY: 40, x: 80, y: 24 },
  { type: 'bolt', fromX: 44, fromY: 6, x: 64, y: 18 },
];
function read(canvas) {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  return Array.from(ctx.getImageData(0, 0, copy.width, copy.height).data);
}
window.__tdResult = (async () => {
  const { pixiDisplay } = await import('@engine/backends/pixi');
  const c2d = document.getElementById('c2d');
  const pixiCanvas = document.getElementById('pixi');
  const display = await pixiDisplay(pixiCanvas, { screen, skin, sheet: lookup, fonts, preserveDrawingBuffer: true });
  if (typeof display === 'string') return { error: display };
  display.fit({ fit: {} });
  const canvasPresenter = new SkinnedCanvasPresenter(c2d.getContext('2d'), skin, lookup, { fonts });
  const out = {};
  for (const [n, events] of [[10, shots], [13, []], [17, []]]) {
    canvasPresenter.present(frame(n, events));
    display.presenter.present(frame(n, events));
    display.present();
    out[n] = { canvas: read(c2d), pixi: read(pixiCanvas), size: [pixiCanvas.width, pixiCanvas.height] };
  }
  out.particles = canvasPresenter.particleCount;
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

/** The turned bolt's flight box [x0, y0, x1, y1] (inclusive), picture px (camera at world 0, 0). */
const BOLT = [38, 0, 70, 24] as const;

const inBox = (x: number, y: number, box: readonly number[]) =>
  x >= box[0]! && x <= box[2]! && y >= box[1]! && y <= box[3]!;

/** How many pixels differ in R, G or B by more than `threshold`, outside `box` (or, `inside`, in it). */
function differing(a: Rgba, b: Rgba, box: readonly number[], inside = false, threshold = 8): number {
  let n = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (inBox(x, y, box) !== inside) continue;
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++)
        if (Math.abs(a[i + c]! - b[i + c]!) > threshold) {
          n++;
          break;
        }
    }
  return n;
}

/** The share of the picture's pixels outside `box` that differ (by more than 8 in R, G or B). */
function share(a: Rgba, b: Rgba, box: readonly number[]): number {
  return differing(a, b, box) / (W * H);
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

/** How many pixels are of one colour. */
function count(p: Rgba, rgb: number[]): number {
  let n = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (pixel(p, x, y).every((v, i) => Math.abs(v - rgb[i]!) <= 8)) n++;
  return n;
}

describe.skipIf(missing !== null)("the tower defense's looks on Canvas2D and PixiJS (Engine 0.16 E6)", () => {
  it('draws rings, bars, the wave preview and projectiles in flight and landing the same on both', async () => {
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
        () => (window as unknown as { __tdResult: Promise<unknown> }).__tdResult,
      )) as Record<string, { canvas: Rgba; pixi: Rgba; size: number[] }> & {
        error?: string;
        particles?: number;
      };
      expect(result.error).toBeUndefined();
      expect(errors).toEqual([]);
      for (const n of ['10', '13', '17']) {
        const shot = result[n]!;
        expect(shot.size).toEqual([W, H]);
        // A sprite turned to an arbitrary angle samples its texels differently on the two
        // backends (as a sprite at zoom 0.5 does, readability-parity.test.ts): the bolt's box is
        // held to a few edge pixels, the rest of the picture to the strict bound.
        expect(share(shot.canvas, shot.pixi, BOLT)).toBeLessThanOrEqual(0.001);
        expect(differing(shot.canvas, shot.pixi, BOLT, true)).toBeLessThanOrEqual(16);
      }
      for (const p of [result['13']!.canvas, result['13']!.pixi]) {
        // The arrow half-way (frame 13 of 10 + 6): its 6x2 frame centred on world (44, 40).
        expect(pixel(p, 41, 39)).toEqual([248, 184, 0]);
        expect(pixel(p, 46, 40)).toEqual([248, 184, 0]);
        expect(pixel(p, 47, 40)).toEqual([32, 64, 32]);
        expect(pixel(p, 40, 39)).not.toEqual([248, 184, 0]);
        // The bolt flies down-right, turned along its way: its centre at world (54, 12).
        expect(pixel(p, 54, 12)).toEqual([248, 184, 0]);
        // The lobbed square is above its straight line.
        expect(bounds(p, [252, 116, 96])![1]).toBeLessThan(30);
        // The bars, 10x2 each, filled against each enemy's own max: 3 of 4 (8 px) and 3 of 12 (3 px).
        expect(count(p, [0, 216, 0])).toBe((8 + 3) * 2);
        // The preview's runner icon at (2, 2).
        expect(bounds(p, [60, 124, 252])).toEqual([2, 2, 7, 7]);
      }
      for (const p of [result['17']!.canvas, result['17']!.pixi]) {
        // Landed on frame 16: no projectile left in the air.
        expect(bounds(p, [248, 184, 0])).toBeNull();
        expect(bounds(p, [252, 116, 96])).toBeNull();
      }
      expect(result.particles).toBeGreaterThan(0);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 120_000);
});
