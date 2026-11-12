import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import type { DebugWindow } from '../../engine/core/shell';
import { ROOT } from './serve';

// Drives the mini siege's page for the review-shot scripts (`siege-review-shots.ts`, polish P, and
// `siege-q-shots.ts`, polish Q): the page opened with `?debug=step` on a 1920x1080 window, stepped
// a loop step at a time and driven by its `wwSiege` hooks. Not a test.

export const GAME = 'games/samples/mini-siege/';
/** Loop steps per world tick (`STEPS_PER_TICK` in play.ts). */
export const STEPS_PER_TICK = 6;
/** Loop steps after a round starts by which the iris has opened on it. */
export const ROUND_SHOWN = 70;
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

type Box = { x: number; y: number; w: number; h: number };
export type Round = { steps: { frame: number; hold: string[] }[] };

/** The recorded round of a run file's play step. */
export const recorded = (run: string): Round =>
  (
    JSON.parse(readFileSync(join(ROOT, GAME, `runs/${run}.run.json`), 'utf8')) as {
      missions: { action: string; input?: Round }[];
    }
  ).missions.find((m) => m.action === 'play')!.input!;

/** Calls `window.wwSiege[name](...args)` on the page. */
export const hook = <T>(page: Page, name: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    ([name, args]) =>
      (window as unknown as { wwSiege: Record<string, (...a: unknown[]) => unknown> }).wwSiege[name]!(
        ...args,
      ),
    [name, args] as const,
  ) as Promise<T>;

/** Takes `n` loop steps. */
export const frames = (page: Page, n: number): Promise<void> =>
  page.evaluate((n) => void (window as DebugWindow).__ww!.step(n), n);

/** Clicks a mission screen's item in the picture, then (unless `step` is false) takes a loop step. */
export async function press(page: Page, item: string, step = true): Promise<void> {
  const box = await hook<Box | null>(page, 'itemBox', item);
  if (box === null) throw new Error(`no ${item} on the ${await hook<string>(page, 'screen')} screen`);
  const at = await page.evaluate(([x, y]) => (window as DebugWindow).__ww!.toClient(x, y)!, [
    box.x + box.w / 2,
    box.y + box.h / 2,
  ] as const);
  await page.mouse.click(at.x, at.y);
  if (step) await frames(page, 1);
}

/** Steps to world tick `tick`. */
export async function toTick(page: Page, tick: number): Promise<void> {
  const now = await hook<number>(page, 'tick');
  if (tick - now > 1) await frames(page, (tick - now - 1) * STEPS_PER_TICK);
  for (let i = 0; i < 60 && (await hook<number>(page, 'tick')) < tick; i++) await frames(page, 1);
  if ((await hook<number>(page, 'tick')) !== tick) throw new Error(`not at world tick ${tick}`);
}

/** Clicks Begin on the held entry's briefing and lets one world tick run. */
export async function begin(page: Page): Promise<void> {
  await press(page, 'begin');
  await frames(page, STEPS_PER_TICK);
}

/** Types the first `steps` loop steps of a recorded round on the keyboard. */
export async function typeRound(page: Page, round: Round, steps: number): Promise<void> {
  let held: string[] = [];
  let next = 0;
  for (let t = 0; t < steps; t++) {
    while (next < round.steps.length && round.steps[next]!.frame <= t) {
      const hold = round.steps[next]!.hold.map((a) => KEYS[a]!);
      for (const k of held) if (!hold.includes(k)) await page.keyboard.up(k);
      for (const k of hold) if (!held.includes(k)) await page.keyboard.down(k);
      held = hold;
      next++;
    }
    await frames(page, 1);
  }
  for (const k of held) await page.keyboard.up(k);
}

/**
 * A fresh 1920x1080 page of the siege served at `url` (the repo's root), in `backend` (`three`,
 * the page's default, or `canvas2d`, opened with `?backend=canvas2d&ui=picture` so its mission
 * screens are in the picture, where these hooks click them, not in the DOM bar), its briefing
 * begun. Page errors are pushed onto `errors`.
 */
export async function openSiege(
  browser: Browser,
  url: string,
  errors: string[],
  backend: 'three' | 'canvas2d' = 'three',
): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  const query = backend === 'three' ? '?debug=step' : '?backend=canvas2d&ui=picture&debug=step';
  await page.goto(`${url}${GAME}${query}`);
  await page.waitForSelector('body[data-backend]', { timeout: 300_000 });
  const opened = await page.evaluate(() => document.body.dataset.backend);
  if (opened !== backend) throw new Error(`the page opened in ${opened}, not ${backend}`);
  await begin(page);
  return page;
}
