import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DebugWindow } from '@engine/core/shell';
import { browserMissing, launch, ROOT, serveBuilt } from './serve';

// The fx lab's page in a browser (Engine 0.16 T2): the repo is built as `pnpm build` builds it
// and served as static files; headless Chromium opens games/fx-lab/ in manual-loop mode
// (`?debug=step`) with each backend, replays `runs/level-1.run.json` through the step hook
// (`window.__ww.replay`), and checks the page's state hashes are the golden ones and that the
// sounds the page played (its displays' `onSound`, recorded in `window.wwFxLab.sounds`) include
// the skins' frame events (Pip's footsteps on the run and walk cycles) as well as the kit's
// events (jump, stomp, the door). Skipped where Chromium is not installed (never in CI).

const GAME = 'games/fx-lab/';

const missing = await browserMissing();
if (missing) console.warn(`skipping the fx lab page test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-fx-lab-page-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

let built: Promise<{ url: string; close(): Promise<void> }> | null = null;
const serve = () => (built ??= serveBuilt('/', join(temp, 'dist')));
afterAll(async () => {
  if (built) await (await built).close();
});

describe.skipIf(missing !== null)('the fx lab page (headless Chromium)', () => {
  it.each(['canvas2d', 'three'])(
    'plays the frame events as sounds in %s, with the golden hashes',
    async (backend) => {
      const server = await serve();
      const browser = await launch();
      try {
        const page = await browser.newPage({ viewport: { width: 512, height: 480 }, deviceScaleFactor: 1 });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
        page.on('console', (msg) => {
          if (msg.type() === 'error') errors.push(`console: ${msg.text()} (${msg.location().url})`);
        });
        await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
        const query = backend === 'three' ? '?backend=three&debug=step' : '?debug=step';
        await page.goto(`${server.url}${GAME}${query}`);
        await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
        expect(await page.evaluate(() => document.body.dataset.backend), errors.join('\n')).toBe(backend);

        const run = JSON.parse(readFileSync(join(ROOT, GAME, 'runs/level-1.run.json'), 'utf8')) as {
          ticks: number;
        };
        const golden = JSON.parse(readFileSync(join(ROOT, GAME, 'runs/level-1.hashes.json'), 'utf8')) as {
          hashes: { tick: number; hash: string }[];
        };
        const seen = await page.evaluate(
          ({ run, ticks, end }) => {
            const ww = (window as DebugWindow).__ww!;
            const lab = (window as { wwFxLab?: { sounds: string[] } }).wwFxLab!;
            lab.sounds.length = 0;
            ww.replay(run);
            const hashes: { tick: number; hash: string | null }[] = [];
            // One step at a time, so every tick is drawn (and its sounds played).
            while (ww.tick < end) {
              ww.step(1);
              if (ticks.includes(ww.tick)) hashes.push({ tick: ww.tick, hash: ww.hash() });
            }
            return { hashes, sounds: [...lab.sounds] };
          },
          { run, ticks: golden.hashes.map((h) => h.tick), end: run.ticks },
        );
        expect(seen.hashes).toEqual(golden.hashes.filter((h) => h.tick > 0));
        const count = (id: string) => seen.sounds.filter((s) => s === id).length;
        // Frame events of the skins' cycles: footsteps on Pip's walk and run frames.
        expect(count('footstep'), seen.sounds.join(',')).toBeGreaterThan(10);
        // And the kit's own events, through the same skin `events`.
        for (const id of ['jump', 'land', 'coin', 'stomp', 'door']) expect(count(id), id).toBeGreaterThan(0);
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    300_000,
  );
});
