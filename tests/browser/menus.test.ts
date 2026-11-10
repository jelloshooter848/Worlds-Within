import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import type { DebugWindow, MenusView } from '@engine/core/shell';
import { browserMissing, launch, serveBuilt } from './serve';

// The shell's menus in the browser (Engine 0.16 T9): every sample and the fx lab open on their
// title screen (`?debug=step&title=show`: the step hook with the title shown, which `?debug=step`
// alone skips), start, pause and show their settings and controls, by keyboard (Enter, Escape,
// arrows) and on a touch page (taps aimed through `__ww.toClient` at the item boxes `__ww.menus()`
// reports, and the on-screen `#ww-pause` button). The game's state hash does not move while the
// title or the pause menu shows. Changed settings (screen shake, mute, reduced flashing) are kept
// in browser storage and read back after a reload. Each page's title, pause and settings screens
// are shot to `WW_SHOTS_DIR` when set (to look at them), else a temp folder. Skipped where
// Chromium is not installed (never in CI).

const GAMES = [
  'games/samples/platformer/',
  'games/samples/dungeon/',
  'games/samples/rts-skirmish/',
  'games/samples/tower-defense/',
  'games/samples/mini-siege/',
  'games/fx-lab/',
];

const missing = await browserMissing();
if (missing) console.warn(`skipping the menus test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-menus-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
const shots = process.env.WW_SHOTS_DIR ?? temp;

let built: Promise<{ url: string; close(): Promise<void> }> | null = null;
const serve = () => (built ??= serveBuilt('/', join(temp, 'dist')));
afterAll(async () => {
  if (built) await (await built).close();
});

const step = (page: Page, n = 1) => page.evaluate((n) => (window as DebugWindow).__ww!.step(n), n);
const menus = (page: Page) =>
  page.evaluate(() => (window as DebugWindow).__ww!.menus()) as Promise<MenusView>;
const hash = (page: Page) => page.evaluate(() => (window as DebugWindow).__ww!.hash());

/** A key pressed and released, then two steps (the press, and a frame without it). */
async function key(page: Page, code: string): Promise<void> {
  await page.keyboard.press(code);
  await step(page, 2);
}

/** Steps until the menus' state is `state` (at most `max` steps). */
async function until(page: Page, state: MenusView['state'], max = 200): Promise<void> {
  for (let i = 0; i < max && (await menus(page)).state !== state; i++) await step(page, 1);
  expect((await menus(page)).state).toBe(state);
}

/** Moves the focus to `item` with the arrows. */
async function focus(page: Page, item: string): Promise<void> {
  for (let i = 0; i < 12 && (await menus(page)).focused !== item; i++) await key(page, 'ArrowDown');
  expect((await menus(page)).focused).toBe(item);
}

const value = async (page: Page, item: string) => (await menus(page)).items.find((i) => i.id === item)?.value;

async function open(browser: Browser, url: string, touch = false) {
  const wide = url.includes('rts-skirmish');
  const page = await browser.newPage({
    viewport: { width: wide ? 640 : 512, height: 480 },
    deviceScaleFactor: 1,
    ...(touch && { hasTouch: true, isMobile: true }),
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  await page.goto(url);
  await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
  return { page, errors };
}

describe.skipIf(missing !== null)('the title, pause and settings screens (headless Chromium)', () => {
  it.each(GAMES)(
    '%s: title, start, pause, settings and controls by keyboard; settings kept across a reload',
    async (game) => {
      const server = await serve();
      const browser = await launch();
      const name = game.split('/').at(-2)!;
      try {
        const { page, errors } = await open(browser, `${server.url}${game}?debug=step&title=show`);
        await step(page, 30);
        const title = await menus(page);
        expect([title.state, title.screen, title.focused]).toEqual(['title', 'title', 'start']);
        expect(await page.evaluate(() => document.body.dataset.menu)).toBe('title');
        expect(await page.isVisible('#ww-pause')).toBe(false);
        const atStart = await hash(page);
        await step(page, 30);
        expect(await hash(page)).toBe(atStart); // the title holds the game at its start
        await page.screenshot({ path: join(shots, `menus-${name}-title.png`) });

        await key(page, 'Enter');
        await until(page, 'play');
        expect(await page.isVisible('#ww-pause')).toBe(true);
        await step(page, 10);

        await key(page, 'Escape');
        const pause = await menus(page);
        expect([pause.state, pause.screen, pause.focused]).toEqual(['pause', 'pause', 'resume']);
        const paused = await hash(page);
        await step(page, 30);
        expect(await hash(page)).toBe(paused); // the ticks are held
        await page.screenshot({ path: join(shots, `menus-${name}-pause.png`) });

        await focus(page, 'settings');
        await key(page, 'Enter');
        expect((await menus(page)).screen).toBe('settings');
        await focus(page, 'shake');
        expect(await value(page, 'shake')).toBe(10);
        for (let i = 0; i < 3; i++) await key(page, 'ArrowLeft');
        expect(await value(page, 'shake')).toBe(7);
        await focus(page, 'mute');
        await key(page, 'Enter');
        expect(await value(page, 'mute')).toBe(true);
        await page.screenshot({ path: join(shots, `menus-${name}-settings.png`) });

        // Escape backs out to the pause menu, then Controls, then Escape twice resumes.
        await key(page, 'Escape');
        expect((await menus(page)).screen).toBe('pause');
        await focus(page, 'controls');
        await key(page, 'Enter');
        expect((await menus(page)).screen).toBe('controls');
        await page.screenshot({ path: join(shots, `menus-${name}-controls.png`) });
        await key(page, 'Escape');
        await key(page, 'KeyP');
        expect((await menus(page)).state).toBe('play');
        expect(errors).toEqual([]);

        // A reload keeps the settings (the title skipped: `?debug=step`).
        await page.goto(`${server.url}${game}?debug=step`);
        await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
        expect((await menus(page)).state).toBe('play');
        await key(page, 'Escape');
        await focus(page, 'settings');
        await key(page, 'Enter');
        expect(await value(page, 'shake')).toBe(7);
        expect(await value(page, 'mute')).toBe(true);
        expect(await page.locator('#ww-mute').getAttribute('aria-pressed')).toBe('true');
        await page.close();
      } finally {
        await browser.close();
      }
    },
    180_000,
  );

  it.each(GAMES)(
    '%s: the same by touch: taps on the items and the on-screen pause button',
    async (game) => {
      const server = await serve();
      const browser = await launch();
      try {
        const { page, errors } = await open(browser, `${server.url}${game}?debug=step&title=show`, true);
        await step(page, 5);
        /** Taps the item's centre on the picture. */
        const tap = async (item: string) => {
          const box = (await menus(page)).items.find((i) => i.id === item)!;
          const at = (await page.evaluate(({ x, y }) => (window as DebugWindow).__ww!.toClient(x, y), {
            x: box.x + box.w / 2,
            y: box.y + box.h / 2,
          }))!;
          await page.touchscreen.tap(at.x, at.y);
          await step(page, 2);
        };
        expect((await menus(page)).state).toBe('title');
        await tap('start');
        await until(page, 'play');
        await page.tap('#ww-pause');
        await step(page, 1);
        expect((await menus(page)).screen).toBe('pause');
        await tap('settings');
        expect((await menus(page)).screen).toBe('settings');
        expect(await value(page, 'flashing')).toBe(false);
        await tap('flashing');
        expect(await value(page, 'flashing')).toBe(true);
        await tap('back');
        expect((await menus(page)).screen).toBe('pause');
        await tap('resume');
        expect((await menus(page)).state).toBe('play');
        expect(errors).toEqual([]);
        const stored = await page.evaluate(
          (id) => localStorage.getItem(`ww:${id}:settings`),
          game.includes('fx-lab') ? 'fx-lab' : game.split('/').at(-2)!,
        );
        expect(JSON.parse(stored!)).toMatchObject({ reduceFlashing: true });
        await page.close();
      } finally {
        await browser.close();
      }
    },
    180_000,
  );
});
