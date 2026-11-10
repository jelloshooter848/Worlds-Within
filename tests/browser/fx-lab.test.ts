import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DebugWindow } from '@engine/core/shell';
import { browserMissing, launch, ROOT, serveBuilt } from './serve';

// The fx lab's page in a browser (Engine 0.16 T2): the repo is built as `pnpm build` builds it
// and served as static files; headless Chromium opens games/fx-lab/ in manual-loop mode
// (`?debug=step`) with each backend, replays `runs/level-1.run.json` through the step hook
// (`window.__ww.replay`), and checks the page's state hashes are the golden ones and that the
// sounds the page played (its displays' `onSound`, recorded in `window.wwFxLab.sounds`) include
// the skins' frame events (Pip's footsteps on the run and walk cycles) as well as the kit's
// events (jump, stomp, the door). Skipped where Chromium is not installed (never in CI).

const GAME = 'games/fx-lab/';

const missing = await browserMissing();
if (missing) console.warn(`skipping the fx lab page test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-fx-lab-page-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

let built: Promise<{ url: string; close(): Promise<void> }> | null = null;
const serve = () => (built ??= serveBuilt('/', join(temp, 'dist')));
afterAll(async () => {
  if (built) await (await built).close();
});

describe.skipIf(missing !== null)('the fx lab page (headless Chromium)', () => {
  it.each(['canvas2d', 'three'])(
    'plays the frame events as sounds in %s, with the golden hashes',
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
        const query = backend === 'three' ? '?backend=three&debug=step' : '?debug=step';
        await page.goto(`${server.url}${GAME}${query}`);
        await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
        expect(await page.evaluate(() => document.body.dataset.backend), errors.join('\n')).toBe(backend);

        const run = JSON.parse(readFileSync(join(ROOT, GAME, 'runs/level-1.run.json'), 'utf8')) as {
          ticks: number;
        };
        const golden = JSON.parse(readFileSync(join(ROOT, GAME, 'runs/level-1.hashes.json'), 'utf8')) as {
          hashes: { tick: number; hash: string }[];
        };
        const seen = await page.evaluate(
          ({ run, ticks, end }) => {
            const ww = (window as DebugWindow).__ww!;
            const lab = (window as { wwFxLab?: { sounds: string[] } }).wwFxLab!;
            lab.sounds.length = 0;
            ww.replay(run);
            const hashes: { tick: number; hash: string | null }[] = [];
            // One step at a time, so every tick is drawn (and its sounds played).
            while (ww.tick < end) {
              ww.step(1);
              if (ticks.includes(ww.tick)) hashes.push({ tick: ww.tick, hash: ww.hash() });
            }
            return { hashes, sounds: [...lab.sounds] };
          },
          { run, ticks: golden.hashes.map((h) => h.tick), end: run.ticks },
        );
        expect(seen.hashes).toEqual(golden.hashes.filter((h) => h.tick > 0));
        const count = (id: string) => seen.sounds.filter((s) => s === id).length;
        // Frame events of the skins' cycles: footsteps on Pip's walk and run frames.
        expect(count('footstep'), seen.sounds.join(',')).toBeGreaterThan(10);
        // And the kit's own events, through the same skin `events`.
        for (const id of ['jump', 'land', 'coin', 'stomp', 'door']) expect(count(id), id).toBeGreaterThan(0);
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    300_000,
  );
});

// Screen transitions (Engine 0.16 T5): the lab's `game.json` plays an iris (closing on Pip at the
// door, opening on Pip in the next level) when the level changes, and `__ww.transition` plays a
// wipe and a fade on demand. The page is stepped in manual-loop mode (`?debug=step`), where
// transitions play without holding ticks. Each kind is shot at mid-transition and its picture
// read back: how much of it is the cover's black, the corners, the sides. The shots go to
// `WW_SHOTS_DIR` when set (to look at them), else a temp folder.
const shots = process.env.WW_SHOTS_DIR ?? temp;

describe.skipIf(missing !== null)('the fx lab page: screen transitions (headless Chromium)', () => {
  it.each(['canvas2d', 'three'])(
    'shows an iris on the level change and a wipe and a fade on demand, in %s',
    async (backend) => {
      const server = await serve();
      const browser = await launch();
      try {
        const page = await browser.newPage({ viewport: { width: 512, height: 480 }, deviceScaleFactor: 1 });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
        await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
        const query = backend === 'three' ? '?backend=three&debug=step' : '?debug=step';
        await page.goto(`${server.url}${GAME}${query}`);
        await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
        const run = JSON.parse(readFileSync(join(ROOT, GAME, 'runs/level-1.run.json'), 'utf8')) as unknown;

        // Plays level-1 to the door, then steps until the sequence moves to the next level.
        const changed = await page.evaluate((run) => {
          const ww = (window as DebugWindow).__ww!;
          const { ticks } = ww.replay(run);
          ww.step(ticks);
          const stage = () => (ww.snapshot() as { stage: number }).stage;
          while (stage() === 0 && ww.tick < 2000) ww.step(1);
          return { tick: ww.tick, stage: stage() };
        }, run);
        expect(changed.stage).toBe(1);

        /** Steps n, saves the picture, and reads the share of black pixels and a few spots. */
        const shoot = async (name: string, n: number) => {
          const read = await page.evaluate((n) => {
            (window as DebugWindow).__ww!.step(n);
            const screen = document.getElementById('screen') as HTMLCanvasElement;
            const copy = document.createElement('canvas');
            copy.width = screen.width;
            copy.height = screen.height;
            const ctx = copy.getContext('2d')!;
            ctx.drawImage(screen, 0, 0);
            const { data, width, height } = ctx.getImageData(0, 0, copy.width, copy.height);
            const black = (x: number, y: number) => {
              const i = (Math.floor(y) * width + Math.floor(x)) * 4;
              return data[i]! < 8 && data[i + 1]! < 8 && data[i + 2]! < 8;
            };
            let dark = 0;
            let sum = 0;
            for (let i = 0; i < data.length; i += 4) {
              if (data[i]! < 8 && data[i + 1]! < 8 && data[i + 2]! < 8) dark++;
              sum += data[i]! + data[i + 1]! + data[i + 2]!;
            }
            // Spots inside the picture (the 2D canvas letterboxes it): its middle band.
            const col = (fx: number) => [0.3, 0.5, 0.7].every((fy) => black(width * fx, height * fy));
            return {
              black: dark / (width * height),
              mean: sum / (width * height * 3),
              left: col(0.15),
              right: col(0.85),
            };
          }, n);
          await page.locator('#screen').screenshot({ path: join(shots, `fx-lab-${backend}-${name}.png`) });
          return read;
        };

        // The iris: 28 frames each way with a hold of 8. Mid-out: a ring of black closing on Pip.
        const before = await shoot('before', 0);
        const irisOut = await shoot('iris-out', 22);
        expect(irisOut.black).toBeGreaterThan(before.black + 0.15);
        expect(irisOut.black).toBeLessThan(0.98);
        // Covered through the hold, then opening on the next level.
        const covered = await shoot('iris-covered', 10);
        expect(covered.black).toBeGreaterThan(0.95);
        const irisIn = await shoot('iris-in', 6);
        expect(irisIn.black).toBeGreaterThan(before.black + 0.1);
        expect(irisIn.black).toBeLessThan(covered.black);
        await page.evaluate(() => (window as DebugWindow).__ww!.step(40));

        // A wipe from the left on demand: mid-way the left is covered and the right is not.
        const started = await page.evaluate(() =>
          (window as DebugWindow).__ww!.transition({ kind: 'wipe', ticks: 20, direction: 'right', edge: 24 }),
        );
        expect(started).toBe(true);
        const wipe = await shoot('wipe', 12);
        expect(wipe.left).toBe(true);
        expect(wipe.right).toBe(false);
        await page.evaluate(() => (window as DebugWindow).__ww!.step(40));

        // The game's default, a fade: the whole picture darker, nowhere solid black yet.
        const open = await shoot('open', 0);
        expect(await page.evaluate(() => (window as DebugWindow).__ww!.transition())).toBe(true);
        const fade = await shoot('fade', 9);
        expect(fade.mean).toBeLessThan(open.mean * 0.7);
        expect(fade.black).toBeLessThan(0.5);
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    300_000,
  );
});
