import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { cpus, tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright';
import { readGameFiles } from '@engine/core/node/game-files';
import { listen } from '../../browser/serve';
import { BUDGET_MS, frameStats, type FrameStats } from '../rts-render/scene';
import { FEATURE_GAMES } from './games';
import type { FeatureInfo, FeatureRequest, FeatureTimes, GameText } from './page';
import { FEATURE_NAMES, PUNCH_AT, type FeatureMap, type FeatureName } from './scene';

// The 2D feature benchmark (Engine 0.16 T13, item 320; numbers and the Canvas2D/PixiJS decision
// in docs/BUILD-LOG.md, Engine 0.16 part A). Not part of `pnpm test`. Run it with
//
//   pnpm bench:features [--seconds 5] [--warmup 60] [--maps rts,td] [--zooms 0.5,1,2]
//                       [--units rts=500,td=300] [--no-plain] [--ablate] [--shots <folder>]
//
// It builds the page in this folder with Vite into a temp folder, serves it, opens it in headless
// Chromium through Playwright with vsync and the frame-rate limit off, hands the page the two
// sample games' files (the RTS skirmish and the tower defense) and, per map, zoom and features
// on/off (`plain`: the game's own skin and the same units, nothing added; `--no-plain` skips it;
// `--ablate` adds zoom-1 cases with features switched off again: each alone, glow and additive
// blending together, and all of them, to see what each costs),
// draws `warmup` frames and then measures frames for `seconds`. It prints one JSON document on
// stdout: the machine, then per case the frame time (ms between animation frames: the whole frame)
// and the draw call's time as p50 / p95 / p99 / max / mean and fps, the frames measured, the live
// particles (mean and min of samples) and entities, and `pass` (p95 at most 16.7 ms, 60 fps).
// Progress lines go to stderr. `--shots <folder>` also saves a PNG per case (features on) after
// the scene's first `SHOT_FRAMES` frames, drawn at once: a blast and a zoom punch on screen
// (keep the folder outside the repo). Without a browser it prints `{"skipped": "<why>"}`, exit 0.

const HERE = fileURLToPath(new URL('./', import.meta.url));
const ROOT = resolve(HERE, '../../..');
/** 1280 x 960 CSS px at 1x: the 320 x 240 RTS picture scaled 4x, the 256 x 240 TD one 4x. */
const WINDOW = { width: 1280, height: 960 };
const CHROMIUM_ARGS = ['--enable-unsafe-swiftshader', '--disable-gpu-vsync', '--disable-frame-rate-limit'];

interface Options {
  seconds: number;
  warmup: number;
  maps: FeatureMap[];
  zooms: number[];
  units: Record<FeatureMap, number>;
  plain: boolean;
  ablate: boolean;
  shots: string | null;
}

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = {
    seconds: 5,
    warmup: 60,
    maps: ['rts', 'td'],
    zooms: [0.5, 1, 2],
    units: { rts: FEATURE_GAMES.rts.units, td: FEATURE_GAMES.td.units },
    plain: true,
    ablate: false,
    shots: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i] ?? '';
    if (arg === '--seconds') opts.seconds = Number(value());
    else if (arg === '--warmup') opts.warmup = Number(value());
    else if (arg === '--maps') opts.maps = maps(value());
    else if (arg === '--zooms')
      opts.zooms = value()
        .split(',')
        .map(Number)
        .filter((n) => n > 0);
    else if (arg === '--units') {
      for (const pair of value().split(',')) {
        const [map, n] = pair.split('=');
        opts.units[maps(map ?? '')[0]!] = Number(n);
      }
    } else if (arg === '--no-plain') opts.plain = false;
    else if (arg === '--ablate') opts.ablate = true;
    else if (arg === '--shots') opts.shots = value();
    else throw new Error(`unknown option ${arg}`);
  }
  return opts;
}

function maps(v: string): FeatureMap[] {
  const out = v.split(',');
  for (const m of out) if (m !== 'rts' && m !== 'td') throw new Error(`unknown map "${m}" (rts or td)`);
  return out as FeatureMap[];
}

/** `--ablate`: each feature off alone, glow and additive blending off together, and all of them. */
const ABLATIONS: FeatureName[][] = [
  ...FEATURE_NAMES.map((name) => [name]),
  ['glow', 'add'],
  [...FEATURE_NAMES],
];

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript' };

/** Builds the page and serves it. */
async function servePage(outDir: string) {
  const vite = await import('vite');
  await vite.build({
    configFile: false,
    root: HERE,
    base: './',
    logLevel: 'silent',
    resolve: { alias: { '@engine': join(ROOT, 'engine'), '@kits': join(ROOT, 'kits') } },
    build: { outDir, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 4000 },
  });
  const http = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    let file = normalize(join(outDir, path));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!file.startsWith(outDir) || !existsSync(file)) {
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
  map: FeatureMap;
  features: boolean;
  /** Features switched off again (`--ablate`). */
  without: FeatureName[];
  units: number;
  zoom: number;
  frame: FrameStats;
  draw: FrameStats;
  particles: { mean: number; min: number };
  entities: number;
  pass: boolean;
}

const round = (s: FrameStats): FrameStats =>
  Object.fromEntries(
    Object.entries(s).map(([k, v]) => [k, k === 'frames' ? v : Math.round(v * 100) / 100]),
  ) as unknown as FrameStats;

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  let browser: Browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ args: CHROMIUM_ARGS });
  } catch (error) {
    const why = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.log(JSON.stringify({ skipped: `Chromium does not start here (${why})` }));
    return;
  }
  const outDir = mkdtempSync(join(tmpdir(), 'ww-feature-bench-'));
  const server = await servePage(outDir);
  try {
    const page = await browser.newPage({ viewport: WINDOW, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${server.url}/index.html`);
    await page.waitForFunction(() => window.featureBench !== undefined);
    const text = Object.fromEntries(
      opts.maps.map((map) => {
        const def = FEATURE_GAMES[map];
        const dir = join(ROOT, def.dir);
        return [map, { files: readGameFiles(dir), run: readFileSync(join(dir, def.run), 'utf8') }];
      }),
    ) as Record<FeatureMap, GameText>;
    const info: FeatureInfo = await page.evaluate((t) => window.featureBench!.init(t), text);
    const machine = {
      chromium: info.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? '?',
      webgl: info.webgl,
      cpu: `${cpus()[0]?.model ?? '?'} x${cpus().length}`,
      window: info.window,
      screens: info.screens,
    };
    console.error(`Chromium ${machine.chromium}, WebGL: ${machine.webgl}, CPU: ${machine.cpu}`);
    if (opts.shots) {
      mkdirSync(opts.shots, { recursive: true });
      for (const map of opts.maps) {
        for (const zoom of opts.zooms) {
          const shot = await page.evaluate((r) => window.featureBench!.shot(r), {
            map,
            zoom,
            units: opts.units[map],
          });
          const path = join(opts.shots, `features-${map}-x${zoom}.png`);
          await page.screenshot({ path });
          console.error(`shot ${path} (${shot.particles} particles, ${shot.entities} entities)`);
        }
        // Two frames into the zoom punch's flash, and the game's plain skin, at zoom 1.
        const req = { map, zoom: 1, units: opts.units[map] };
        await page.evaluate((r) => window.featureBench!.shot(r, r.frames), { ...req, frames: PUNCH_AT + 3 });
        await page.screenshot({ path: join(opts.shots, `features-${map}-flash.png`) });
        await page.evaluate((r) => window.featureBench!.shot(r), { ...req, features: false });
        await page.screenshot({ path: join(opts.shots, `plain-${map}-x1.png`) });
      }
    }
    const results: CaseResult[] = [];
    // Features on and plain at every zoom; with --ablate, the ablations at zoom 1.
    const variants: { features: boolean; without: FeatureName[]; zooms: number[] }[] = [
      { features: true, without: [], zooms: opts.zooms },
      ...(opts.plain ? [{ features: false, without: [], zooms: opts.zooms }] : []),
      ...(opts.ablate ? ABLATIONS.map((without) => ({ features: true, without, zooms: [1] })) : []),
    ];
    for (const map of opts.maps) {
      for (const { features, without, zooms } of variants) {
        for (const zoom of zooms) {
          const req: FeatureRequest = {
            map,
            zoom,
            units: opts.units[map],
            features,
            without,
            warmup: opts.warmup,
            seconds: opts.seconds,
          };
          const times: FeatureTimes = await page.evaluate((r) => window.featureBench!.run(r), req);
          const frame = round(frameStats(times.interval));
          const samples = times.particles.length > 0 ? times.particles : [0];
          const result: CaseResult = {
            map,
            features,
            without,
            units: req.units,
            zoom,
            frame,
            draw: round(frameStats(times.draw)),
            particles: {
              mean: Math.round(samples.reduce((s, n) => s + n, 0) / samples.length),
              min: Math.min(...samples),
            },
            entities: times.entities,
            pass: frame.p95 <= BUDGET_MS,
          };
          results.push(result);
          console.error(
            `${map.padEnd(3)} ${features ? (without.length ? `-${without.join(',')}` : 'features') : 'plain'} x${zoom} ` +
              `frame p50 ${frame.p50.toFixed(2)} p95 ${frame.p95.toFixed(2)} ms, ${frame.fps.toFixed(0)} fps, ` +
              `draw p50 ${result.draw.p50.toFixed(2)} ms, ${result.particles.mean} particles ` +
              `${result.pass ? 'PASS' : 'MISS'}`,
          );
        }
      }
    }
    if (errors.length > 0) throw new Error(`the page logged errors:\n${errors.join('\n')}`);
    const summary = { budgetMs: BUDGET_MS, seconds: opts.seconds, warmup: opts.warmup, machine, results };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
    await server.close();
    rmSync(outDir, { recursive: true, force: true });
  }
}

await main();
