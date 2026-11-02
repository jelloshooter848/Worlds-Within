import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Browser } from 'playwright';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ShotBackend, ShotJob, ShotRefusal, ShotResult } from './screenshot/job';

/**
 * Takes a screenshot in headless Chromium (Playwright): serves the repo with a Vite dev server in
 * middleware mode on a free local port, opens the tools-only screenshot page
 * (`screenshot/index.html`, never in the Pages build) with a viewport of the game's picture size
 * (`job.screen`, from `game.json`) and devicePixelRatio 1, hands it the job and gets the canvas back as PNG bytes (`canvas.toDataURL`,
 * not a page screenshot, so no font smoothing or scaling of the page gets in). Used by the
 * `screenshot` command, with Chromium's flags chosen per backend ({@link chromiumArgs}).
 */

/** The repo root: Vite serves it, so the page and every game folder in it have a URL. */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The screenshot page, relative to the repo root. */
export const SHOT_PAGE = 'engine/tools/screenshot/index.html';

/** Chromium flags that keep canvas output the same from run to run on one machine. */
const STABLE_ARGS = ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text'];

/** How to start Chromium for a screenshot: which backend, and whether software WebGL is allowed. */
export interface LaunchOptions {
  backend?: ShotBackend;
  allowSoftwareGl?: boolean;
}

/**
 * Chromium's flags for a backend. `canvas2d` turns the GPU off (the 2D canvas is drawn on the
 * CPU, the same every run). `three` asks for the GPU (and ignores the blocklist), so WebGL is
 * hardware-backed where a GPU exists; with `allowSoftwareGl` it uses SwiftShader through ANGLE
 * instead, on purpose, so the picture is the same on every run on one machine.
 */
export function chromiumArgs(opts: LaunchOptions = {}): string[] {
  if ((opts.backend ?? 'canvas2d') === 'canvas2d')
    return ['--disable-gpu', '--disable-accelerated-2d-canvas', ...STABLE_ARGS];
  const gl = opts.allowSoftwareGl
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--enable-gpu', '--ignore-gpu-blocklist'];
  return [...gl, ...STABLE_ARGS];
}

/** Thrown when Chromium for Playwright is not installed: the command reports it as a crash. */
export class NoBrowserError extends Error {
  override name = 'NoBrowserError';
}

/** The URL path Vite serves `abs` (a file) at: under the root, or through `/@fs/` outside it. */
export function servedPath(abs: string): string {
  const rel = relative(REPO_ROOT, abs).replaceAll('\\', '/');
  if (rel !== '' && !rel.startsWith('..') && !rel.startsWith('/')) return `/${rel}`;
  return `/@fs/${abs.replaceAll('\\', '/').replace(/^\//, '')}`;
}

/** Launches headless Chromium, or throws {@link NoBrowserError} with what to run. */
export async function launchChromium(opts: LaunchOptions = {}): Promise<Browser> {
  const { chromium } = await import('playwright');
  try {
    return await chromium.launch({ args: chromiumArgs(opts) });
  } catch (error) {
    const why = error instanceof Error ? error.message.split('\n')[0] : String(error);
    throw new NoBrowserError(
      `cannot start Chromium for Playwright (${why}). Install it with: pnpm exec playwright install --with-deps chromium`,
      { cause: error },
    );
  }
}

/** Starts Vite in middleware mode behind a local HTTP server; returns its base URL and a close. */
async function serve(gameAbs: string): Promise<{ base: string; close(): Promise<void> }> {
  const vite = await import('vite');
  // Vite's client always opens a websocket. Left alone in middleware mode it dials the fixed port
  // 24678, which another dev server (a second screenshot run, a test) may hold, and fails there with
  // a page error. Attaching the websocket to this server's own port keeps concurrent runs apart.
  const http: Server = createHttpServer();
  const server = await vite.createServer({
    configFile: join(REPO_ROOT, 'vite.config.ts'),
    root: REPO_ROOT,
    appType: 'mpa',
    logLevel: 'silent',
    clearScreen: false,
    // Pre-bundling would reload the page halfway through; the page's few imports load as they are.
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
      middlewareMode: true,
      hmr: false,
      ws: { server: http },
      watch: null,
      fs: { allow: [REPO_ROOT, gameAbs] },
    },
  });
  http.on('request', server.middlewares);
  await new Promise<void>((done, fail) => {
    http.once('error', fail);
    http.listen(0, '127.0.0.1', () => done());
  });
  const { port } = http.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise<void>((done) => http.close(() => done()));
      await server.close();
    },
  };
}

/** A screenshot the page took: the PNG bytes and what the page reported. */
export interface Shot {
  png: Buffer;
  width: number;
  height: number;
  snapshot: string;
  hashes: ShotResult['hashes'];
  renderer: string | null;
}

/**
 * Plays `job` on the screenshot page and returns the PNG bytes and what the page reported, or the
 * page's refusal (see `ShotRefusal`). The view module is at `viewAbs` (an absolute path);
 * `job.viewUrl` is filled in here.
 */
export async function takeScreenshot(
  job: Omit<ShotJob, 'viewUrl'>,
  gameAbs: string,
  viewAbs: string,
): Promise<Shot | ShotRefusal> {
  const browser = await launchChromium({ backend: job.backend, allowSoftwareGl: job.allowSoftwareGl });
  let server: Awaited<ReturnType<typeof serve>> | undefined;
  try {
    server = await serve(resolve(gameAbs));
    const page = await browser.newPage({
      viewport: { width: job.screen.width, height: job.screen.height },
      deviceScaleFactor: 1,
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${server.base}/${SHOT_PAGE}`);
    try {
      await page.waitForFunction(() => typeof window.wwShoot === 'function', undefined, { timeout: 30_000 });
    } catch (error) {
      const why = errors.length > 0 ? errors.join('; ') : String(error);
      throw new Error(`the screenshot page did not start: ${why}`, { cause: error });
    }
    const full: ShotJob = { ...job, viewUrl: `${server.base}${servedPath(viewAbs)}` };
    const shot = await page.evaluate((j) => window.wwShoot!(j), full);
    if ('refused' in shot) return shot;
    const prefix = 'data:image/png;base64,';
    if (!shot.png.startsWith(prefix)) throw new Error('the screenshot page did not return a PNG');
    return {
      png: Buffer.from(shot.png.slice(prefix.length), 'base64'),
      width: shot.width,
      height: shot.height,
      snapshot: shot.snapshot,
      hashes: shot.hashes,
      renderer: shot.renderer,
    };
  } finally {
    await browser.close();
    await server?.close();
  }
}

/** A PNG's width and height, from its IHDR chunk. */
export function pngSize(png: Buffer): { width: number; height: number } {
  const signature = '89504e470d0a1a0a';
  if (
    png.length < 24 ||
    png.subarray(0, 8).toString('hex') !== signature ||
    png.toString('latin1', 12, 16) !== 'IHDR'
  )
    throw new Error('not a PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
