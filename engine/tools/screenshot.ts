import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Browser } from 'playwright';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ShotJob, ShotResult } from './screenshot/job';

/**
 * Takes a screenshot in headless Chromium (Playwright): serves the repo with a Vite dev server in
 * middleware mode on a free local port, opens the tools-only screenshot page
 * (`screenshot/index.html`, never in the Pages build) with a viewport of the game's picture size
 * (`job.screen`, from `game.json`) and devicePixelRatio 1, hands it the job and gets the canvas back as PNG bytes (`canvas.toDataURL`,
 * not a page screenshot, so no font smoothing or scaling of the page gets in). Used by the
 * `screenshot` command.
 */

/** The repo root: Vite serves it, so the page and every game folder in it have a URL. */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The screenshot page, relative to the repo root. */
export const SHOT_PAGE = 'engine/tools/screenshot/index.html';

/** Chromium flags that keep canvas output the same from run to run on one machine. */
const CHROMIUM_ARGS = [
  '--disable-gpu',
  '--disable-accelerated-2d-canvas',
  '--force-color-profile=srgb',
  '--font-render-hinting=none',
  '--disable-lcd-text',
];

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
export async function launchChromium(): Promise<Browser> {
  const { chromium } = await import('playwright');
  try {
    return await chromium.launch({ args: CHROMIUM_ARGS });
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
  const server = await vite.createServer({
    configFile: join(REPO_ROOT, 'vite.config.ts'),
    root: REPO_ROOT,
    appType: 'mpa',
    logLevel: 'silent',
    clearScreen: false,
    // Pre-bundling would reload the page halfway through; the page's few imports load as they are.
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null, fs: { allow: [REPO_ROOT, gameAbs] } },
  });
  const http: Server = createHttpServer(server.middlewares);
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

/**
 * Plays `job` on the screenshot page and returns the PNG bytes and what the page reported. The
 * view module is at `viewAbs` (an absolute path); `job.viewUrl` is filled in here.
 */
export async function takeScreenshot(
  job: Omit<ShotJob, 'viewUrl'>,
  gameAbs: string,
  viewAbs: string,
): Promise<{ png: Buffer; width: number; height: number; snapshot: string; hashes: ShotResult['hashes'] }> {
  const browser = await launchChromium();
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
    const shot: ShotResult = await page.evaluate((j) => window.wwShoot!(j), full);
    const prefix = 'data:image/png;base64,';
    if (!shot.png.startsWith(prefix)) throw new Error('the screenshot page did not return a PNG');
    return {
      png: Buffer.from(shot.png.slice(prefix.length), 'base64'),
      width: shot.width,
      height: shot.height,
      snapshot: shot.snapshot,
      hashes: shot.hashes,
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
