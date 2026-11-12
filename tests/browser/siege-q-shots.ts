import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, serveBuilt } from './serve';
import { begin, frames, hook, openSiege, press, STEPS_PER_TICK, toTick } from './siege-page';

// The mini siege's page shots for Engine 0.16 polish Q (P1-P4, the polish P leftovers): the page
// built and served as `tests/browser/mini-siege-page.test.ts` serves it, opened in headless
// Chromium on a 1920x1080 window, stepped with `?debug=step` and driven by the `wwSiege` hooks,
// seed 11, the same flow as `siege-review-shots.ts`.
//
//   pnpm exec tsx tests/browser/siege-q-shots.ts <out dir> [prefix]
//
// writes, from the 3D page (software WebGL, the skin's render scale): `<prefix>-05-results-vosk.png`
// (Delegate at 40, the siege's results at 260: "Vosk" wrapped onto its own line),
// `-07-controls-over-hints.png` (Continue on those results, the next briefing, a centred screen:
// the page's controls over the HUD's key hints) and `-06-dawn-black-bar.png` (Begin, the dawn at
// tick 30: the empty black bar over a soldier); and from the 2D page (`?backend=canvas2d`, its
// screens in the picture with `&ui=picture`):
// `-08-flash-2d.png` (Delegate at 40, the first loop step of world tick 41: the mission-open
// flash). The prefix defaults to `shot`. Not a test (nothing here is asserted).

const [outArg, prefix = 'shot'] = process.argv.slice(2);
if (outArg === undefined) {
  console.error('usage: pnpm exec tsx tests/browser/siege-q-shots.ts <out dir> [prefix]');
  process.exit(2);
}
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'ww-siege-q-shots-'));
const server = await serveBuilt('/', join(temp, 'dist'));
const browser = await launch();
const errors: string[] = [];
const path = (name: string) => join(out, `${prefix}-${name}.png`);

try {
  for (const backend of ['three', 'canvas2d'] as const) {
    const page = await openSiege(browser, server.url, errors, backend);
    await toTick(page, 40);
    await press(page, 'delegate', false);
    for (let i = 0; i < 60 && (await hook<number>(page, 'tick')) < 41; i++) await frames(page, 1);
    if (backend === 'canvas2d') {
      await page.screenshot({ path: path('08-flash-2d') });
      await page.context().close();
      continue;
    }
    for (let i = 0; i < 100 && (await hook<unknown>(page, 'ended')) === null; i++)
      await frames(page, STEPS_PER_TICK * 5);
    await page.screenshot({ path: path('05-results-vosk') });
    await press(page, 'continue');
    await frames(page, 2);
    await page.screenshot({ path: path('07-controls-over-hints') });
    await begin(page);
    await toTick(page, 30);
    await page.screenshot({ path: path('06-dawn-black-bar') });
    await page.context().close();
  }
  if (errors.length > 0) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log(`wrote 4 shots to ${out}`);
} finally {
  await browser.close();
  await server.close();
  rmSync(temp, { recursive: true, force: true });
}
