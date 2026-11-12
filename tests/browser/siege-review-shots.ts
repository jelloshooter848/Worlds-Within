import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { launch, serveBuilt } from './serve';
import {
  begin,
  frames,
  hook,
  openSiege,
  press,
  recorded,
  ROUND_SHOWN,
  STEPS_PER_TICK,
  toTick,
  typeRound,
} from './siege-page';

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
const open = (): Promise<Page> => openSiege(browser, server.url, errors);

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
