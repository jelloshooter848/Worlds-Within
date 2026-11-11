import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import type { DebugWindow } from '../../engine/core/shell';
import { launch, ROOT, serveBuilt } from './serve';

// The mini siege's page review shots (Engine 0.16 polish P; F10 took its own with a scratch script
// on these helpers, item 551): the 3D page built and served as `tests/browser/mini-siege-page.test.ts`
// serves it, opened in headless Chromium (software WebGL) on a 1920x1080 window at the skin's
// render scale, stepped with `?debug=step` and driven by the `wwSiege` hooks, seed 11. What the
// CLI's `pnpm cli screenshot` cannot draw: the page's controls over a round, the mission-open
// flash after Delegate, the results screen and the dawn's time-of-day light.
//
//   pnpm exec tsx tests/browser/siege-review-shots.ts <out dir> [prefix]
//
// writes `<prefix>-12-fortify-round-controls.png` (the walls' round, its keys typed 100 loop
// steps), `-13-sabotage-round-controls.png` (the sabotage room, 160 steps), `-14-mission-open-
// flash.png` (the first loop step of world tick 41 after Delegate at 40), `-15-results-losses.png`
// (the siege's results at 260) and `-11-dawn-skirt.png` (the dawn at tick 30, 06:00). The prefix
// defaults to `shot`. Not a test (nothing here is asserted); the page test checks the same flow.

const GAME = 'games/samples/mini-siege/';
/** Loop steps per world tick (`STEPS_PER_TICK` in play.ts). */
const STEPS_PER_TICK = 6;
/** Loop steps after a round starts by which the iris has opened on it. */
const ROUND_SHOWN = 70;
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
type Round = { steps: { frame: number; hold: string[] }[] };

/** The recorded round of a run file's play step. */
const recorded = (run: string): Round =>
  (
    JSON.parse(readFileSync(join(ROOT, GAME, `runs/${run}.run.json`), 'utf8')) as {
      missions: { action: string; input?: Round }[];
    }
  ).missions.find((m) => m.action === 'play')!.input!;

/** Calls `window.wwSiege[name](...args)` on the page. */
const hook = <T>(page: Page, name: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    ([name, args]) =>
      (window as unknown as { wwSiege: Record<string, (...a: unknown[]) => unknown> }).wwSiege[name]!(
        ...args,
      ),
    [name, args] as const,
  ) as Promise<T>;

const frames = (page: Page, n: number): Promise<void> =>
  page.evaluate((n) => void (window as DebugWindow).__ww!.step(n), n);

/** Clicks a mission screen's item in the picture, then (unless `step` is false) takes a loop step. */
async function press(page: Page, item: string, step = true): Promise<void> {
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
async function toTick(page: Page, tick: number): Promise<void> {
  const now = await hook<number>(page, 'tick');
  if (tick - now > 1) await frames(page, (tick - now - 1) * STEPS_PER_TICK);
  for (let i = 0; i < 60 && (await hook<number>(page, 'tick')) < tick; i++) await frames(page, 1);
  if ((await hook<number>(page, 'tick')) !== tick) throw new Error(`not at world tick ${tick}`);
}

/** Clicks Begin on the held entry's briefing and lets one world tick run. */
async function begin(page: Page): Promise<void> {
  await press(page, 'begin');
  await frames(page, STEPS_PER_TICK);
}

/** Types the first `steps` loop steps of a recorded round on the keyboard. */
async function typeRound(page: Page, round: Round, steps: number): Promise<void> {
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

const [outArg, prefix = 'shot'] = process.argv.slice(2);
if (outArg === undefined) {
  console.error('usage: pnpm exec tsx tests/browser/siege-review-shots.ts <out dir> [prefix]');
  process.exit(2);
}
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'ww-siege-review-shots-'));
const server = await serveBuilt('/', join(temp, 'dist'));
const browser = await launch();
const errors: string[] = [];
const path = (name: string) => join(out, `${prefix}-${name}.png`);

/** A fresh 1920x1080 3D page of the siege, its briefing begun. */
async function open(): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  await page.goto(`${server.url}${GAME}?debug=step`);
  await page.waitForSelector('body[data-backend]', { timeout: 300_000 });
  const backend = await page.evaluate(() => document.body.dataset.backend);
  if (backend !== 'three') throw new Error(`the page opened in ${backend}, not 3D`);
  await begin(page);
  return page;
}

try {
  // The walls' round (td-defence) mid-wave, and the sabotage room mid-round: the controls over them.
  for (const [tick, run, steps, name] of [
    [10, 'fortify-played', ROUND_SHOWN + 30, '12-fortify-round-controls'],
    [40, 'played', ROUND_SHOWN + 90, '13-sabotage-round-controls'],
  ] as const) {
    const page = await open();
    await toTick(page, tick);
    await press(page, 'play', false);
    await typeRound(page, recorded(run), steps);
    await page.screenshot({ path: path(name) });
    await page.context().close();
  }
  // Delegate at 40; the first loop step of world tick 41 (the mission-open flash), then the
  // siege's results at 260 and the dawn at tick 30.
  {
    const page = await open();
    await toTick(page, 40);
    await press(page, 'delegate', false);
    for (let i = 0; i < 60 && (await hook<number>(page, 'tick')) < 41; i++) await frames(page, 1);
    await page.screenshot({ path: path('14-mission-open-flash') });
    for (let i = 0; i < 100 && (await hook<unknown>(page, 'ended')) === null; i++)
      await frames(page, STEPS_PER_TICK * 5);
    await page.screenshot({ path: path('15-results-losses') });
    await press(page, 'continue');
    await frames(page, 2);
    await begin(page);
    await toTick(page, 30);
    await page.screenshot({ path: path('11-dawn-skirt') });
    await page.context().close();
  }
  if (errors.length > 0) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log(`wrote 5 shots to ${out}`);
} finally {
  await browser.close();
  await server.close();
  rmSync(temp, { recursive: true, force: true });
}
