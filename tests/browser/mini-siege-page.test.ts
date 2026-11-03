import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import type { InputScript } from '@engine/core/input/scripted-input';
import { browserMissing, launch, ROOT, serveBuilt } from './serve';

// The mini siege played from a link (docs/ROADMAP.md, 0.11 "done when": played from a link in a
// few minutes, by playing the mission and by delegating it, and both paths change the battle the
// way the design says). The repo is built as `pnpm build` builds it and served as `pnpm preview`
// serves it; headless Chromium finds games/samples/mini-siege/ in the launcher, opens it and, on
// two fresh pages, clicks the bar's Launch button at world tick 40 and then Delegate (seed 11
// draws `ram-burnt`) or Play (the recorded round of `played.run.json` typed on the keyboard, which
// burns both engines). On both paths the battle holds still while the choice waits, the result
// commits at world tick 160 (40 + the mission's cost of 120) and the hall ends as the run files
// say. The page's clock is the test's (one loop step per call, as in rts-skirmish.test.ts), so the
// game is the same every time. Skipped where Chromium is not installed (never in CI).

const GAME = 'games/samples/mini-siege/';
/** Loop steps per world tick (`STEPS_PER_TICK` in play.ts). */
const STEPS_PER_TICK = 6;
/** The keys the shell binds to each action (`engine/core/input/bindings.ts`). */
const KEYS: Record<string, string> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  attack: 'KeyX',
};

interface Hook {
  tick(): number;
  choice(): string | null;
  playing(): boolean;
  outcomes(): string[];
}

const recordedRound = (): InputScript =>
  (
    JSON.parse(readFileSync(join(ROOT, GAME, 'runs/played.run.json'), 'utf8')) as {
      missions: { action: string; input?: InputScript }[];
    }
  ).missions.find((m) => m.action === 'play')!.input!;

const missing = await browserMissing();
if (missing) console.warn(`skipping the mini siege page test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-mini-siege-page-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

/** Calls `window.wwSiege[name]()` on the page. */
function hook<K extends keyof Hook>(page: Page, name: K): Promise<ReturnType<Hook[K]>> {
  return page.evaluate(
    (name) => (window as unknown as { wwSiege: Record<string, () => unknown> }).wwSiege[name]!(),
    name,
  ) as Promise<ReturnType<Hook[K]>>;
}

/** A fresh page of the game with the test's clock, stepped to world tick 40 and launched. */
async function launched(browser: Browser, url: string, errors: string[]) {
  const context = await browser.newContext({ viewport: { width: 640, height: 520 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()} (${msg.location().url})`);
  });
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  await page.addInitScript(() => {
    const queue: FrameRequestCallback[] = [];
    const w = window as unknown as { __frames(n: number): void };
    window.requestAnimationFrame = (cb) => queue.push(cb);
    window.cancelAnimationFrame = () => {};
    let now = 0;
    let started = false;
    performance.now = () => now;
    w.__frames = (n) => {
      for (let i = 0; i < n; i++) {
        if (started) now += 1000 / 60 + 0.001;
        started = true;
        for (const cb of queue.splice(0)) cb(now);
      }
    };
  });
  await page.goto(`${url}${GAME}`);
  await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
  expect(await page.evaluate(() => document.body.dataset.backend), errors.join('\n')).toBe('canvas2d');
  const frames = (n: number) =>
    page.evaluate((n) => (window as unknown as { __frames(n: number): void }).__frames(n), n);
  await frames(1); // the loop's first frame: no step

  for (let i = 0; i < 400 && (await hook(page, 'tick')) < 40; i++) await frames(1);
  expect(await hook(page, 'tick')).toBe(40);
  expect(await page.locator('#launch').textContent()).toBe('Launch: Burn the siege engines');
  await page.click('#launch');
  await frames(1);
  expect(await hook(page, 'choice')).toBe('sabotage');
  // Nothing moves while the choice waits.
  await frames(STEPS_PER_TICK * 5);
  expect(await hook(page, 'tick')).toBe(40);
  expect(await page.locator('#play').isVisible()).toBe(true);
  expect(await page.locator('#delegate').isVisible()).toBe(true);
  return { page, frames };
}

/** Steps tick by tick until the mission commits; returns the world tick it committed at. */
async function toCommit(page: Page, frames: (n: number) => Promise<void>): Promise<number> {
  for (let i = 0; i < 300 && (await hook(page, 'outcomes')).length === 0; i++) await frames(STEPS_PER_TICK);
  return hook(page, 'tick');
}

describe.skipIf(missing !== null)('the mini siege page (headless Chromium)', () => {
  it('is in the launcher, and plays the mission both ways from its link', async () => {
    const dist = join(temp, 'dist');
    const server = await serveBuilt('/', dist);
    const browser = await launch();
    const errors: string[] = [];
    try {
      const launcher = await browser.newPage();
      await launcher.goto(server.url);
      expect(await launcher.locator(`#games a[href="${GAME}"]`).count()).toBe(1);
      await launcher.close();

      // Delegated: the world draws seed 11's outcome at the commit tick.
      {
        const { page, frames } = await launched(browser, server.url, errors);
        await page.click('#delegate');
        await frames(1);
        expect(await hook(page, 'choice')).toBeNull();
        expect(await hook(page, 'playing')).toBe(false);
        expect(await toCommit(page, frames)).toBe(160);
        expect(await hook(page, 'outcomes')).toEqual(['ram-burnt']);
        expect(await page.locator('#status').textContent()).toContain('tick 160');
      }

      // Played: the recorded round typed on the keyboard burns both engines; the world waits.
      {
        const { page, frames } = await launched(browser, server.url, errors);
        const steps = recordedRound().steps;
        await page.click('#play');
        let held: string[] = [];
        let next = 0;
        let ticks = 0;
        for (; ticks < 2000; ticks++) {
          while (next < steps.length && steps[next]!.frame <= ticks) {
            const hold = steps[next]!.hold.map((a) => KEYS[a]!);
            for (const k of held) if (!hold.includes(k)) await page.keyboard.up(k);
            for (const k of hold) if (!held.includes(k)) await page.keyboard.down(k);
            held = hold;
            next++;
          }
          await frames(1);
          if (ticks === 0) expect(await hook(page, 'playing')).toBe(true);
          else if (!(await hook(page, 'playing'))) break;
        }
        for (const k of held) await page.keyboard.up(k);
        expect(ticks + 1).toBe(406);
        expect(await hook(page, 'tick')).toBe(40);
        expect(await toCommit(page, frames)).toBe(160);
        expect(await hook(page, 'outcomes')).toEqual(['both-burnt']);
      }
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 300_000);
});
