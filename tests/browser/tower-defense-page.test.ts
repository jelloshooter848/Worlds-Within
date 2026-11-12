import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import type { InputScript } from '@engine/core/input/scripted-input';
import type { DebugWindow, MenusView } from '@engine/core/shell';
import { screenAtCell } from '@kits/towerdefense';
import { browserMissing, launch, ROOT, serveBuilt } from './serve';

// The tower-defense sample played from a link (docs/ROADMAP.md, 0.12 "done when": the
// tower-defense sample plays from a link). The repo is built as `pnpm build` builds it and served
// as `pnpm preview` serves it; headless Chromium finds games/samples/tower-defense/ in the
// launcher and opens it twice:
//
// - by taps: two clicks on a build cell place an arrow tower, the bar's Wave button starts wave 1,
//   and the tower shoots and kills runners;
// - the full game (Engine 0.16 E9): from the games index's link the page opens on the title; Start
//   (Enter) begins play on the live loop, where F and the shell's speed button cycle the speed (1x,
//   2x, 3x: more ticks a second, `body[data-speed]`). Then from the title in manual-loop mode
//   (`?debug=step&title=show`): Start, the `win` run file's input typed on the keyboard at its
//   ticks, thirteen towers built and upgraded, all ten waves sent with Enter and won at tick 3141
//   with 18 lives and three stars, as `pnpm cli run` says; the end trigger opens the end screen
//   (its jingle `road-won` playing) over the held game. The page's own recording
//   (`window.wwTd.recording()`) of those ticks is the run file's input.
//
// The played pages run in manual-loop mode (`?debug=step`, one loop step per `window.__ww.step(1)`),
// so the game is the same every time. It runs on its default backend, PixiJS (Engine 0.16 T13b-8).
// No page errors anywhere. Skipped where Chromium is not installed (never in CI).

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
  recording(): { ticks: number; input: InputScript };
}

const winRun = () =>
  JSON.parse(readFileSync(join(ROOT, GAME, 'runs/win.run.json'), 'utf8')) as {
    ticks: number;
    input: InputScript;
  };

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
async function open(
  browser: Browser,
  url: string,
  errors: string[],
  fromIndex = false,
  query = '?debug=step',
) {
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
  await page.goto(`${url}${GAME}${query}`); // manual-loop mode: `window.__ww.step(n)`
  await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
  // PixiJS by default (Engine 0.16 T13b-8; headless Chromium's SwiftShader counts as WebGL), so the
  // taps go through the PixiJS display's `toScreen` and `toClient`.
  expect(await page.evaluate(() => document.body.dataset.backend), errors.join('\n')).toBe('pixi');
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
        // The cell's centre (the kit's `screenAtCell` on the 480x270 picture over the 30x16 map),
        // on the page through the display's `toClient` (gap D13).
        const cell = screenAtCell(
          { col: 4, row: 4 },
          { size: { width: 480, height: 270 } },
          { cols: 30, rows: 16 },
        );
        const at = (await page.evaluate(([x, y]) => (window as DebugWindow).__ww!.toClient(x, y), [
          cell.x,
          cell.y,
        ] as const))!;
        await page.mouse.click(at.x, at.y);
        await ticks(1);
        expect(await hook(page, 'cursor')).toEqual({ col: 4, row: 4, tower: 'arrow' });
        await page.mouse.click(at.x, at.y);
        await ticks(1);
        expect(await hook(page, 'kit')).toMatchObject({ towers: 1, gold: 50, wave: 0 });
        await page.click('#wave');
        await ticks(1);
        expect(await hook(page, 'kit')).toMatchObject({ wave: 1 });
        for (let i = 0; i < 200 && (await hook(page, 'kit')).killed === 0; i++) await ticks(5);
        const kit = await hook(page, 'kit');
        expect(kit.killed).toBeGreaterThan(0);
        expect(kit.gold).toBeGreaterThan(50);
        expect(await page.locator('#status').textContent()).toMatch(/^tick \d+/);
        await page.close();
      }

      // From the games index's link: the title, Start, and the speed control on the live loop.
      {
        const context = await browser.newContext({ viewport: { width: 640, height: 560 } });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
        await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
        await page.goto(server.url);
        await page.locator(`#games a[href="${GAME}"]`).click();
        await page.waitForSelector('body[data-menu="title"]', { timeout: 60_000 });
        expect(await hook(page, 'tick')).toBe(0); // the game waits under the title
        await page.keyboard.press('Enter'); // Start
        await page.waitForSelector('body[data-menu="play"]', { timeout: 30_000 });
        /** Game ticks the live loop plays in `ms` of wall time. */
        const rate = async (ms: number) => {
          const from = await hook(page, 'tick');
          await page.waitForTimeout(ms);
          return (await hook(page, 'tick')) - from;
        };
        const speed = () => page.evaluate(() => document.body.dataset.speed);
        expect(await speed()).toBe('1');
        const normal = await rate(1000);
        expect(normal).toBeGreaterThan(0);
        await page.keyboard.press('KeyF');
        expect(await speed()).toBe('2');
        await page.click('#ww-speed');
        expect(await speed()).toBe('3');
        const fast = await rate(1000);
        expect(fast, `${normal} ticks a second at 1x, ${fast} at 3x`).toBeGreaterThan(normal * 1.5);
        await page.click('#ww-speed');
        expect(await speed()).toBe('1');
        await context.close();
      }

      // From the title (manual-loop mode with the title shown): Start, then the win run's input on
      // the keyboard, each step's keys pressed or released at its tick, to the end screen.
      {
        const { page, ticks } = await open(browser, server.url, errors, false, '?debug=step&title=show');
        const menus = () => page.evaluate(() => (window as DebugWindow).__ww!.menus()) as Promise<MenusView>;
        const step = (n: number) => page.evaluate((n) => void (window as DebugWindow).__ww!.step(n), n);
        await step(4);
        expect((await menus()).state).toBe('title');
        await page.keyboard.press('Enter'); // Start
        for (let i = 0; i < 60 && (await menus()).state !== 'play'; i++) await step(1);
        expect((await menus()).state).toBe('play');
        // Start on a tick's boundary: the game is still at tick 0 with its loop steps in step.
        while ((await hook(page, 'tick')) === 0) await step(1);
        expect(await hook(page, 'tick')).toBe(1);
        const run = winRun();
        const steps = run.input.steps;
        let held: string[] = [];
        let tick = 1;
        const to = async (t: number) => {
          if (t > tick) await ticks(t - tick);
          tick = Math.max(tick, t);
        };
        // Tick 1 was played with nothing held: the run's first step is at frame 0 (tick 1), so
        // the page plays the run shifted by one tick; its recording says so below.
        for (const s of steps) {
          await to(s.frame + 1);
          const hold = s.hold.map((a) => KEYS[a]!);
          for (const k of held) if (!hold.includes(k)) await page.keyboard.up(k);
          for (const k of hold) if (!held.includes(k)) await page.keyboard.down(k);
          held = hold;
        }
        for (const k of held) await page.keyboard.up(k);
        await to(3141);
        expect((await hook(page, 'kit')).outcome).toBe('playing');
        await to(3142);
        expect(await hook(page, 'kit')).toMatchObject({
          outcome: 'won',
          lives: 18,
          killed: 138,
          wave: 10,
          stars: 3,
        });
        // The end trigger: the end screen over the held game, its jingle playing.
        for (let i = 0; i < 40 && (await menus()).state === 'play'; i++) await step(2);
        expect([(await menus()).state, (await menus()).screen]).toEqual(['end', 'end']);
        expect(await page.evaluate(() => (window as DebugWindow).__ww!.mix()?.song)).toBe('road-won');
        const at = await hook(page, 'tick');
        await step(20);
        expect(await hook(page, 'tick')).toBe(at);
        expect(await page.locator('#status').textContent()).toContain('the road is held!');
        // The page's recording: one released tick, then the run's input.
        const recording = await hook(page, 'recording');
        expect(recording.input.steps.map((s) => ({ frame: s.frame - 1, hold: s.hold }))).toEqual(steps);
        await page.screenshot({ path: join(temp, 'tower-defense-end.png') });
        await page.close();
      }
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 300_000);
});
