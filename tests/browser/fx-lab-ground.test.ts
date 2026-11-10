import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { join, normalize } from 'node:path';
import { browserMissing, launch, listen, ROOT } from './serve';

// Engine 0.16 F2: the fx lab's ground-view example (`games/fx-lab/ground/`, a page `pnpm build` leaves out) in
// headless Chromium, built alone by Vite and served as static files. At frame 70 it reads the picture: the
// meadow's green fills most of it, the sky shows at the far edge only, and the page logged no
// errors. `WW_SHOTS_DIR=<folder>` keeps `fx-lab-ground.png` to look at. Skipped where Chromium is
// not installed (never in CI).

const missing = await browserMissing();
if (missing) console.warn(`skipping the fx lab ground-view test: ${missing}`);

const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const close of closers.splice(0)) await close();
});

/**
 * The ground page built alone (Vite, the repo's aliases and `virtual:game-files`) into a temporary
 * folder and served as static files (`pnpm build` leaves the page out).
 */
async function serveGroundPage(): Promise<string> {
  const vite = await import('vite');
  const { gameFiles } = await import('../../build/game-files');
  const outDir = mkdtempSync(join(tmpdir(), 'ww-fx-ground-'));
  closers.push(async () => rmSync(outDir, { recursive: true, force: true }));
  await vite.build({
    configFile: false,
    root: ROOT,
    base: '/',
    logLevel: 'silent',
    plugins: [gameFiles()],
    resolve: { alias: { '@engine': join(ROOT, 'engine'), '@kits': join(ROOT, 'kits') } },
    build: {
      outDir,
      emptyOutDir: true,
      target: 'es2022',
      chunkSizeWarningLimit: 2000,
      rollupOptions: { input: { ground: join(ROOT, 'games/fx-lab/ground/index.html') } },
    },
  });
  const http = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    let file = normalize(join(outDir, path));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!file.startsWith(outDir) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    const type = file.endsWith('.html')
      ? 'text/html'
      : file.endsWith('.js')
        ? 'text/javascript'
        : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(readFileSync(file));
  });
  const base = await listen(http);
  closers.push(() => new Promise<void>((done) => http.close(() => done())));
  return base;
}

describe.skipIf(missing !== null)('fx lab ground view in the browser (Engine 0.16 F2)', () => {
  it('draws the meadow on the floor under a pitched camera', { timeout: 180_000 }, async () => {
    const base = await serveGroundPage();
    const browser = await launch();
    try {
      const page = await browser.newPage({ viewport: { width: 512, height: 480 }, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      page.on('response', (r) => {
        if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`);
      });
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console: ${msg.text()} ${msg.location().url}`);
      });
      await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
      await page.goto(`${base}/games/fx-lab/ground/?frame=70`);
      await page
        .waitForFunction(
          () => (window as unknown as { wwGround?: { shown: number } }).wwGround?.shown === 70,
          null,
          {
            timeout: 60_000,
          },
        )
        .catch((error: unknown) => {
          throw new Error(`the page never drew frame 70: ${String(error)}\n${errors.join('\n')}`);
        });
      const shares = await page.evaluate(() => {
        const canvas = document.getElementById('screen') as HTMLCanvasElement;
        const c = document.createElement('canvas');
        c.width = canvas.width;
        c.height = canvas.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(canvas, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let green = 0;
        let topSky = 0;
        let bottomGreen = 0;
        const n = d.length / 4;
        for (let i = 0; i < n; i++) {
          const [r, g, b] = [d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!];
          const isGreen = g > r + 20 && g > b + 20;
          const row = Math.floor(i / c.width);
          if (isGreen) green++;
          if (row >= c.height - 8 && isGreen) bottomGreen++;
          if (row < 8 && b > 180 && g > 180) topSky++;
        }
        return { green: green / n, bottomGreen: bottomGreen / (8 * c.width), topSky: topSky / (8 * c.width) };
      });
      const shot = await page.evaluate(() =>
        (document.getElementById('screen') as HTMLCanvasElement).toDataURL('image/png'),
      );
      const dir = process.env['WW_SHOTS_DIR'];
      if (dir) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'fx-lab-ground.png'), Buffer.from(shot.split(',')[1]!, 'base64'));
      }
      expect(errors).toEqual([]);
      expect(shares.green).toBeGreaterThan(0.4);
      expect(shares.bottomGreen).toBeGreaterThan(0.5);
    } finally {
      await browser.close();
    }
  });
});
