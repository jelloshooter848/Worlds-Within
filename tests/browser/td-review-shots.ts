import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import type { InputScript } from '../../engine/core/input/scripted-input';
import type { DebugWindow } from '../../engine/core/shell';
import { launch, ROOT, serveBuilt } from './serve';

// The Winding Road's page review shot (Engine 0.16 part E, E10): what `pnpm cli screenshot` cannot
// draw, the shell's speed-up control on (the `3x` button by the sound control and the HUD's `3x`).
// The tower-defense page built and served as `tests/browser/tower-defense-page.test.ts` serves it,
// opened in headless Chromium on a 1920x1080 window in manual-loop mode (`?debug=step`, PixiJS, its
// default backend), the `win` run file's input typed on the keyboard at its ticks to the middle of
// wave 9 (tick 2450; the last 60 ticks one `step` call each, so the page draws every one and
// the enemies' spawn fade-in and the shots' flights advance as on the live loop), then the speed
// button clicked twice (1x, 2x, 3x) and one more tick played.
// In manual-loop mode the scene still steps once a loop step (`SceneStack`'s speed is 1 there, so
// the ticks stay the run's); the button and the HUD show the speed chosen.
//
//   pnpm exec tsx tests/browser/td-review-shots.ts <out dir> [prefix]
//
// writes `<prefix>-06-speed-up.png` (the prefix defaults to `shot`). Not a test (nothing here is
// asserted beyond reaching the run's state); the page test checks the same flow and the speed.

const GAME = 'games/samples/tower-defense/';
/** Loop steps per game tick (`STEPS_PER_TICK` in play.ts). */
const STEPS_PER_TICK = 2;
/** The tick of the shot: wave 9 on the road, twelve enemies, wave 10 previewed. */
const SHOT_TICK = 2450;
/**
 * The ticks before the shot played one `step` call each. In manual-loop mode the page draws once
 * per `step(n)` call, however many loop steps it runs, and presentation that counts drawn frames
 * (an enemy's 8-frame spawn fade-in, a projectile's flight) advances once per call; the last
 * ticks are played one at a time so the shot draws them as the live loop does.
 */
const DRAWN_TICKS = 60;
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

/** Calls `window.wwTd[name]()` on the page. */
const hook = <T>(page: Page, name: string): Promise<T> =>
  page.evaluate(
    (name) => (window as unknown as { wwTd: Record<string, () => unknown> }).wwTd[name]!(),
    name,
  ) as Promise<T>;

/** `n` game ticks (`STEPS_PER_TICK` loop steps each), drawn once at the end. */
const ticks = (page: Page, n: number): Promise<void> =>
  page.evaluate((n) => void (window as DebugWindow).__ww!.step(n), n * STEPS_PER_TICK);

/**
 * Plays from game tick `from` to `to`: in one call up to `DRAWN_TICKS` before the shot, then one
 * call a tick so the page draws each of the last ticks.
 */
const playTo = async (page: Page, from: number, to: number): Promise<void> => {
  const batched = Math.max(from, Math.min(to, SHOT_TICK - 1 - DRAWN_TICKS));
  if (batched > from) await ticks(page, batched - from);
  for (let t = batched; t < to; t++) await ticks(page, 1);
};

const [outArg, prefix = 'shot'] = process.argv.slice(2);
if (outArg === undefined) {
  console.error('usage: pnpm exec tsx tests/browser/td-review-shots.ts <out dir> [prefix]');
  process.exit(2);
}
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'ww-td-review-shots-'));
const server = await serveBuilt('/', join(temp, 'dist'));
const browser = await launch();
const errors: string[] = [];

try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  await page.goto(`${server.url}${GAME}?debug=step`);
  await page.waitForSelector('body[data-backend]', { timeout: 120_000 });
  const run = JSON.parse(readFileSync(join(ROOT, GAME, 'runs/win.run.json'), 'utf8')) as {
    input: InputScript;
  };
  // A step's keys go down before the tick it names (frame f is the input of tick f + 1).
  let held: string[] = [];
  let tick = 0;
  for (const s of run.input.steps) {
    if (s.frame >= SHOT_TICK) break;
    if (s.frame > tick) await playTo(page, tick, s.frame);
    tick = Math.max(tick, s.frame);
    const hold = s.hold.map((a) => KEYS[a]!);
    for (const k of held) if (!hold.includes(k)) await page.keyboard.up(k);
    for (const k of hold) if (!held.includes(k)) await page.keyboard.down(k);
    held = hold;
  }
  await playTo(page, tick, SHOT_TICK - 1);
  await page.click('#ww-speed');
  await page.click('#ww-speed');
  await ticks(page, 1);
  for (const k of held) await page.keyboard.up(k);
  const kit = await hook<Record<string, number | string>>(page, 'kit');
  const at = await hook<number>(page, 'tick');
  // The headless run at tick 2450 (`pnpm cli dump ... --tick 2450`): wave 9, 41 gold, 20 lives.
  if (at !== SHOT_TICK || kit.wave !== 9 || kit.gold !== 41 || kit.lives !== 20)
    throw new Error(`not the win run's tick ${SHOT_TICK}: tick ${at}, ${JSON.stringify(kit)}`);
  const speed = await page.evaluate(() => document.body.dataset.speed);
  if (speed !== '3') throw new Error(`the speed is ${speed}, not 3`);
  await page.screenshot({ path: join(out, `${prefix}-06-speed-up.png`) });
  await context.close();
  if (errors.length > 0) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log(`wrote 1 shot to ${out}`);
} finally {
  await browser.close();
  await server.close();
  rmSync(temp, { recursive: true, force: true });
}
