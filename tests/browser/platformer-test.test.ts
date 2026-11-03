import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InputScript } from '@engine/core/input/scripted-input';
import type { DebugWindow } from '@engine/core/shell';
import { browserMissing, launch, ROOT, serveBuilt } from './serve';

// The stacking test's page in a browser, in 2D and in 3D (docs/ROADMAP.md, 0.7: "playable from a
// link in both 2D and 3D"). The repo is built as `pnpm build` builds it and served as `pnpm
// preview` serves it; headless Chromium checks that the launcher lists games/platformer-test/ and
// its `3D` link (`?backend=three`), then opens the page with each backend and plays
// `runs/level-4.run.json` (all four levels, the door's round failed and then passed) through the
// real page: keyboard, input manager, scene stack, `HostScene`, mini game scene and Canvas2D, or
// the Three.js backend with the `three` and `three-vault` skins (WebGL 2; SwiftShader here: this
// checks that 3D plays, not that it is hardware-backed). The page runs in manual-loop mode
// (`?debug=step`) and the test steps it with the shell's step hook, `window.__ww.step(1)`: exactly
// one 60 Hz step each time, so tick N of the page is tick N of the run file. It reads the picture at ticks where the run file says what is on screen
// (a level under the sky; the vault round in black: under its HUD band in 2D, above the room
// centred in the picture in 3D, which draws no HUD) and checks the page logged no errors. Skipped
// where Chromium is not installed (never in CI).

const GAME = 'games/platformer-test/';
const RUN = JSON.parse(readFileSync(join(ROOT, GAME, 'runs/level-4.run.json'), 'utf8')) as {
  ticks: number;
  input: InputScript;
};

/** The default keyboard binding for each action the run holds (run is attack's key). */
const KEYS: Record<string, string> = {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  jump: 'KeyZ',
  attack: 'KeyX',
  run: 'KeyX',
};

/**
 * Ticks to look at, and what one pixel of the picture shows then: in 2D the middle of row 40 (the
 * round's HUD band), in 3D the middle of row 12 (above the room, which 3D centres; `ROW`).
 */
const SKY = '92,148,252';
const BLACK = '0,0,0';
const ROW: Record<string, number> = { canvas2d: 40, three: 12 };
const LOOKS: Record<number, string> = {
  100: SKY, // level-1
  2200: SKY, // level-4, walking to the door
  2400: BLACK, // round 1 (2281 to 2881)
  2900: SKY, // back on the level after the failed round
  3100: BLACK, // round 2 (2965 to 3144)
  3200: SKY, // the passed round opened the wall
};

const missing = await browserMissing();
if (missing) console.warn(`skipping the platformer test 2D page test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-platformer-test-page-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

/** The actions the run file holds on frame `f` (each step holds from its frame on). */
function holdAt(f: number): string[] {
  let held: string[] = [];
  for (const s of RUN.input.steps) if (s.frame <= f) held = s.hold;
  return held;
}

let built: Promise<{ url: string; close(): Promise<void> }> | null = null;
/** The build, served once for both backends. */
const serve = () => (built ??= serveBuilt('/', join(temp, 'dist')));
afterAll(async () => {
  if (built) await (await built).close();
});

describe.skipIf(missing !== null)('the platformer test page (headless Chromium)', () => {
  it.each(['canvas2d', 'three'])(
    'is in the launcher and plays level-4.run.json in %s, the door round and back',
    async (backend) => {
      const server = await serve();
      const browser = await launch();
      try {
        const page = await browser.newPage({ viewport: { width: 512, height: 480 }, deviceScaleFactor: 1 });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
        page.on('console', (msg) => {
          if (msg.type() === 'error') errors.push(`console: ${msg.text()} (${msg.location().url})`);
        });
        await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));

        const query = backend === 'three' ? '?backend=three' : '';
        await page.goto(server.url);
        expect(await page.locator(`#games a[href="${GAME}${query}"]`).count()).toBe(1);

        // The page in manual-loop mode (`?debug=step`, Engine 0.14 T8, gap G31): its loop never
        // runs by itself, and `window.__ww.step(n)` takes exactly n 60 Hz steps, so tick N of the
        // page is tick N of the run file however long the page took to load (often in 3D, after
        // the async Three.js import) or the test takes to send keys.
        await page.goto(`${server.url}${GAME}${query === '' ? '?' : `${query}&`}debug=step`);
        await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
        expect(await page.evaluate(() => document.body.dataset.backend), errors.join('\n')).toBe(backend);
        const frames = (n: number) => page.evaluate((n) => void (window as DebugWindow).__ww!.step(n), n);
        // The page's canvas copied onto a 2D one (a WebGL canvas keeps its buffer for this:
        // `preserveDrawingBuffer`), then one pixel read at (128, row) of the picture.
        const band = () =>
          page.evaluate((row) => {
            const canvas = document.getElementById('screen') as HTMLCanvasElement;
            const s = canvas.width / 256;
            const copy = document.createElement('canvas');
            copy.width = canvas.width;
            copy.height = canvas.height;
            const ctx = copy.getContext('2d')!;
            ctx.drawImage(canvas, 0, 0);
            const px = ctx.getImageData(Math.floor(128 * s), Math.floor(row * s), 1, 1).data;
            return `${px[0]},${px[1]},${px[2]}`;
          }, ROW[backend]!);

        let held = new Set<string>();
        const seen: Record<number, string> = {};
        for (let tick = 1; tick <= RUN.ticks; tick++) {
          const want = new Set(holdAt(tick - 1).map((a) => KEYS[a]!));
          for (const key of held) if (!want.has(key)) await page.keyboard.up(key);
          for (const key of want) if (!held.has(key)) await page.keyboard.down(key);
          held = want;
          await frames(1);
          if (tick in LOOKS) seen[tick] = await band();
        }
        expect(seen).toEqual(LOOKS);
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    300_000,
  );

  // The step hook's replay (gap G31): each run file that plays from the game's own start is fed
  // through the real page (`window.__ww.replay`, the run's input through a `ScriptedInput` in
  // place of the keyboard), and the page's state hash at every golden tick is the one in the
  // run's `.hashes.json`, which `pnpm cli run` checks headless.
  it.each(['level-1', 'level-2', 'level-3', 'level-4'])(
    'replays %s.run.json through the page with the golden hashes',
    async (name) => {
      const server = await serve();
      const browser = await launch();
      try {
        const page = await browser.newPage({ viewport: { width: 512, height: 480 }, deviceScaleFactor: 1 });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
        page.on('console', (msg) => {
          if (msg.type() === 'error') errors.push(`console: ${msg.text()} (${msg.location().url})`);
        });
        await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
        await page.goto(`${server.url}${GAME}?debug=step`);
        await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
        const run = JSON.parse(readFileSync(join(ROOT, GAME, `runs/${name}.run.json`), 'utf8')) as unknown;
        const golden = JSON.parse(readFileSync(join(ROOT, GAME, `runs/${name}.hashes.json`), 'utf8')) as {
          hashes: { tick: number; hash: string }[];
        };
        const seen = await page.evaluate(
          ({ run, ticks }) => {
            const ww = (window as DebugWindow).__ww!;
            const hashes: { tick: number; hash: string | null }[] = [];
            ww.replay(run);
            for (const tick of ticks) {
              ww.step(tick - ww.tick);
              hashes.push({ tick: ww.tick, hash: ww.hash() });
            }
            return { hashes, replaying: ww.replaying, refused: ww.refused.length };
          },
          { run, ticks: golden.hashes.map((h) => h.tick) },
        );
        expect(golden.hashes.length).toBeGreaterThan(1);
        expect(seen).toEqual({ hashes: golden.hashes, replaying: true, refused: 0 });
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    300_000,
  );

  it('refuses a run file that starts elsewhere, and is not on the page without ?debug=step', async () => {
    const server = await serve();
    const browser = await launch();
    try {
      const page = await browser.newPage({ viewport: { width: 512, height: 480 }, deviceScaleFactor: 1 });
      await page.goto(`${server.url}${GAME}`);
      await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
      expect(await page.evaluate(() => (window as DebugWindow).__ww === undefined)).toBe(true);
      await page.goto(`${server.url}${GAME}?debug=step`);
      await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
      const run = JSON.parse(
        readFileSync(join(ROOT, GAME, 'runs/level-2-start.run.json'), 'utf8'),
      ) as unknown;
      const error = await page.evaluate((run) => {
        try {
          (window as DebugWindow).__ww!.replay(run);
          return null;
        } catch (e) {
          return (e as Error).message;
        }
      }, run);
      expect(error).toMatch(/"start"/);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
