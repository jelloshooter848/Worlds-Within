import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { cpus, tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright';
import { listen } from '../../browser/serve';
import type { BenchBackend, BenchInfo, BenchRequest, BenchTimes } from './page';
import { BUDGET_MS, frameStats, type BenchLayout, type FrameStats } from './scene';

// The RTS rendering benchmark (Engine 0.9 T3; decision 6 in docs/BUILD-LOG.md, Engine 0.9).
// Not part of `pnpm test`. Run it with
//
//   pnpm exec tsx tests/bench/rts-render/run.ts [--frames 600] [--warmup 60] [--units 500,1000]
//                                              [--zooms 0.5,1,2] [--pixi <pixi.min.js>] [--json]
//                                              [--layouts spread,crowd] [--shots <folder>]
//
// It builds the page in this folder with Vite into a temp folder, serves it, opens it in headless
// Chromium through Playwright with the frame-rate limit and vsync off, and for each backend, unit
// count, layout (`spread` over the map, `crowd` all in view at zoom 0.5) and zoom draws `warmup + frames` frames of the synthetic scene (`scene.ts`) while the
// camera pans. It prints one line per case: the frame time (ms between animation frames: the
// whole frame, including Chromium's raster and compositing) as p50 / p95 / p99 / max and fps, the
// time inside the draw call alone, and PASS when p95 is at most 16.7 ms (60 fps).
//
// The PixiJS column runs only with `--pixi` (or WW_BENCH_PIXI), the path of a PixiJS v8 global
// build (`dist/pixi.min.js`) installed outside the repo, for example:
//
//   npm install --prefix /tmp/pixi --no-save pixi.js@8.22.0
//   pnpm exec tsx tests/bench/rts-render/run.ts --pixi /tmp/pixi/node_modules/pixi.js/dist/pixi.min.js
//
// `--shots <folder>` saves a PNG of each case's last frame there (keep it outside the repo), to
// check by eye that both backends draw the same picture. Without a browser it says why and exits 0.

const HERE = fileURLToPath(new URL('./', import.meta.url));
const ROOT = resolve(HERE, '../../..');
/** The page's window: 1280 x 960 CSS px at 1x, so the 320 x 240 picture is scaled 4x. */
const WINDOW = { width: 1280, height: 960 };
/** Uncapped animation frames, so the time between them is what a frame really costs. */
const CHROMIUM_ARGS = ['--enable-unsafe-swiftshader', '--disable-gpu-vsync', '--disable-frame-rate-limit'];

interface Options {
  frames: number;
  warmup: number;
  units: number[];
  zooms: number[];
  layouts: BenchLayout[];
  pixi: string | null;
  json: boolean;
  shots: string | null;
}

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = {
    frames: 600,
    warmup: 60,
    units: [500, 1000],
    zooms: [0.5, 1, 2],
    layouts: ['spread', 'crowd'],
    pixi: process.env.WW_BENCH_PIXI ?? null,
    json: false,
    shots: null,
  };
  const list = (v: string | undefined) =>
    (v ?? '')
      .split(',')
      .map(Number)
      .filter((n) => n > 0);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i];
    if (arg === '--frames') opts.frames = Number(value());
    else if (arg === '--warmup') opts.warmup = Number(value());
    else if (arg === '--units') opts.units = list(value());
    else if (arg === '--zooms') opts.zooms = list(value());
    else if (arg === '--pixi') opts.pixi = value() ?? null;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--layouts') opts.layouts = layouts(value());
    else if (arg === '--shots') opts.shots = value() ?? null;
    else throw new Error(`unknown option ${arg}`);
  }
  return opts;
}

function layouts(v: string | undefined): BenchLayout[] {
  const out = (v ?? '').split(',');
  for (const l of out) if (l !== 'spread' && l !== 'crowd') throw new Error(`unknown layout "${l}"`);
  return out as BenchLayout[];
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript' };

/** Builds the page and serves it (and PixiJS, when given, at /pixi.min.js). */
async function servePage(outDir: string, pixiFile: string | null) {
  const vite = await import('vite');
  await vite.build({
    configFile: false,
    root: HERE,
    base: './',
    logLevel: 'silent',
    resolve: { alias: { '@engine': join(ROOT, 'engine') } },
    build: { outDir, emptyOutDir: true, target: 'es2022' },
  });
  const http = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    let file = path === '/pixi.min.js' && pixiFile ? pixiFile : normalize(join(outDir, path));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if ((file !== pixiFile && !file.startsWith(outDir)) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  const url = await listen(http);
  return { url, close: () => new Promise<void>((done) => http.close(() => done())) };
}

interface CaseResult {
  backend: BenchBackend;
  layout: BenchLayout;
  units: number;
  zoom: number;
  frame: FrameStats;
  draw: FrameStats;
  pass: boolean;
}

const ms = (n: number) => n.toFixed(2).padStart(6);

function line(r: CaseResult): string {
  const f = r.frame;
  return [
    r.backend.padEnd(8),
    r.layout.padEnd(6),
    String(r.units).padStart(5),
    `x${r.zoom}`.padEnd(4),
    `frame p50 ${ms(f.p50)} p95 ${ms(f.p95)} p99 ${ms(f.p99)} max ${ms(f.max)} ms`,
    `${f.fps.toFixed(0).padStart(4)} fps`,
    `draw p50 ${ms(r.draw.p50)} p95 ${ms(r.draw.p95)} ms`,
    r.pass ? 'PASS' : 'MISS',
  ].join('  ');
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const pixiFile = opts.pixi ? resolve(opts.pixi) : null;
  if (pixiFile && !existsSync(pixiFile)) throw new Error(`no PixiJS build at ${pixiFile}`);

  let browser: Browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ args: CHROMIUM_ARGS });
  } catch (error) {
    const why = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.log(`skipped: Chromium does not start here (${why})`);
    return;
  }
  const outDir = mkdtempSync(join(tmpdir(), 'ww-rts-bench-'));
  const server = await servePage(outDir, pixiFile);
  try {
    const page = await browser.newPage({ viewport: WINDOW, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${server.url}/index.html`);
    if (pixiFile) await page.addScriptTag({ url: '/pixi.min.js' });
    await page.waitForFunction(() => window.bench !== undefined);
    const info: BenchInfo = await page.evaluate(() => window.bench!.info());
    const backends: BenchBackend[] = info.pixi ? ['canvas2d', 'pixi'] : ['canvas2d'];
    if (!opts.json) {
      console.log(`Chromium ${info.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? '?'}, WebGL: ${info.webgl}`);
      console.log(`CPU: ${cpus()[0]?.model ?? '?'} x${cpus().length}`);
      console.log(`window ${info.window.width}x${info.window.height} @${info.window.dpr}x, picture 320x240`);
      console.log(`PixiJS: ${info.pixi ?? 'not loaded (pass --pixi <pixi.min.js>)'}`);
      console.log(
        `${opts.frames} frames per case after ${opts.warmup} warm-up, budget p95 <= ${BUDGET_MS} ms`,
      );
    }
    const results: CaseResult[] = [];
    for (const backend of backends) {
      for (const layout of opts.layouts) {
        for (const units of opts.units) {
          for (const zoom of opts.zooms) {
            const { warmup, frames } = opts;
            const req: BenchRequest = { backend, layout, units, zoom, warmup, frames };
            const times: BenchTimes = await page.evaluate((r) => window.bench!.run(r), req);
            const frame = frameStats(times.interval);
            const draw = frameStats(times.draw);
            const result = { backend, layout, units, zoom, frame, draw, pass: frame.p95 <= BUDGET_MS };
            results.push(result);
            if (!opts.json) console.log(line(result));
            if (opts.shots) {
              await page.screenshot({ path: join(opts.shots, `${backend}-${layout}-${units}-x${zoom}.png`) });
            }
          }
        }
      }
    }
    if (errors.length > 0) throw new Error(`the page logged errors:\n${errors.join('\n')}`);
    if (opts.json) console.log(JSON.stringify({ info, frames: opts.frames, results }, null, 2));
  } finally {
    await browser.close();
    await server.close();
    rmSync(outDir, { recursive: true, force: true });
  }
}

await main();
