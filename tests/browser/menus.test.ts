import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import type { DebugWindow, MenusView } from '@engine/core/shell';
import { browserMissing, launch, ROOT, serveBuilt } from './serve';

// The shell's menus in the browser (Engine 0.16 T9): every sample and the fx lab open on their
// title screen (`?debug=step&title=show`: the step hook with the title shown, which `?debug=step`
// alone skips), start, pause and show their settings and controls, by keyboard (Enter, Escape,
// arrows) and on a touch page (taps aimed through `__ww.toClient` at the item boxes `__ww.menus()`
// reports, and the on-screen `#ww-pause` button). The game's state hash does not move while the
// title or the pause menu shows. Changed settings (screen shake, mute, reduced flashing) are kept
// in browser storage and read back after a reload. Each page's title, pause and settings screens
// are shot to `WW_SHOTS_DIR` when set (to look at them), else a temp folder. Skipped where
// Chromium is not installed (never in CI).
//
// Engine 0.16 part B (T3): the fx lab's level select, level-clear banner and end screen, by
// keyboard (the arrows and Enter on the title's Levels item; a level's run-file input played on
// the keys from the chosen level's tick 0 to its door), by gamepad (a fake standard pad behind
// `navigator.getGamepads`: the d-pad, A and B) and by touch (taps on the items). Locked levels are
// skipped by the focus until the stored progress (`ww:fx-lab:progress`) unlocks them; clearing a
// level stores it. Each screen is shot as `menus-fx-lab-<screen>.png`.

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

  describe('the fx lab: level select, level-clear banner and end screen', () => {
    const FX = 'games/fx-lab/';
    /** Keys for the run files' actions (`run` is held with the attack key, which also runs). */
    const KEYS: Record<string, string> = {
      left: 'ArrowLeft',
      right: 'ArrowRight',
      jump: 'KeyZ',
      run: 'KeyX',
    };
    const script = (run: string) =>
      (
        JSON.parse(readFileSync(join(ROOT, FX, 'runs', run), 'utf8')) as {
          input: { steps: { frame: number; hold: string[] }[] };
        }
      ).input.steps;
    const level = (page: Page) =>
      page.evaluate(() => {
        const s = (window as DebugWindow).__ww!.snapshot() as {
          level: string;
          frame: number;
          outcome: string;
        };
        return { level: s.level, frame: s.frame, outcome: s.outcome };
      });

    /**
     * Plays a run file's input on the keyboard from the level's frame now, holding each step's
     * keys until the next step's frame, then until the level is cleared (the kit's frame stops).
     */
    async function drive(page: Page, run: string): Promise<void> {
      const steps = script(run);
      const held = new Set<string>();
      for (let i = 0; i < steps.length; i++) {
        const want = new Set(steps[i]!.hold.map((a) => KEYS[a]!));
        for (const k of held) if (!want.has(k)) await page.keyboard.up(k);
        for (const k of want) if (!held.has(k)) await page.keyboard.down(k);
        held.clear();
        for (const k of want) held.add(k);
        const next = steps[i + 1]?.frame;
        if (next === undefined) break;
        const { frame } = await level(page);
        if (next > frame) await step(page, next - frame);
      }
      for (let i = 0; i < 400 && (await level(page)).outcome === 'playing'; i++) await step(page, 2);
      for (const k of held) await page.keyboard.up(k);
      expect((await level(page)).outcome).toBe('cleared');
    }

    /** From the level select: choose `item`, with the run's first keys held as the level starts. */
    async function choose(page: Page, run: string, confirm: () => Promise<void>): Promise<void> {
      await confirm();
      for (const a of script(run)[0]!.hold) await page.keyboard.down(KEYS[a]!);
      await until(page, 'play');
    }

    it('by keyboard: locked levels skipped, a level chosen, the banner between levels, the end', async () => {
      const server = await serve();
      const browser = await launch();
      try {
        const { page, errors } = await open(browser, `${server.url}${FX}?debug=step&title=show`);
        await step(page, 30);
        await focus(page, 'levels');
        await key(page, 'Enter');
        const view = await menus(page);
        expect([view.screen, view.focused]).toEqual(['levels', 'level-0']);
        expect(view.items.map((i) => i.id)).toEqual(['level-0', 'level-1', 'level-2', 'back']);
        await key(page, 'ArrowDown'); // fx-2 and fx-3 are locked: straight to Back
        expect((await menus(page)).focused).toBe('back');
        await step(page, 20);
        await page.screenshot({ path: join(shots, 'menus-fx-lab-levels.png') });
        await key(page, 'Escape');
        expect([(await menus(page)).screen, (await menus(page)).focused]).toEqual(['title', 'levels']);

        // fx-1 cleared on an earlier visit: fx-2 opens.
        await page.evaluate(() => localStorage.setItem('ww:fx-lab:progress', '{"cleared":["fx-1"]}'));
        await key(page, 'Enter');
        await key(page, 'ArrowDown');
        expect((await menus(page)).focused).toBe('level-1');
        await choose(page, 'level-2.run.json', () => key(page, 'Enter'));
        expect((await level(page)).level).toBe('fx-2');
        await drive(page, 'level-2.run.json');
        await step(page, 2);
        expect((await menus(page)).banner).toBe(true);
        expect((await menus(page)).state).toBe('play'); // the banner takes no input
        await step(page, 20);
        await page.screenshot({ path: join(shots, 'menus-fx-lab-clear.png') });
        for (let i = 0; i < 80 && (await level(page)).level === 'fx-2'; i++) await step(page, 1);
        expect((await level(page)).level).toBe('fx-3'); // the kit's pause went on under it
        await step(page, 2);
        expect((await menus(page)).banner).toBe(false);
        const progress = await page.evaluate(() => localStorage.getItem('ww:fx-lab:progress'));
        expect(JSON.parse(progress!)).toEqual({ cleared: ['fx-1', 'fx-2'] });
        expect(errors).toEqual([]);
        await page.close();
      } finally {
        await browser.close();
      }
    }, 180_000);

    it('by gamepad: the level select and the end screen with the d-pad, A and B', async () => {
      const server = await serve();
      const browser = await launch();
      try {
        const page = await browser.newPage({ viewport: { width: 512, height: 480 }, deviceScaleFactor: 1 });
        // A fake standard pad: `window.__pad` holds the pressed button numbers.
        await page.addInitScript(() => {
          const w = window as unknown as { __pad: number[] };
          w.__pad = [];
          Object.defineProperty(navigator, 'getGamepads', {
            value: () => [
              {
                index: 0,
                connected: true,
                mapping: 'standard',
                axes: [0, 0, 0, 0],
                buttons: Array.from({ length: 17 }, (_, i) => ({
                  pressed: w.__pad.includes(i),
                  value: w.__pad.includes(i) ? 1 : 0,
                })),
              },
            ],
          });
        });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`${server.url}${FX}?debug=step&title=show`);
        await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
        await page.evaluate(() => localStorage.setItem('ww:fx-lab:progress', '{"cleared":["fx-1","fx-2"]}'));
        /** A pad button pressed for one step and released for one. */
        const pad = async (button: number) => {
          await page.evaluate((b) => ((window as unknown as { __pad: number[] }).__pad = [b]), button);
          await step(page, 1);
          await page.evaluate(() => ((window as unknown as { __pad: number[] }).__pad = []));
          await step(page, 1);
        };
        const A = 0;
        const B = 2;
        const DOWN = 13;
        const UP = 12;
        await step(page, 10);
        while ((await menus(page)).focused !== 'levels') await pad(DOWN);
        await pad(A);
        expect((await menus(page)).screen).toBe('levels');
        await pad(B);
        expect((await menus(page)).screen).toBe('title');
        await pad(A);
        await pad(DOWN);
        await pad(DOWN);
        expect((await menus(page)).focused).toBe('level-2');
        await choose(page, 'level-3.run.json', () => pad(A));
        expect((await level(page)).level).toBe('fx-3');
        await drive(page, 'level-3.run.json');
        await step(page, 3);
        let view = await menus(page);
        expect([view.state, view.screen, view.banner]).toEqual(['end', 'end', false]);
        expect(view.items.map((i) => i.id)).toEqual(['title', 'levels']);
        const held = await hash(page);
        await step(page, 30);
        expect(await hash(page)).toBe(held); // the end screen holds the game
        await page.screenshot({ path: join(shots, 'menus-fx-lab-end.png') });
        await pad(DOWN);
        await pad(A);
        expect((await menus(page)).screen).toBe('levels');
        await pad(B);
        view = await menus(page);
        expect([view.screen, view.focused]).toEqual(['end', 'levels']);
        await pad(UP);
        await pad(A);
        await until(page, 'title');
        const progress = await page.evaluate(() => localStorage.getItem('ww:fx-lab:progress'));
        expect(JSON.parse(progress!).cleared).toEqual(['fx-1', 'fx-2', 'fx-3']);
        expect(errors).toEqual([]);
        await page.close();
      } finally {
        await browser.close();
      }
    }, 180_000);

    it('by touch: taps on the level select and the end screen', async () => {
      const server = await serve();
      const browser = await launch();
      try {
        const { page, errors } = await open(browser, `${server.url}${FX}?debug=step&title=show`, true);
        await page.evaluate(() => localStorage.setItem('ww:fx-lab:progress', '{"cleared":["fx-1","fx-2"]}'));
        await step(page, 5);
        const tap = async (item: string) => {
          const box = (await menus(page)).items.find((i) => i.id === item)!;
          const at = (await page.evaluate(({ x, y }) => (window as DebugWindow).__ww!.toClient(x, y), {
            x: box.x + box.w / 2,
            y: box.y + box.h / 2,
          }))!;
          await page.touchscreen.tap(at.x, at.y);
          await step(page, 2);
        };
        await tap('levels');
        expect((await menus(page)).screen).toBe('levels');
        await tap('back');
        expect((await menus(page)).screen).toBe('title');
        await tap('levels');
        await choose(page, 'level-3.run.json', () => tap('level-2'));
        expect((await level(page)).level).toBe('fx-3');
        await drive(page, 'level-3.run.json');
        await step(page, 3);
        expect((await menus(page)).screen).toBe('end');
        await tap('title');
        await until(page, 'title');
        expect(errors).toEqual([]);
        await page.close();
      } finally {
        await browser.close();
      }
    }, 180_000);
  });
});
