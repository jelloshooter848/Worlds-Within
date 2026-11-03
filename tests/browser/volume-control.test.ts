import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { browserMissing, launch, serveBuilt } from './serve';

// The shell's volume control on every sample page (Engine 0.15 T5, gap M1; docs/BUILD-LOG.md,
// Engine 0.15, decision 5, item 282). The repo is built as `pnpm build` builds it; headless
// Chromium opens each sample page, finds the mute button and the volume slider, mutes and moves
// the slider on two pages (the tower-defense sample and the dungeon, both on the shell's boot),
// reloads, and finds the same volumes, stored under `ww:<game>:volumes`. No page errors.
// Skipped where Chromium is not installed (never in CI).

const PAGES = ['dungeon', 'platformer', 'rts-skirmish', 'tower-defense', 'mini-siege'];

const missing = await browserMissing();
if (missing) console.warn(`skipping the volume control test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-volume-control-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

/** The control as the page shows it: muted or not, the slider's value. */
async function shown(page: Page): Promise<{ muted: string | null; master: string }> {
  await page.waitForSelector('#ww-volume', { timeout: 60_000 });
  return {
    muted: await page.locator('#ww-mute').getAttribute('aria-pressed'),
    master: await page.locator('#ww-master').inputValue(),
  };
}

describe.skipIf(missing !== null)('the volume control on the sample pages (headless Chromium)', () => {
  it('is on every sample page, and a page keeps its volumes across a reload', async () => {
    const server = await serveBuilt('/', join(temp, 'dist'));
    const browser = await launch();
    const errors: string[] = [];
    try {
      const context = await browser.newContext({ viewport: { width: 640, height: 560 } });
      await context.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      for (const game of PAGES) {
        await page.goto(`${server.url}games/samples/${game}/`);
        // A fresh browser: sound on, the default master volume (40%).
        expect(await shown(page), game).toEqual({ muted: 'false', master: '40' });
        expect(await page.locator('#ww-volume').getAttribute('aria-label'), game).toBe('Sound');
      }
      for (const game of ['tower-defense', 'dungeon']) {
        await page.goto(`${server.url}games/samples/${game}/`);
        await shown(page);
        await page.click('#ww-mute');
        await page.locator('#ww-master').fill('70');
        await page.click('#ww-mute'); // the slider unmutes; mute again
        expect(await shown(page), game).toEqual({ muted: 'true', master: '70' });
        await page.reload();
        expect(await shown(page), `${game} after a reload`).toEqual({ muted: 'true', master: '70' });
        const stored = await page.evaluate((key) => localStorage.getItem(key), `ww:${game}:volumes`);
        expect(JSON.parse(stored!), game).toEqual({ master: 0.7, music: 1, sfx: 1, muted: true });
      }
      // Another game's page keeps its own volumes.
      await page.goto(`${server.url}games/samples/platformer/`);
      expect(await shown(page)).toEqual({ muted: 'false', master: '40' });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 300_000);
});
