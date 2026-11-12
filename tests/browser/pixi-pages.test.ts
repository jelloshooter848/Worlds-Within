import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { DebugWindow } from '@engine/core/shell';
import { browserMissing, launch, serveBuilt } from './serve';

// The 2D backend choice on the game pages (Engine 0.16 T13b-4). The repo is built as `pnpm build`
// builds it and served as `pnpm preview` serves it; headless Chromium (SwiftShader WebGL) opens
// each page that offers PixiJS in manual-loop mode with `?backend=pixi` and with
// `?backend=canvas2d`, and checks `body[data-backend]` names that backend, the page steps (its
// state hash, where the page has one, is the same on both backends after the same steps) and it logged no errors. Then,
// with WebGL taken away from the page (`getContext('webgl'|'webgl2')` returns null), `?backend=pixi`
// falls back to Canvas2D. Skipped where Chromium is not installed (never in CI).
//
// Engine 0.16 T13b-8: the RTS skirmish (and, from 0.16 part D, its copy
// games/rts-classic) and the tower defense (and, from 0.16 part E, its copy games/td-classic)
// default to PixiJS. With no query each
// runs on PixiJS (headless Chromium's software WebGL, SwiftShader, counts as WebGL being there),
// with WebGL taken away it runs on Canvas2D, and `?backend=canvas2d` still forces Canvas2D.

const PAGES = [
  'games/samples/rts-skirmish/',
  'games/samples/tower-defense/',
  'games/samples/dungeon/',
  'games/samples/mini-siege/',
  'games/fx-lab/',
  'games/platformer-lab/',
  'games/platformer-classic/',
  'games/rts-classic/',
  'games/td-classic/',
];

/** The pages whose default 2D backend is PixiJS (Engine 0.16 T13b-8); the others default to Canvas2D. */
const DEFAULT_PIXI = [
  'games/samples/rts-skirmish/',
  'games/samples/tower-defense/',
  'games/rts-classic/',
  'games/td-classic/',
];

const missing = await browserMissing();
if (missing) console.warn(`skipping the PixiJS pages test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-pixi-pages-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

let built: Promise<{ url: string; close(): Promise<void> }> | null = null;
/** The build, served once for every test here. */
const serve = () => (built ??= serveBuilt('/', join(temp, 'dist')));
afterAll(async () => {
  if (built) await (await built).close();
});

/** Takes WebGL away from every canvas of the page, as on a browser without it. */
const NO_WEBGL = () => {
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    kind: string,
    ...rest: unknown[]
  ) {
    if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') return null;
    return (get as (...a: unknown[]) => unknown).call(this, kind, ...rest);
  } as typeof get;
};

/** Opens `url`, waits for the boot and returns the backend that runs, the hash after 30 steps and the errors. */
async function play(
  url: string,
  noWebgl = false,
): Promise<{ backend: string; hash: string | null; errors: string[] }> {
  const browser = await launch();
  try {
    const page: Page = await browser.newPage({ viewport: { width: 512, height: 480 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console: ${msg.text()} (${msg.location().url})`);
    });
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    if (noWebgl) await page.addInitScript(NO_WEBGL);
    await page.goto(url);
    await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
    const backend = await page.evaluate(() => document.body.dataset.backend ?? '');
    const hash = await page.evaluate(() => {
      const ww = (window as DebugWindow).__ww!;
      ww.step(30);
      return ww.hash();
    });
    return { backend, hash, errors };
  } finally {
    await browser.close();
  }
}

describe.skipIf(missing !== null)('the 2D backend choice on the game pages (headless Chromium)', () => {
  it.each(PAGES)(
    '%s runs on PixiJS with ?backend=pixi and on Canvas2D with ?backend=canvas2d, tick for tick',
    async (game) => {
      const server = await serve();
      const pixi = await play(`${server.url}${game}?backend=pixi&debug=step`);
      expect(pixi.backend, pixi.errors.join('\n')).toBe('pixi');
      expect(pixi.errors).toEqual([]);
      const canvas = await play(`${server.url}${game}?backend=canvas2d&debug=step`);
      expect(canvas.backend, canvas.errors.join('\n')).toBe('canvas2d');
      expect(canvas.errors).toEqual([]);
      expect(pixi.hash).toBe(canvas.hash);
    },
    300_000,
  );

  it.each(DEFAULT_PIXI)(
    '%s defaults to PixiJS, runs on Canvas2D without WebGL and with ?backend=canvas2d',
    async (game) => {
      const server = await serve();
      const pixi = await play(`${server.url}${game}?debug=step`);
      expect(pixi.backend, pixi.errors.join('\n')).toBe('pixi');
      expect(pixi.errors).toEqual([]);
      const noWebgl = await play(`${server.url}${game}?debug=step`, true);
      expect(noWebgl.backend, noWebgl.errors.join('\n')).toBe('canvas2d');
      expect(noWebgl.errors).toEqual([]);
      const forced = await play(`${server.url}${game}?backend=canvas2d&debug=step`);
      expect(forced.backend, forced.errors.join('\n')).toBe('canvas2d');
      expect(forced.errors).toEqual([]);
      expect(noWebgl.hash).toBe(pixi.hash);
      expect(forced.hash).toBe(pixi.hash);
    },
    300_000,
  );

  it('keeps Canvas2D as the default of the other pages (the dungeon)', async () => {
    const server = await serve();
    const run = await play(`${server.url}games/samples/dungeon/?debug=step`);
    expect(run.backend, run.errors.join('\n')).toBe('canvas2d');
    expect(run.errors).toEqual([]);
  }, 300_000);

  it('falls back to Canvas2D with ?backend=pixi where WebGL is missing', async () => {
    const server = await serve();
    const run = await play(`${server.url}games/samples/tower-defense/?backend=pixi&debug=step`, true);
    expect(run.backend, run.errors.join('\n')).toBe('canvas2d');
    expect(run.errors).toEqual([]);
    expect(run.hash).not.toBeNull();
  }, 300_000);
});
