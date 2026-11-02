import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright';

// Browser smoke test of the platformer lab in 3D (docs/ROADMAP.md, 0.6 "Done when": the fixture
// level plays in the browser in 3D). Headless Chromium opens /games/platformer-lab/?backend=three,
// served by Vite as `pnpm dev` does and then from a `pnpm build` output under a sub-path base (as
// VITE_BASE does for Pages). Each time it checks that the page booted the Three.js backend, that its
// canvas has a WebGL 2 context and what renderer that reports (here SwiftShader, a software one:
// this checks that 3D works, not that it is hardware-backed), that holding right and jumping
// changes the picture, and that the page logged no errors. Skipped where Chromium is not installed
// (never in CI), like the screenshot tests.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LAB = 'games/platformer-lab/';
const SUB_BASE = '/ww-sub/';

/** SwiftShader is Chromium's WebGL when there is no GPU (newer Chromium wants it asked for). */
const CHROMIUM_ARGS = ['--enable-unsafe-swiftshader'];

async function launch(): Promise<Browser> {
  const { chromium } = await import('playwright');
  return chromium.launch({ args: CHROMIUM_ARGS });
}

/** Why Chromium does not start here, or null (in CI a missing browser fails the test instead). */
async function browserMissing(): Promise<string | null> {
  try {
    await (await launch()).close();
    return null;
  } catch (error) {
    if (process.env.CI) return null;
    return error instanceof Error ? (error.message.split('\n')[0] ?? 'no Chromium') : String(error);
  }
}
const missing = await browserMissing();
if (missing) console.warn(`skipping the 3D lab smoke test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-lab-3d-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

async function listen(server: Server): Promise<string> {
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => done());
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Vite's dev server (middleware mode) over the repo, as `pnpm dev` serves it. */
async function serveDev(): Promise<{ url: string; close(): Promise<void> }> {
  const vite = await import('vite');
  const dev = await vite.createServer({
    configFile: join(ROOT, 'vite.config.ts'),
    root: ROOT,
    appType: 'mpa',
    logLevel: 'silent',
    clearScreen: false,
    // Pre-bundling would reload the page halfway through; the page's imports load as they are.
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  const http = createServer(dev.middlewares);
  const base = await listen(http);
  return {
    url: `${base}/${LAB}`,
    async close() {
      await new Promise<void>((done) => http.close(() => done()));
      await dev.close();
    },
  };
}

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
};

/** The repo built with `base` into `outDir`, served as static files under that base. */
async function serveBuilt(base: string, outDir: string): Promise<{ url: string; close(): Promise<void> }> {
  const vite = await import('vite');
  await vite.build({
    configFile: join(ROOT, 'vite.config.ts'),
    root: ROOT,
    base,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
  const http = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    let file = path.startsWith(base) ? normalize(join(outDir, path.slice(base.length))) : '';
    if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!file.startsWith(outDir) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  const origin = await listen(http);
  return {
    url: `${origin}${base}${LAB}`,
    close: () => new Promise<void>((done) => http.close(() => done())),
  };
}

interface Played {
  renderer: string;
  before: string;
  after: string;
  /** Share of pixels that changed over 300 ms with no input (the lab's walker moves on its own). */
  idleChange: number;
  /** Share of pixels that changed while holding right and jumping (the runner and the camera move). */
  playChange: number;
  errors: string[];
  toggle: string | null;
}

/** Opens the lab at `labUrl` + `?backend=three`, reads the WebGL renderer, then holds right and jumps. */
async function play(labUrl: string): Promise<Played> {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 512, height: 480 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console: ${msg.text()} (${msg.location().url})`);
    });
    // Browsers ask for /favicon.ico on their own; the lab has none, and that 404 is not the page's.
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    await page.goto(`${labUrl}?backend=three`);
    await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
    const backend = await page.evaluate(() => document.body.dataset.backend);
    expect(backend, errors.join('\n')).toBe('three');

    const renderer = await page.evaluate(() => {
      const canvas = document.getElementById('screen') as HTMLCanvasElement;
      // The presenter already made a WebGL 2 context: this returns that same one.
      const gl = canvas.getContext('webgl2');
      if (!gl) return '';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    });
    const picture = () =>
      page.evaluate(() => (document.getElementById('screen') as HTMLCanvasElement).toDataURL('image/png'));

    /** The share of pixels that differ between two PNG data URLs of the same size. */
    const changed = (a: string, b: string) =>
      page.evaluate(
        async ([a, b]) => {
          const pixels = async (url: string) => {
            const img = new Image();
            img.src = url;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const ctx = c.getContext('2d')!;
            ctx.drawImage(img, 0, 0);
            return ctx.getImageData(0, 0, c.width, c.height).data;
          };
          const [pa, pb] = [await pixels(a), await pixels(b)];
          let n = 0;
          for (let i = 0; i < pa.length; i += 4)
            if (pa[i] !== pb[i] || pa[i + 1] !== pb[i + 1] || pa[i + 2] !== pb[i + 2]) n++;
          return n / (pa.length / 4);
        },
        [a, b] as const,
      );

    await page.waitForTimeout(300);
    const idle = await picture();
    await page.waitForTimeout(300);
    const before = await picture();
    const idleChange = await changed(idle, before);
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(1500);
    await page.keyboard.down('z');
    await page.waitForTimeout(300);
    await page.keyboard.up('z');
    await page.waitForTimeout(300);
    await page.keyboard.up('ArrowRight');
    const after = await picture();
    const playChange = await changed(before, after);
    const toggle = await page.evaluate(
      () => document.getElementById('backend')?.getAttribute('href') ?? null,
    );
    return { renderer, before, after, idleChange, playChange, errors, toggle };
  } finally {
    await browser.close();
  }
}

function expectPlayed(played: Played): void {
  console.info(
    `lab 3D smoke test: WebGL renderer ${played.renderer}; changed ${(played.idleChange * 100).toFixed(2)}% idle, ${(played.playChange * 100).toFixed(2)}% playing`,
  );
  expect(played.errors).toEqual([]);
  expect(played.renderer).not.toBe('');
  expect(played.before.startsWith('data:image/png;base64,')).toBe(true);
  expect(played.after).not.toBe(played.before);
  // Holding right for 2 s scrolls the level (the camera follows the runner): far more changes than idle.
  expect(played.playChange).toBeGreaterThan(0.01);
  expect(played.playChange).toBeGreaterThan(played.idleChange * 3);
  expect(played.toggle).toBe('./');
}

describe.skipIf(missing !== null)('the platformer lab in 3D (headless Chromium, WebGL)', () => {
  it('plays from the Vite dev server: WebGL renderer, input moves the picture, no page errors', async () => {
    const server = await serveDev();
    try {
      expectPlayed(await play(server.url));
    } finally {
      await server.close();
    }
  }, 120_000);

  it('plays from the build under a sub-path base', async () => {
    const server = await serveBuilt(SUB_BASE, join(temp, 'dist'));
    try {
      expectPlayed(await play(server.url));
    } finally {
      await server.close();
    }
  }, 180_000);
});
