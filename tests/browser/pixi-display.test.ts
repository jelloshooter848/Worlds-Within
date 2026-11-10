import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { browserMissing, launch, listen, ROOT } from './serve';

// The PixiJS display in Chromium (Engine 0.16 T13b-3): a one-page Vite build (written here, not a
// game) imports `@engine/backends/pixi` dynamically, starts `pixiDisplay` on a canvas, presents a
// frame with a sky-blue background, a green wall tile and a red box through a fixture skin, and
// reads the canvas back. It checks the display started on WebGL (SwiftShader here: software), drew
// the picture letterboxed (sky and red pixels, black bars, the map cached on a RenderTexture and
// copied the right way up), maps the picture's centre to the client and back, and logged no errors. Skipped where Chromium is not installed (never in CI).

const missing = await browserMissing();
if (missing) console.warn(`skipping the PixiJS display test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-pixi-display-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; background: #000; }
canvas { display: block; width: 400px; height: 300px; }
</style></head>
<body><canvas id="game"></canvas><script type="module" src="./main.ts"></script></body></html>
`;

const MAIN = `
import { freezeFrame } from '@engine/core/present';
const canvas = document.getElementById('game');
const result = {};
window.__pixiResult = (async () => {
  const { pixiDisplay } = await import('@engine/backends/pixi');
  const screen = { width: 64, height: 60 };
  const skin = {
    backend: 'canvas2d',
    background: '#5c94fc',
    kinds: { block: { frames: { idle: 'missing' }, fallbackColor: '#ff0000' } },
    tiles: { '#': { fallbackColor: '#00ff00' } },
  };
  const display = await pixiDisplay(canvas, { screen, skin, sheet: () => null });
  if (typeof display === 'string') return { error: display };
  display.fit({ fit: {} });
  display.presenter.present(freezeFrame({
    frame: 0,
    size: screen,
    map: { id: 'm', version: 0, tileSize: 16, cols: 4, rows: 4, tiles: ['#...', '....', '....', '....'] },
    entities: [{ id: 'b', kind: 'block', x: 16, y: 20, w: 16, h: 16, facing: 'down', anim: { state: 'idle', t: 0 }, tags: [] }],
    events: [],
    status: {},
  }));
  display.present();
  // Read the WebGL canvas back in the same task, before it is composited.
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const px = ctx.getImageData(0, 0, copy.width, copy.height).data;
  const count = { sky: 0, red: 0, black: 0, green: 0 };
  const green = [copy.width, copy.height, 0, 0];
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    if (r === 0x5c && g === 0x94 && b === 0xfc) count.sky++;
    else if (r === 255 && g === 0 && b === 0) count.red++;
    else if (r === 0 && g === 255 && b === 0) {
      count.green++;
      const x = (i / 4) % copy.width;
      const y = Math.floor(i / 4 / copy.width);
      green[0] = Math.min(green[0], x);
      green[1] = Math.min(green[1], y);
      green[2] = Math.max(green[2], x + 1);
      green[3] = Math.max(green[3], y + 1);
    }
    else if (r === 0 && g === 0 && b === 0) count.black++;
  }
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  const centre = display.toClient(32, 30);
  return {
    size: [canvas.width, canvas.height],
    count,
    green,
    webgl: gl !== null,
    centre,
    back: display.toScreen(centre.x, centre.y),
    ui: typeof display.uiPainter === 'function' && typeof display.transition === 'function',
  };
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

describe.skipIf(missing !== null)('pixiDisplay in Chromium (Engine 0.16 T13b-3)', () => {
  it('starts on WebGL and draws the picture, letterboxed, with no page errors', async () => {
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
      const result = await page.evaluate(
        () => (window as unknown as { __pixiResult: Promise<unknown> }).__pixiResult,
      );
      expect(result).not.toHaveProperty('error');
      const r = result as {
        size: [number, number];
        count: { sky: number; red: number; black: number; green: number };
        green: number[];
        webgl: boolean;
        centre: { x: number; y: number };
        back: { x: number; y: number };
        ui: boolean;
      };
      expect(r.webgl).toBe(true);
      expect(r.size).toEqual([400, 300]);
      // 64x60 stretched to 300 high: 320x300, bars 40 px wide each side.
      expect(r.count.red).toBeGreaterThan(0);
      expect(r.count.sky).toBeGreaterThan(r.count.red);
      expect(r.count.black).toBeGreaterThanOrEqual(2 * 40 * 300 - 400);
      // Picture size 320x300 => red box 16 px * 5 = 80 px square.
      expect(r.count.red).toBeGreaterThan(70 * 70);
      // The map's one wall tile, copied from its RenderTexture the right way up: the picture's
      // top-left 16x16, 80x80 on the page from x = 40.
      expect(r.green).toEqual([40, 0, 120, 80]);
      expect(r.centre).toEqual({ x: 200, y: 150 });
      expect(r.back).toEqual({ x: 32, y: 30 });
      expect(r.ui).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 120_000);
});
