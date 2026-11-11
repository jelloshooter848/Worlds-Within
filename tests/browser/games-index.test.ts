import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { DebugWindow } from '@engine/core/shell';
import { browserMissing, launch, serveBuilt } from './serve';

// The games index over the built site (Engine 0.15 T16, the release's Done when: "every sample
// plays from a link"). The repo is built as `pnpm build` builds it, under a sub-path as the Pages
// workflow builds it (`VITE_BASE=/<repo>/`), and served as static files. Headless Chromium opens
// the launcher, checks it links each of the five samples (and the platformer's 3D link, and since
// Engine 0.16 F7 the mini siege's 2D link: its page opens in 3D), follows
// each link, and checks the page boots: its canvas is there, and in manual-loop mode
// (`?debug=step`) `window.__ww.step(n)` takes the steps and the page has a headless game with a
// state hash, with no page or console error. Each sample's own browser test plays it further.
// Skipped where Chromium is not installed (never in CI).

const BASE = '/Worlds-Within/';
const SAMPLES = ['dungeon', 'platformer', 'rts-skirmish', 'tower-defense', 'mini-siege'] as const;

const missing = await browserMissing();
if (missing) console.warn(`skipping the games index test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-games-index-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

let built: Promise<{ url: string; close(): Promise<void> }> | null = null;
/** The build, served once for every test here. */
const serve = () => (built ??= serveBuilt(BASE, join(temp, 'dist')));
afterAll(async () => {
  if (built) await (await built).close();
});

/** A new page that collects its errors. */
async function openPage(): Promise<{ page: Page; errors: string[]; close(): Promise<void> }> {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()} (${msg.location().url})`);
  });
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  return { page, errors, close: () => browser.close() };
}

/**
 * The samples whose page steps a headless game through the shell (`__ww.hash()` is its state
 * hash). The RTS skirmish's page steps its own scene (`SkirmishPlay`, the game a tick every six
 * loop steps), so it is checked through its own hook, `window.wwSkirmish.tick()`.
 */
const HEADLESS: readonly string[] = ['dungeon', 'platformer', 'tower-defense', 'mini-siege'];

/** The backend each sample's page opens with when the query names none (the mini siege: 3D). */
const DEFAULT_BACKEND: Partial<Record<string, string>> = {
  'rts-skirmish': 'pixi',
  'tower-defense': 'pixi',
};

/** Waits for the page's step hook, steps it `n` times and returns its tick and hash. */
async function stepPage(
  page: Page,
  n: number,
  headless = true,
): Promise<{ tick: number; hash: string | null }> {
  await page.waitForFunction(() => (window as DebugWindow).__ww !== undefined, null, { timeout: 30_000 });
  // A page may build its game a moment after the hook (a campaign page loads its content first).
  if (headless) {
    await page.waitForFunction(() => (window as DebugWindow).__ww!.hash() !== null, null, {
      timeout: 30_000,
    });
  }
  return page.evaluate((n) => {
    const ww = (window as DebugWindow).__ww!;
    const tick = ww.step(n);
    return { tick, hash: ww.hash() };
  }, n);
}

describe.skipIf(missing !== null)('the games index over the built site (headless Chromium)', () => {
  it('links each of the five samples, and the platformer in 3D', { timeout: 180_000 }, async () => {
    const server = await serve();
    const { page, errors, close } = await openPage();
    try {
      await page.goto(server.url);
      for (const sample of SAMPLES) {
        expect(await page.locator(`#games a[href="games/samples/${sample}/"]`).count(), sample).toBe(1);
      }
      expect(await page.locator('#games a[href="games/samples/platformer/?backend=three"]').count()).toBe(1);
      // The mini siege opens in 3D (Engine 0.16 F7); its launcher entry also links the 2D page.
      expect(await page.locator('#games a[href="games/samples/mini-siege/?backend=canvas2d"]').count()).toBe(
        1,
      );
      // Neither old folder is listed (they were moved into the samples in T2).
      expect(await page.locator('#games a[href="games/demo/"]').count()).toBe(0);
      expect(await page.locator('#games a[href="games/platformer-test/"]').count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });

  it.each(SAMPLES)('opens %s from its link and it boots and steps', { timeout: 180_000 }, async (sample) => {
    const server = await serve();
    const { page, errors, close } = await openPage();
    try {
      await page.goto(server.url);
      await page.locator(`#games a[href="games/samples/${sample}/"]`).click();
      await page.waitForURL(`${server.url}games/samples/${sample}/`);
      expect(await page.locator('canvas').count()).toBeGreaterThan(0);
      // The same page in manual-loop mode, so the test steps it exactly.
      await page.goto(`${page.url()}?debug=step`);
      const headless = HEADLESS.includes(sample);
      // The mini siege opens in 3D (Engine 0.16 F7: software WebGL counts), the others in 2D.
      await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
      expect(await page.evaluate(() => document.body.dataset.backend)).toBe(
        sample === 'mini-siege' ? 'three' : (DEFAULT_BACKEND[sample] ?? 'canvas2d'),
      );
      const start = await stepPage(page, 0, headless);
      const after = await stepPage(page, 60, headless);
      expect(after.tick).toBe(start.tick + 60);
      if (headless) expect(after.hash).toMatch(/^[0-9a-f]{16}$/);
      else {
        // 60 loop steps are 10 game ticks on the skirmish's page (`STEPS_PER_TICK` 6).
        const tick = await page.evaluate(() =>
          (window as unknown as { wwSkirmish: { tick(): number } }).wwSkirmish.tick(),
        );
        expect(tick).toBe(10);
      }
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });

  it('opens the mini siege in 2D from its launcher link and it steps', { timeout: 180_000 }, async () => {
    const server = await serve();
    const { page, errors, close } = await openPage();
    try {
      await page.goto(server.url);
      await page.locator('#games a[href="games/samples/mini-siege/?backend=canvas2d"]').click();
      await page.waitForURL(`${server.url}games/samples/mini-siege/?backend=canvas2d`);
      await page.goto(`${page.url()}&debug=step`);
      await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
      expect(await page.evaluate(() => document.body.dataset.backend)).toBe('canvas2d');
      const after = await stepPage(page, 30);
      expect(after.tick).toBe(30);
      expect(after.hash).toMatch(/^[0-9a-f]{16}$/);
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });

  it('opens the platformer in 3D from its link and it steps', { timeout: 180_000 }, async () => {
    const server = await serve();
    const { page, errors, close } = await openPage();
    try {
      await page.goto(server.url);
      await page.locator('#games a[href="games/samples/platformer/?backend=three"]').click();
      await page.waitForURL(`${server.url}games/samples/platformer/?backend=three`);
      await page.goto(`${page.url()}&debug=step`);
      const after = await stepPage(page, 30);
      expect(after.tick).toBe(30);
      expect(after.hash).toMatch(/^[0-9a-f]{16}$/);
      expect(errors.filter((e) => !/GPU stall|WebGL/i.test(e))).toEqual([]);
    } finally {
      await close();
    }
  });
});
