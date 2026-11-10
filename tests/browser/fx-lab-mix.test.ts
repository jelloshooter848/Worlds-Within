import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { MixerState } from '@engine/core/audio/mixer';
import type { DebugWindow } from '@engine/core/shell';
import { browserMissing, launch, ROOT, serveBuilt } from './serve';

// The audio mixer in the browser (Engine 0.16 T8): the fx lab's 2D page in manual-loop mode
// (`?debug=step`), sound started by a key press, replays `runs/level-1.run.json` one step at a time
// and records the mixer's state (`window.__ww.mix()`) at every tick: the layered song `lab`
// starts calm, the danger layer comes up as Pip nears a beetle (the kit's `nearestActor` status)
// in a crossfade no faster than its rule's fade, the stomp ducks the music, footsteps play varied
// (some dropped by their cooldown), and the page's state hashes stay the golden ones. A second
// page load records exactly the same gains. Then Pip's dialog opens over the level and the music
// ducks to half until it closes. Skipped where Chromium is not installed (never in CI).

const GAME = 'games/fx-lab/';

const missing = await browserMissing();
if (missing) console.warn(`skipping the fx lab mixer test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-fx-lab-mix-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

let built: Promise<{ url: string; close(): Promise<void> }> | null = null;
const serve = () => (built ??= serveBuilt('/', join(temp, 'dist')));
afterAll(async () => {
  if (built) await (await built).close();
});

interface Recorded {
  tick: number;
  calm: number;
  danger: number;
  duck: number;
  rule: number;
}

/** Opens the page, starts sound with a key press, replays the run and records the mixer every tick. */
async function record(page: Page, url: string): Promise<{ seen: Recorded[]; last: MixerState }> {
  await page.goto(url);
  await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
  await page.keyboard.press('Shift'); // a gesture: sound starts (the replay plays its own input)
  const run = JSON.parse(readFileSync(join(ROOT, GAME, 'runs/level-1.run.json'), 'utf8')) as {
    ticks: number;
  };
  const golden = JSON.parse(readFileSync(join(ROOT, GAME, 'runs/level-1.hashes.json'), 'utf8')) as {
    hashes: { tick: number; hash: string }[];
  };
  const played = await page.evaluate(
    ({ run, ticks, end }) => {
      const ww = (window as DebugWindow).__ww!;
      ww.replay(run);
      const seen: Recorded[] = [];
      const hashes: { tick: number; hash: string | null }[] = [];
      while (ww.tick < end) {
        ww.step(1);
        const m = ww.mix()!;
        seen.push({
          tick: ww.tick,
          calm: m.layers['calm']!,
          danger: m.layers['danger']!,
          duck: m.duck,
          rule: m.rule,
        });
        if (ticks.includes(ww.tick)) hashes.push({ tick: ww.tick, hash: ww.hash() });
      }
      return { seen, last: ww.mix()!, hashes };
    },
    { run, ticks: golden.hashes.map((h) => h.tick), end: run.ticks },
  );
  // The mixer never touches the game: the page's hashes are the golden ones.
  expect(played.hashes).toEqual(golden.hashes.filter((h) => h.tick > 0));
  return { seen: played.seen, last: played.last };
}

describe.skipIf(missing !== null)('the fx lab mixer (headless Chromium)', () => {
  it('mixes the danger layer in near a beetle, ducks under a stomp and the dialog, the same every load', async () => {
    const server = await serve();
    const browser = await launch();
    try {
      const page = await browser.newPage({ viewport: { width: 512, height: 480 }, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
      const url = `${server.url}${GAME}?debug=step`;
      const first = await record(page, url);
      const { seen, last } = first;

      expect(last.song).toBe('lab');
      // Calm at the start: the default rule.
      expect(seen[0]).toMatchObject({ calm: 1, danger: 0, rule: 1 });
      // A beetle comes near: the danger rule holds and its layer reaches full, calm at 0.3.
      const danger = seen.findIndex((s) => s.rule === 0);
      expect(danger, 'Pip never neared a beetle').toBeGreaterThan(0);
      expect(seen.some((s) => s.danger === 1 && Math.abs(s.calm - 0.3) < 1e-9)).toBe(true);
      // Crossfades, never jumps: at most 1/12 a tick (the danger rule's 12-tick fade is the fastest).
      for (let i = 1; i < seen.length; i++) {
        expect(Math.abs(seen[i]!.danger - seen[i - 1]!.danger), `tick ${seen[i]!.tick}`).toBeLessThanOrEqual(
          1 / 12 + 1e-9,
        );
      }
      // The stomp ducked the music; it came back.
      expect(Math.min(...seen.map((s) => s.duck))).toBeLessThan(0.6);
      expect(seen.at(-1)!.duck).toBeGreaterThan(0.99);
      // Sounds played, footsteps varied and some rested.
      expect(last.sounds.played).toBeGreaterThan(20);
      expect(last.sounds.dropped).toBeGreaterThan(0);
      expect(last.buses).toEqual({ master: 0.4, music: 1, sfx: 1, ui: 1 });

      // The same recording on a fresh load: the mix is deterministic.
      const again = await record(page, url);
      expect(again.seen).toEqual(seen);
      expect(again.last.sounds).toEqual(last.sounds);

      // Pip's dialog over the level: the music ducks to half while it shows, then comes back.
      const ducked = await page.evaluate(() => {
        const ww = (window as DebugWindow).__ww!;
        const lab = (window as unknown as { wwFxLab: { ui: { open(w: string): boolean } } }).wwFxLab;
        lab.ui.open('dialog');
        ww.step(30);
        return ww.mix()!;
      });
      expect(ducked).toMatchObject({ dialog: true, duck: 0.5 });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 300_000);
});
