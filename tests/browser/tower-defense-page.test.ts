import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import type { InputScript } from '@engine/core/input/scripted-input';
import type { DebugWindow } from '@engine/core/shell';
import { screenAtCell } from '@kits/towerdefense';
import { browserMissing, launch, ROOT, serveBuilt } from './serve';

// The tower-defense sample played from a link (docs/ROADMAP.md, 0.12 "done when": the
// tower-defense sample plays from a link). The repo is built as `pnpm build` builds it and served
// as `pnpm preview` serves it; headless Chromium finds games/samples/tower-defense/ in the
// launcher and opens it twice:
//
// - by taps: two clicks on a build cell place an arrow tower, the bar's Wave button starts wave 1,
//   and the tower shoots and kills runners;
// - by keys: the `won` run file's input typed on the keyboard, one game tick at a time, places
//   four arrows and a cannon, starts every wave with Enter and wins the round at tick 673 with all
//   5 lives, as `pnpm cli run` says.
//
// The page runs in manual-loop mode (`?debug=step`, one loop step per `window.__ww.step(1)`), so the
// game is the same every time. No page errors either way. Skipped where Chromium is not installed
// (never in CI).

const GAME = 'games/samples/tower-defense/';
/** Loop steps per game tick (`STEPS_PER_TICK` in play.ts). */
const STEPS_PER_TICK = 2;
/** The keys the shell binds to each action (`engine/core/input/bindings.ts`). */
const KEYS: Record<string, string> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  jump: 'KeyZ',
  attack: 'KeyX',
  special: 'KeyC',
  start: 'Enter',
};

interface Hook {
  tick(): number;
  kit(): Record<string, number | string>;
  cursor(): { col: number; row: number; tower: string };
}

const wonInput = (): InputScript =>
  (JSON.parse(readFileSync(join(ROOT, GAME, 'runs/won.run.json'), 'utf8')) as { input: InputScript }).input;

const missing = await browserMissing();
if (missing) console.warn(`skipping the tower-defense page test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-tower-defense-page-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

/** Calls `window.wwTd[name](...args)` on the page. */
function hook<K extends keyof Hook>(
  page: Page,
  name: K,
  ...args: Parameters<Hook[K]>
): Promise<ReturnType<Hook[K]>> {
  return page.evaluate(
    ([name, args]) =>
      (window as unknown as { wwTd: Record<string, (...a: unknown[]) => unknown> }).wwTd[name]!(...args),
    [name, args] as const,
  ) as Promise<ReturnType<Hook[K]>>;
}

/**
 * A fresh page of the game in manual-loop mode (no step yet); `fromIndex` first opens the games
 * index and follows its link to the game (Engine 0.15 T14), then asks that page for the mode.
 */
async function open(browser: Browser, url: string, errors: string[], fromIndex = false) {
  const context = await browser.newContext({ viewport: { width: 640, height: 560 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()} (${msg.location().url})`);
  });
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  if (fromIndex) {
    await page.goto(url);
    const link = page.locator(`#games a[href="${GAME}"]`);
    expect(await link.count()).toBe(1);
    expect(await link.locator('xpath=..').textContent()).toContain('The Winding Road');
    await link.click();
    await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
    expect(new URL(page.url()).pathname).toBe(`/${GAME}`);
  }
  await page.goto(`${url}${GAME}?debug=step`); // manual-loop mode: `window.__ww.step(n)`
  await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
  expect(await page.evaluate(() => document.body.dataset.backend), errors.join('\n')).toBe('canvas2d');
  // The shell's volume control (gap M1).
  expect(await page.locator('#ww-volume').count()).toBe(1);
  /** `n` game ticks (`STEPS_PER_TICK` loop steps each). */
  const ticks = (n: number) =>
    page.evaluate((n) => void (window as DebugWindow).__ww!.step(n), n * STEPS_PER_TICK);
  return { page, ticks };
}

describe.skipIf(missing !== null)('the tower-defense page (headless Chromium)', () => {
  it('is in the games index, and plays from its link by taps and by keys', async () => {
    const dist = join(temp, 'dist');
    const server = await serveBuilt('/', dist);
    const browser = await launch();
    const errors: string[] = [];
    try {
      const launcher = await browser.newPage();
      await launcher.goto(server.url);
      expect(await launcher.locator(`#games a[href="${GAME}"]`).count()).toBe(1);
      await launcher.close();

      // By taps: a tap moves the cursor to a build cell, a second one places an arrow there.
      {
        const { page, ticks } = await open(browser, server.url, errors, true);
        await ticks(1);
        expect(await hook(page, 'tick')).toBe(1);
        // The cell's centre (the kit's `screenAtCell` on the 256x240 picture over the 16x15 map),
        // on the page through the display's `toClient` (gap D13).
        const cell = screenAtCell(
          { col: 5, row: 4 },
          { size: { width: 256, height: 240 } },
          { cols: 16, rows: 15 },
        );
        const at = (await page.evaluate(([x, y]) => (window as DebugWindow).__ww!.toClient(x, y), [
          cell.x,
          cell.y,
        ] as const))!;
        await page.mouse.click(at.x, at.y);
        await ticks(1);
        expect(await hook(page, 'cursor')).toEqual({ col: 5, row: 4, tower: 'arrow' });
        await page.mouse.click(at.x, at.y);
        await ticks(1);
        expect(await hook(page, 'kit')).toMatchObject({ towers: 1, gold: 30, wave: 0 });
        await page.click('#wave');
        await ticks(1);
        expect(await hook(page, 'kit')).toMatchObject({ wave: 1 });
        for (let i = 0; i < 200 && (await hook(page, 'kit')).killed === 0; i++) await ticks(5);
        const kit = await hook(page, 'kit');
        expect(kit.killed).toBeGreaterThan(0);
        expect(kit.gold).toBeGreaterThan(30);
        expect(await page.locator('#status').textContent()).toMatch(/^tick \d+/);
        await page.close();
      }

      // By keys: the won run's input, typed one tick at a time.
      {
        const { page, ticks } = await open(browser, server.url, errors);
        const steps = wonInput().steps;
        let held: string[] = [];
        let next = 0;
        for (let tick = 0; tick < 700; tick++) {
          while (next < steps.length && steps[next]!.frame <= tick) {
            const hold = steps[next]!.hold.map((a) => KEYS[a]!);
            for (const k of held) if (!hold.includes(k)) await page.keyboard.up(k);
            for (const k of hold) if (!held.includes(k)) await page.keyboard.down(k);
            held = hold;
            next++;
          }
          await ticks(1);
          if (tick === 24) expect(await hook(page, 'kit')).toMatchObject({ towers: 2, wave: 1 });
          if (tick === 672) expect((await hook(page, 'kit')).outcome).toBe('won');
          if (tick === 671) expect((await hook(page, 'kit')).outcome).toBe('playing');
        }
        for (const k of held) await page.keyboard.up(k);
        expect(await hook(page, 'tick')).toBe(700);
        expect(await hook(page, 'kit')).toMatchObject({
          outcome: 'won',
          lives: 5,
          leaked: 0,
          killed: 21,
          gold: 33,
        });
        expect(await page.locator('#status').textContent()).toContain('the road is held!');
        await page.close();
      }
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 300_000);
});
