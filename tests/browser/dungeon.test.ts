import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { DebugWindow } from '@engine/core/shell';
import { browserMissing, launch, ROOT, serveBuilt } from './serve';

// The dungeon sample's page in a browser (Engine 0.15 T12; docs/BUILD-LOG.md, Engine 0.15,
// decision 13, item 290: a finished sample plays from its link in the games index). The repo is
// built as `pnpm build` builds it and served as `pnpm preview` serves it; headless Chromium opens
// the games index, finds games/samples/dungeon/ there and follows that link, then plays the page
// in manual-loop mode (`?debug=step`: `window.__ww.step(n)` takes exactly n 60 Hz steps):
// first by the keyboard (ArrowRight held, the walk-east run: the page's state hash at every golden
// tick is `runs/walk-east.hashes.json`'s), then each run file through the step hook's replay
// (the way out to the exit and the fall in the guard room, with their golden hashes and their end
// states). It checks the picture is drawn (the dark side margin of the 16:9 picture, the west wall's ledge),
// the volume control is there, and the page logged no errors. Skipped where Chromium is not
// installed (never in CI).

const GAME = 'games/samples/dungeon/';

interface Golden {
  hashes: { tick: number; hash: string }[];
}
const golden = (name: string) =>
  JSON.parse(readFileSync(join(ROOT, GAME, `runs/${name}.hashes.json`), 'utf8')) as Golden;
const runFile = (name: string) =>
  JSON.parse(readFileSync(join(ROOT, GAME, `runs/${name}.run.json`), 'utf8')) as unknown;

const missing = await browserMissing();
if (missing) console.warn(`skipping the dungeon page test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-dungeon-page-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

let built: Promise<{ url: string; close(): Promise<void> }> | null = null;
/** The build, served once for every test here. */
const serve = () => (built ??= serveBuilt('/', join(temp, 'dist')));
afterAll(async () => {
  if (built) await (await built).close();
});

/** A new page that collects its errors. */
async function openPage(): Promise<{ page: Page; errors: string[]; close(): Promise<void> }> {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()} (${msg.location().url})`);
  });
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  return { page, errors, close: () => browser.close() };
}

/** One pixel of the picture (game pixels) as `r,g,b`. */
function pixel(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(
    ({ x, y }) => {
      const canvas = document.getElementById('screen') as HTMLCanvasElement;
      const s = canvas.width / 320;
      const px = canvas.getContext('2d')!.getImageData(Math.floor(x * s), Math.floor(y * s), 1, 1).data;
      return `${px[0]},${px[1]},${px[2]}`;
    },
    { x, y },
  );
}

describe.skipIf(missing !== null)('the dungeon sample page (headless Chromium)', () => {
  it('is linked from the games index and plays walk-east by the keyboard with the golden hashes', async () => {
    const server = await serve();
    const { page, errors, close } = await openPage();
    try {
      await page.goto(server.url);
      const link = page.locator(`#games a[href="${GAME}"]`);
      expect(await link.count()).toBe(1);
      expect(await link.locator('xpath=..').textContent()).toContain('The Old Crypt');
      // Follow the index's own link, then ask that page for manual-loop mode.
      await link.click();
      await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
      expect(new URL(page.url()).pathname).toBe(`/${GAME}`);
      await page.goto(`${page.url()}?debug=step`);
      await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
      expect(await page.evaluate(() => document.body.dataset.backend), errors.join('\n')).toBe('canvas2d');
      expect(await page.locator('#ww-volume').count()).toBe(1);
      const step = (n: number) => page.evaluate((n) => (window as DebugWindow).__ww!.step(n), n);
      const hash = () => page.evaluate(() => (window as DebugWindow).__ww!.hash());

      const seen: { tick: number; hash: string | null }[] = [{ tick: 0, hash: await hash() }];
      await page.keyboard.down('ArrowRight');
      for (const { tick } of golden('walk-east').hashes.slice(1)) {
        await step(tick - (seen.at(-1)?.tick ?? 0));
        seen.push({ tick, hash: await hash() });
      }
      await page.keyboard.up('ArrowRight');
      expect(seen).toEqual(golden('walk-east').hashes);
      const state = (await page.evaluate(() => (window as DebugWindow).__ww!.snapshot())) as {
        room: string;
      };
      expect(state.room).toBe('guard-room');
      // The 16:9 picture (Engine 0.16 part C T3): the skin's dark background in the side margin,
      // the west wall's stone ledge beside the room (the CC0 pack's colours).
      expect(await pixel(page, 12, 120)).toBe('20,16,22');
      expect(await pixel(page, 32 + 13, 58)).toMatch(/^(170,141,122|211,191,169)$/);
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  }, 300_000);

  it.each([
    ['escape', { exited: true, dead: false }],
    ['lost-in-the-guard-room', { exited: false, dead: true }],
  ])(
    'replays %s.run.json through the page with the golden hashes and its end',
    async (name, end) => {
      const server = await serve();
      const { page, errors, close } = await openPage();
      try {
        await page.goto(`${server.url}${GAME}?debug=step`);
        await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
        const ticks = golden(name).hashes.map((h) => h.tick);
        const seen = await page.evaluate(
          ({ run, ticks }) => {
            const ww = (window as DebugWindow).__ww!;
            const hashes: { tick: number; hash: string | null }[] = [];
            ww.replay(run);
            for (const tick of ticks) {
              ww.step(tick - ww.tick);
              hashes.push({ tick: ww.tick, hash: ww.hash() });
            }
            const snap = ww.snapshot() as { exited: boolean; hero: { dead: boolean } };
            return { hashes, refused: ww.refused.length, exited: snap.exited, dead: snap.hero.dead };
          },
          { run: runFile(name), ticks },
        );
        expect(seen).toEqual({ hashes: golden(name).hashes, refused: 0, ...end });
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    },
    300_000,
  );
});
