import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InputScript } from '@engine/core/input/scripted-input';
import type { DebugWindow } from '@engine/core/shell';
import { browserMissing, launch, ROOT, serveBuilt } from './serve';

// The stacking test's page in a browser, in 2D and in 3D (docs/ROADMAP.md, 0.7: "playable from a
// link in both 2D and 3D"). The repo is built as `pnpm build` builds it and served as `pnpm
// preview` serves it; headless Chromium checks that the launcher lists games/samples/platformer/ and
// its `3D` link (`?backend=three`), then opens the page with each backend and plays
// `runs/level-4.run.json` (all four levels, the door's round failed and then passed) through the
// real page: keyboard, input manager, scene stack, `HostScene`, mini game scene and Canvas2D, or
// the Three.js backend with the `three` and `three-vault` skins (WebGL 2; SwiftShader here: this
// checks that 3D plays, not that it is hardware-backed). The page runs in manual-loop mode
// (`?debug=step`) and the test steps it with the shell's step hook, `window.__ww.step(1)`: exactly
// one 60 Hz step each time, so tick N of the page is tick N of the run file. It reads the picture at ticks where the run file says what is on screen
// (a level under the sky; the vault round in black above the room, its HUD band) and that the HUD
// is drawn in both backends (Engine 0.15, gap G33: the level's hearts, coins and lives on the sky,
// the round's hearts and time on black), and checks the page logged no errors. Skipped
// where Chromium is not installed (never in CI).

const GAME = 'games/samples/platformer/';
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
 * round's HUD band), in 3D the middle of row 12 (above the room, whose wall tops a tilted 3D camera
 * shows a little higher; `ROW`).
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

/**
 * Where the HUD is at a tick, and the background it is drawn over: the level skins' hearts, coin
 * and life icons and numbers (x 8 to 120, y 8 to 16) and the vault skins' hearts, hourglass and
 * time (x 16 to 240, y 28 to 36). The same in 2D and 3D (the skins' `hud`).
 */
const HUDS: Record<number, { x: number; y: number; w: number; h: number; under: string }> = {
  100: { x: 8, y: 8, w: 112, h: 8, under: SKY },
  2400: { x: 16, y: 28, w: 224, h: 8, under: BLACK },
};

const missing = await browserMissing();
if (missing) console.warn(`skipping the platformer test 2D page test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-platformer-page-'));
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
        // The games index lists the sample by its page title, with its 2D link and its `3D` link;
        // the test follows the backend's own link from there (Engine 0.15 T13, decision 13).
        const link = page.locator(`#games a[href="${GAME}${query}"]`);
        expect(await link.count()).toBe(1);
        expect(await page.locator(`#games a[href="${GAME}"]`).locator('xpath=..').textContent()).toContain(
          "Hopper's Way",
        );
        await link.click();
        await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
        expect(new URL(page.url()).pathname).toBe(`/${GAME}`);
        expect(new URL(page.url()).search).toBe(query);

        // The page in manual-loop mode (`?debug=step`, Engine 0.14 T8, gap G31): its loop never
        // runs by itself, and `window.__ww.step(n)` takes exactly n 60 Hz steps, so tick N of the
        // page is tick N of the run file however long the page took to load (often in 3D, after
        // the async Three.js import) or the test takes to send keys.
        await page.goto(`${server.url}${GAME}${query === '' ? '?' : `${query}&`}debug=step`);
        await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
        expect(await page.evaluate(() => document.body.dataset.backend), errors.join('\n')).toBe(backend);
        // The shell's mute button and volume slider (Engine 0.15 T5, M1).
        expect(await page.locator('#ww-volume').count()).toBe(1);
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

        // How many pixels of a picture box are not its background: the HUD's ink.
        const ink = (box: { x: number; y: number; w: number; h: number; under: string }) =>
          page.evaluate((box) => {
            const canvas = document.getElementById('screen') as HTMLCanvasElement;
            const s = canvas.width / 256;
            const copy = document.createElement('canvas');
            copy.width = canvas.width;
            copy.height = canvas.height;
            const ctx = copy.getContext('2d')!;
            ctx.drawImage(canvas, 0, 0);
            let count = 0;
            for (let y = box.y; y < box.y + box.h; y++)
              for (let x = box.x; x < box.x + box.w; x++) {
                const px = ctx.getImageData(Math.floor((x + 0.5) * s), Math.floor((y + 0.5) * s), 1, 1).data;
                if (`${px[0]},${px[1]},${px[2]}` !== box.under) count++;
              }
            return count;
          }, box);

        let held = new Set<string>();
        const seen: Record<number, string> = {};
        const hud: Record<number, number> = {};
        for (let tick = 1; tick <= RUN.ticks; tick++) {
          const want = new Set(holdAt(tick - 1).map((a) => KEYS[a]!));
          for (const key of held) if (!want.has(key)) await page.keyboard.up(key);
          for (const key of want) if (!held.has(key)) await page.keyboard.down(key);
          held = want;
          await frames(1);
          if (tick in LOOKS) seen[tick] = await band();
          if (tick in HUDS) hud[tick] = await ink(HUDS[tick]!);
        }
        expect(seen).toEqual(LOOKS);
        for (const [tick, count] of Object.entries(hud))
          expect(count, `HUD pixels at tick ${tick} in ${backend}`).toBeGreaterThan(40);
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
