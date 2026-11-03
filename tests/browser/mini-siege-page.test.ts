import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { InputScript } from '@engine/core/input/scripted-input';
import type { DebugWindow } from '@engine/core/shell';
import { browserMissing, launch, ROOT, serveBuilt } from './serve';

// The mini siege played from a link (docs/ROADMAP.md, 0.11 "done when": played from a link in a
// few minutes, by playing the mission and by delegating it, and both paths change the battle the
// way the design says). The repo is built as `pnpm build` builds it and served as `pnpm preview`
// serves it; headless Chromium finds games/samples/mini-siege/ in the launcher, opens it and, on
// two fresh pages, clicks the bar's Launch button at world tick 40 and then Delegate (seed 11
// draws `ram-burnt`) or Play (the recorded round of `played.run.json` typed on the keyboard, which
// burns both engines). On both paths the battle holds still while the choice waits, the result
// commits at world tick 160 (40 + the mission's cost of 120) and the hall ends as the run files
// say. The page runs in manual-loop mode (`?debug=step`; one loop step per `window.__ww.step(1)`), so the
// game is the same every time. Skipped where Chromium is not installed (never in CI).
//
// Engine 0.12 T8 (the preparation phase, docs/ROADMAP.md 0.12 "done when": the mini siege offers
// it): on three more fresh pages the bar's `Launch: Man the walls` button (offered from world tick
// 5) is clicked at tick 10, then Delegate (seed 11 draws `overrun`), or Play with the recorded
// round of `fortify-played.run.json` typed on the keyboard (archers on two walls, then the wave:
// `held-cheap`, the gold down 40), or Play with two taps on a wall placing archers, a right click
// selling them and Backspace giving up (`overrun`, the mission's onQuit). Each commits at world
// tick 40 (10 + the mission's cost of 30).
//
// Engine 0.13 T8 (the campaign, docs/ROADMAP.md 0.13): on two more pages the siege is played to
// its end at world tick 260 along both captain fates (Delegate: `ram-burnt`, the captain on the
// map; Play then Backspace: `driven-off`, the captain captured). The result panel shows the save
// code the run files pin; Continue plays the dawn assault, with the captain on the map, or held
// with the three captive choices in the bar (the exchange decided: no Play, only Decide). A page
// in the same browser carries on from the stored save; a fresh page refuses a bad code with its
// reason and resumes the dawn from the quit siege's code.

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
  jump: 'KeyZ',
  special: 'KeyC',
  start: 'Enter',
  select: 'Backspace',
};

interface Hook {
  tick(): number;
  scenario(): string;
  ended(): { code: string | null; next: string | null; done: boolean; people: string[] } | null;
  named(): Record<string, { alive: boolean; hp: number | null; fate?: string }>;
  captive(): string;
  choice(): string | null;
  playing(): boolean;
  outcomes(): string[];
  miniGame(): string;
  round(): Record<string, unknown> | null;
  clientAt(col: number, row: number): { x: number; y: number };
}

/** The save code a run file pins at its last tick. */
const pinnedCode = (run: string): string =>
  (
    JSON.parse(readFileSync(join(ROOT, GAME, `runs/${run}.run.json`), 'utf8')) as {
      codes: { code: string }[];
    }
  ).codes.at(-1)!.code;

const recordedRound = (run = 'played'): InputScript =>
  (
    JSON.parse(readFileSync(join(ROOT, GAME, `runs/${run}.run.json`), 'utf8')) as {
      missions: { action: string; input?: InputScript }[];
    }
  ).missions.find((m) => m.action === 'play')!.input!;

const missing = await browserMissing();
if (missing) console.warn(`skipping the mini siege page test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-mini-siege-page-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

/** Calls `window.wwSiege[name](...args)` on the page. */
function hook<K extends keyof Hook>(
  page: Page,
  name: K,
  ...args: Parameters<Hook[K]>
): Promise<ReturnType<Hook[K]>> {
  return page.evaluate(
    ([name, args]) =>
      (window as unknown as { wwSiege: Record<string, (...a: unknown[]) => unknown> }).wwSiege[name]!(
        ...args,
      ),
    [name, args] as const,
  ) as Promise<ReturnType<Hook[K]>>;
}

/** What to launch, when, and the button's title. */
interface Launch {
  mission: string;
  tick: number;
  title: string;
}
const SABOTAGE: Launch = { mission: 'sabotage', tick: 40, title: 'Burn the siege engines' };
const FORTIFY: Launch = { mission: 'fortify', tick: 10, title: 'Man the walls' };

/** A fresh page of the game in manual-loop mode (a new browser context unless one is given). */
async function opened(browser: Browser, url: string, errors: string[], context?: BrowserContext) {
  context ??= await browser.newContext({ viewport: { width: 640, height: 520 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()} (${msg.location().url})`);
  });
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  await page.goto(`${url}${GAME}?debug=step`); // manual-loop mode: `window.__ww.step(n)`
  await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
  expect(await page.evaluate(() => document.body.dataset.backend), errors.join('\n')).toBe('canvas2d');
  const frames = (n: number) => page.evaluate((n) => void (window as DebugWindow).__ww!.step(n), n);
  return { page, frames, context };
}

/** A fresh page of the game, stepped to the launch tick and launched. */
async function launched(browser: Browser, url: string, errors: string[], at: Launch = SABOTAGE) {
  const { page, frames, context } = await opened(browser, url, errors);
  for (let i = 0; i < 400 && (await hook(page, 'tick')) < at.tick; i++) await frames(1);
  expect(await hook(page, 'tick')).toBe(at.tick);
  // One button per offered mission (the RTS kit's missionButtons): at 10 and at 40 only one.
  expect(await page.locator('#launches button').count()).toBe(1);
  expect(await page.locator(`#launch-${at.mission}`).textContent()).toBe(`Launch: ${at.title}`);
  await page.click(`#launch-${at.mission}`);
  await frames(1);
  expect(await hook(page, 'choice')).toBe(at.mission);
  expect(await page.locator('#launches button').count()).toBe(0);
  // Nothing moves while the choice waits.
  await frames(STEPS_PER_TICK * 5);
  expect(await hook(page, 'tick')).toBe(at.tick);
  expect(await page.locator('#play').isVisible()).toBe(true);
  expect(await page.locator('#delegate').isVisible()).toBe(true);
  return { page, frames, context };
}

/** Steps tick by tick until the mission commits; returns the world tick it committed at. */
async function toCommit(page: Page, frames: (n: number) => Promise<void>): Promise<number> {
  for (let i = 0; i < 300 && (await hook(page, 'outcomes')).length === 0; i++) await frames(STEPS_PER_TICK);
  return hook(page, 'tick');
}

/**
 * Types a recorded round on the keyboard, one loop step (one round tick) per frame, until the
 * round ends; returns the round's ticks. The round is `game` from its first tick.
 */
async function typeRound(
  page: Page,
  frames: (n: number) => Promise<void>,
  round: InputScript,
  game: string,
): Promise<number> {
  const steps = round.steps;
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
    if (ticks === 0) {
      expect(await hook(page, 'playing')).toBe(true);
      expect(await hook(page, 'miniGame')).toBe(game);
    } else if (!(await hook(page, 'playing'))) break;
  }
  for (const k of held) await page.keyboard.up(k);
  return ticks + 1;
}

/** Steps until the campaign entry played now ends; returns the world tick it ended at. */
async function toEntryEnd(page: Page, frames: (n: number) => Promise<void>): Promise<number> {
  for (let i = 0; i < 100 && (await hook(page, 'ended')) === null; i++) await frames(STEPS_PER_TICK * 5);
  expect(await hook(page, 'ended')).not.toBeNull();
  return hook(page, 'tick');
}

/** Clicks Continue on the result panel and checks the dawn starts at tick 0. */
async function toDawn(page: Page, frames: (n: number) => Promise<void>): Promise<void> {
  expect(await page.locator('#continue').textContent()).toBe('Continue: The dawn assault');
  await page.click('#continue');
  await frames(2);
  expect(await hook(page, 'scenario')).toBe('dawn');
  expect(await page.locator('#result').isVisible()).toBe(false);
  expect(await hook(page, 'tick')).toBeLessThanOrEqual(1);
}

describe.skipIf(missing !== null)('the mini siege page (headless Chromium)', () => {
  it('is in the launcher, and plays both missions both ways from its link', async () => {
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
        await page.click('#play');
        expect(await typeRound(page, frames, recordedRound(), 'mission-room')).toBe(406);
        expect(await hook(page, 'tick')).toBe(40);
        expect(await toCommit(page, frames)).toBe(160);
        expect(await hook(page, 'outcomes')).toEqual(['both-burnt']);
      }

      // The preparation phase, delegated: seed 11 draws overrun at world tick 40.
      {
        const { page, frames } = await launched(browser, server.url, errors, FORTIFY);
        await page.click('#delegate');
        await frames(1);
        expect(await hook(page, 'playing')).toBe(false);
        expect(await toCommit(page, frames)).toBe(40);
        expect(await hook(page, 'outcomes')).toEqual(['overrun']);
        expect(await page.locator('#status').textContent()).toContain('tick 40');
      }

      // The preparation phase, played: the recorded round typed on the keyboard holds the walls.
      {
        const { page, frames } = await launched(browser, server.url, errors, FORTIFY);
        await page.click('#play');
        expect(await typeRound(page, frames, recordedRound('fortify-played'), 'td-defence')).toBe(116);
        expect(await hook(page, 'tick')).toBe(10);
        expect(await toCommit(page, frames)).toBe(40);
        expect(await hook(page, 'outcomes')).toEqual(['held-cheap']);
      }

      // The preparation phase by taps: two taps on the north tower's wall place archers, a right
      // click sells them, then Backspace gives up (the mission's onQuit, overrun).
      {
        const { page, frames } = await launched(browser, server.url, errors, FORTIFY);
        await page.click('#play');
        await frames(1);
        expect(await hook(page, 'miniGame')).toBe('td-defence');
        expect(await page.locator('#status').textContent()).toContain('a tap');
        expect(await hook(page, 'round')).toMatchObject({ gold: 100, towers: 0 });
        const at = await hook(page, 'clientAt', 11, 1);
        await page.mouse.click(at.x, at.y);
        await frames(1);
        await page.mouse.click(at.x, at.y);
        await frames(1);
        expect(await hook(page, 'round')).toMatchObject({ gold: 80, towers: 1 });
        await page.mouse.click(at.x, at.y, { button: 'right' });
        await frames(1);
        expect(await hook(page, 'round')).toMatchObject({ gold: 90, towers: 0 });
        await page.keyboard.down('Backspace');
        await frames(1);
        await page.keyboard.up('Backspace');
        expect(await hook(page, 'playing')).toBe(false);
        expect(await toCommit(page, frames)).toBe(40);
        expect(await hook(page, 'outcomes')).toEqual(['overrun']);
      }
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 600_000);
  it('plays the campaign from its link along both captain fates, and resumes from a save code', async () => {
    const dist = join(temp, 'dist-campaign');
    const server = await serveBuilt('/', dist);
    const browser = await launch();
    const errors: string[] = [];
    try {
      // The captain kept: the sabotage delegated, the siege ends at 260 with the delegated run's code.
      {
        const { page, frames } = await launched(browser, server.url, errors);
        await page.click('#delegate');
        expect(await toEntryEnd(page, frames)).toBe(260);
        expect(await hook(page, 'outcomes')).toEqual(['ram-burnt']);
        expect(await page.locator('#result').isVisible()).toBe(true);
        expect(await page.locator('#result-code').textContent()).toBe(pinnedCode('delegated'));
        expect(await page.locator('#result').textContent()).toContain('Captain Hale: active, 110/120 hp');
        await toDawn(page, frames);
        expect((await hook(page, 'named'))['captain']).toMatchObject({ alive: true, hp: 110 });
        expect(await hook(page, 'captive')).toBe('');
        expect(await page.locator('#launches button').count()).toBe(0);
        expect(await toEntryEnd(page, frames)).toBe(200);
        expect(await hook(page, 'ended')).toMatchObject({ done: true, next: null });
        expect(await page.locator('#continue').textContent()).toBe('Play again');
        expect(await page.locator('#result').textContent()).toContain('The campaign is over.');
      }

      // The captain taken: the sabotage played and given up, the siege ends with the quit run's code.
      {
        const { page, frames, context } = await launched(browser, server.url, errors);
        await page.click('#play');
        await frames(1);
        await page.keyboard.down('Backspace');
        await frames(1);
        await page.keyboard.up('Backspace');
        expect(await hook(page, 'playing')).toBe(false);
        expect(await toEntryEnd(page, frames)).toBe(260);
        expect(await hook(page, 'outcomes')).toEqual(['driven-off']);
        expect(await page.locator('#result-code').textContent()).toBe(pinnedCode('quit'));
        expect(await page.locator('#result').textContent()).toContain('Captain Hale: captured, 90/120 hp');

        // Another page in the same browser offers the stored campaign.
        {
          const later = await opened(browser, server.url, errors, context);
          expect(await later.page.locator('#stored').textContent()).toBe('Carry on: The dawn assault');
          await later.page.click('#stored');
          await later.frames(2);
          expect(await hook(later.page, 'scenario')).toBe('dawn');
          expect(await hook(later.page, 'captive')).toBe('Captain Hale');
          await later.page.close();
        }

        await toDawn(page, frames);
        expect((await hook(page, 'named'))['captain']).toMatchObject({ alive: true, fate: 'captured' });
        expect(await hook(page, 'captive')).toBe('Captain Hale');
        const offered = await page
          .locator('#launches button')
          .evaluateAll((bs) => bs.map((b) => b.id).sort());
        expect(offered).toEqual(['launch-exchange-captain', 'launch-leave-captain', 'launch-rescue-captain']);
        for (let i = 0; i < 100 && (await hook(page, 'tick')) < 5; i++) await frames(1);
        expect(await hook(page, 'tick')).toBe(5);
        await page.click('#launch-exchange-captain');
        await frames(1);
        expect(await hook(page, 'choice')).toBe('exchange-captain');
        expect(await page.locator('#play').isVisible()).toBe(false);
        expect(await page.locator('#delegate').textContent()).toBe('Decide');
        await page.click('#delegate');
        await frames(1);
        expect(await toCommit(page, frames)).toBe(15);
        expect(await hook(page, 'outcomes')).toEqual(['paid']);
        expect((await hook(page, 'named'))['captain']).toMatchObject({ fate: 'freed' });
        expect(await hook(page, 'captive')).toBe('');
        expect(await toEntryEnd(page, frames)).toBe(200);
      }

      // A save code typed on a fresh page: a bad one refused with its reason, the quit's resumed.
      {
        const { page, frames } = await opened(browser, server.url, errors);
        expect(await page.locator('#stored').isVisible()).toBe(false);
        await page.fill('#code', 'NOT-A-USABLE-CODE');
        await page.click('#resume');
        await frames(1);
        expect(await page.locator('#status').textContent()).toContain('code_typo');
        expect(await hook(page, 'scenario')).toBe('village');
        await page.fill('#code', pinnedCode('quit').toLowerCase());
        await page.press('#code', 'Enter');
        await frames(1);
        expect(await page.locator('#status').textContent()).not.toContain('code_');
        expect(await hook(page, 'scenario')).toBe('dawn');
        expect(await hook(page, 'tick')).toBe(0);
        expect(await hook(page, 'captive')).toBe('Captain Hale');
        expect(await page.locator('#launches button').count()).toBe(3);
      }
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 600_000);
});
