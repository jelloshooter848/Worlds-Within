import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { CDPSession, Page } from 'playwright';
import type { DebugWindow } from '@engine/core/shell';
import { browserMissing, launch, ROOT, serveBuilt } from './serve';

// The RTS skirmish's page in a browser (docs/ROADMAP.md, 0.9 "done when": build a barracks, train
// units and fight the enemy in the browser, and get the same state hashes when the recorded
// orders are replayed headless). The repo is built as `pnpm build` builds it and served as `pnpm
// preview` serves it; headless Chromium checks the launcher lists games/samples/rts-skirmish/,
// opens it and plays a battle with real input: mouse box selection, the Build barracks button and
// a click to place it, a right click to gather, a touch tap on the barracks, three Train soldier
// clicks, a touch box and a touch long-press to send the builders to gather, a middle-drag pan, a
// wheel zoom out, a box and a Shift+click for the army and a right click on a raider. The page's
// loop is the test's (`?debug=step`, one loop step per `window.__ww.step(1)`), so the battle is the
// same every time. It then exports the recording (`window.wwSkirmish.exportRun`) and replays it
// headless with `pnpm -s cli run`, which must pass with every sync hash equal. Where things are on
// the page comes from the hook (`clientAt`, `units`), never from fixed pixels, so the camera can
// move. Skipped where Chromium is not installed (never in CI).

const GAME = 'games/samples/rts-skirmish/';
const TILE = 16;
/** Loop steps per game tick (`STEPS_PER_TICK` in play.ts). */
const STEPS_PER_TICK = 6;

interface Unit {
  id: number;
  faction: string | null;
  type: string | null;
  x: number;
  y: number;
}
interface Side {
  units: number;
  unitTypes: Record<string, number>;
  buildings: Record<string, number>;
}
interface Hook {
  tick(): number;
  sides(): Record<string, Side>;
  units(): Unit[];
  selection(): number[];
  camera(): { zoom: number; x: number; y: number };
  clientAt(wx: number, wy: number): { x: number; y: number };
  message(): string;
  exportRun(game?: string): Promise<RecordedRun | null>;
}
interface RecordedRun {
  game: string;
  seed: number;
  ticks: number;
  orders: { tick: number; id: number; type: string; units: number[] }[];
  hashes: { tick: number; hash: string }[];
}

const missing = await browserMissing();
if (missing) console.warn(`skipping the RTS skirmish page test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-rts-skirmish-page-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

/** Calls `window.wwSkirmish[name](...args)` on the page. */
function hook<K extends keyof Hook>(
  page: Page,
  name: K,
  ...args: Parameters<Hook[K]>
): Promise<Awaited<ReturnType<Hook[K]>>> {
  return page.evaluate(
    ([name, args]) => {
      const h = (window as unknown as { wwSkirmish: Record<string, (...a: unknown[]) => unknown> })
        .wwSkirmish;
      return h[name]!(...args);
    },
    [name, args] as const,
  ) as Promise<Awaited<ReturnType<Hook[K]>>>;
}

describe.skipIf(missing !== null)('the RTS skirmish page (headless Chromium)', () => {
  it('is built and in the launcher, plays a battle by mouse and touch, and its recording replays headless', async () => {
    const dist = join(temp, 'dist');
    const server = await serveBuilt('/', dist);
    const browser = await launch();
    try {
      expect(existsSync(join(dist, GAME, 'index.html'))).toBe(true);
      const context = await browser.newContext({
        viewport: { width: 640, height: 520 },
        deviceScaleFactor: 1,
        hasTouch: true,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console: ${msg.text()} (${msg.location().url})`);
      });
      await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));

      await page.goto(server.url);
      expect(await page.locator(`#games a[href="${GAME}"]`).count()).toBe(1);

      // The page in manual-loop mode (`?debug=step`): `window.__ww.step(n)` takes n loop steps
      // (see platformer-test.test.ts).
      await page.goto(`${server.url}${GAME}?debug=step`);
      await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
      expect(await page.evaluate(() => document.body.dataset.backend), errors.join('\n')).toBe('canvas2d');
      const frames = (n: number) => page.evaluate((n) => void (window as DebugWindow).__ww!.step(n), n);
      const tick = () => hook(page, 'tick');
      const sides = () => hook(page, 'sides');
      const units = () => hook(page, 'units');
      const selection = () => hook(page, 'selection');
      /** Steps tick by tick until `done` holds (at most `max` ticks). */
      const until = async (what: string, done: () => Promise<boolean>, max = 400) => {
        for (let i = 0; i < max && !(await done()); i++) await frames(STEPS_PER_TICK);
        expect(await done(), `${what} by tick ${await tick()}`).toBe(true);
      };
      /** The client point of world px (wx, wy) now. */
      const client = (wx: number, wy: number) => hook(page, 'clientAt', wx, wy);
      /** The client point of the centre of cell (x, y). */
      const cell = (x: number, y: number) => client((x + 0.5) * TILE, (y + 0.5) * TILE);
      const mouseBox = async (x0: number, y0: number, x1: number, y1: number) => {
        const a = await client(x0 * TILE + 2, y0 * TILE + 2);
        const b = await client((x1 + 1) * TILE - 2, (y1 + 1) * TILE - 2);
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 5 });
        await page.mouse.up();
        await frames(1);
      };
      const click = async (x: number, y: number, button: 'left' | 'right' = 'left') => {
        const p = await cell(x, y);
        await page.mouse.click(p.x, p.y, { button });
        await frames(1);
      };
      const cdp: CDPSession = await context.newCDPSession(page);
      const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
        cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: p ? [{ x: Math.round(p.x), y: Math.round(p.y), id: 1 }] : [],
        });

      // Tick 0: a mouse box over workers 7 and 8, Build barracks, a click on cell 10,9 to place it.
      await mouseBox(7, 9, 7, 10);
      expect(await selection()).toEqual([7, 8]);
      await page.click('#build-barracks');
      await frames(1);
      expect(await page.isVisible('#cancel')).toBe(true);
      const site = await cell(10, 9);
      await page.mouse.move(site.x, site.y);
      await frames(1);
      await click(10, 9);
      expect(await page.isVisible('#cancel')).toBe(false);
      // Worker 9 (7,12) gathers at the southern gold (8,15): a click, then a right click.
      await click(7, 12);
      expect(await selection()).toEqual([9]);
      await click(8, 15, 'right');
      await until('a barracks', async () => (await sides()).red?.buildings['barracks'] === 1);

      // A touch tap on the barracks (cells 10-11, 9-10) selects it; three Train soldier clicks.
      await touch('touchStart', await cell(10, 9));
      await touch('touchEnd');
      await frames(1);
      expect(await selection()).toEqual([16]);
      for (let i = 0; i < 3; i++) await page.click('#train-soldier');
      await frames(1);
      // A touch box over the builders, then a long-press on the northern gold (8,6): gather.
      const builders = (await units()).filter((u) => u.id === 7 || u.id === 8);
      const xs = builders.map((u) => u.x);
      const ys = builders.map((u) => u.y);
      const a = await client(Math.min(...xs) * TILE + 1, Math.min(...ys) * TILE + 1);
      const b = await client((Math.max(...xs) + 1) * TILE - 1, (Math.max(...ys) + 1) * TILE - 1);
      await touch('touchStart', a);
      for (let i = 1; i <= 5; i++)
        await touch('touchMove', { x: a.x + ((b.x - a.x) * i) / 5, y: a.y + ((b.y - a.y) * i) / 5 });
      await touch('touchEnd');
      await frames(1);
      expect(await selection()).toEqual([7, 8]);
      await touch('touchStart', await cell(8, 6));
      await page.waitForTimeout(650);
      await touch('touchEnd');
      await frames(1);

      await until('three soldiers', async () => ((await sides()).red?.unitTypes['soldier'] ?? 0) >= 3);
      // The camera: a middle-drag pan, then the wheel zooms out to the whole map.
      const centre = await hook(page, 'camera');
      const mid = await client(centre.x, centre.y);
      await page.mouse.move(mid.x, mid.y);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(mid.x - 60, mid.y, { steps: 3 });
      await page.mouse.up({ button: 'middle' });
      await frames(1);
      const panned = await hook(page, 'camera');
      expect(panned.x).toBeGreaterThan(centre.x);
      await page.mouse.wheel(0, 500);
      await frames(1);
      expect((await hook(page, 'camera')).zoom).toBe(0.5);

      // The army: a box over the soldiers, Shift+click the hero (15), right click a raider.
      const soldiers = (await units()).filter((u) => u.faction === 'red' && u.type === 'soldier');
      const sx = soldiers.map((u) => u.x);
      const sy = soldiers.map((u) => u.y);
      await mouseBox(Math.min(...sx), Math.min(...sy), Math.max(...sx), Math.max(...sy));
      const army = await selection();
      expect(army).toEqual(expect.arrayContaining(soldiers.map((u) => u.id)));
      const hero = (await units()).find((u) => u.id === 15)!;
      await page.keyboard.down('Shift');
      await click(hero.x, hero.y);
      await page.keyboard.up('Shift');
      expect(await selection()).toEqual([...army, 15].sort((p, q) => p - q));
      const raider = (await units()).find((u) => u.faction === 'blue')!;
      await click(raider.x, raider.y, 'right');
      await until('the raiders beaten', async () => (await sides()).blue?.units === 0);
      const red = (await sides()).red!;
      expect(red.buildings['barracks']).toBe(1);
      expect(red.unitTypes['hero']).toBe(1);
      expect(await hook(page, 'message')).toBe('');
      await until('a hash tick', async () => (await tick()) % 20 === 0, 20);

      // Export the recording, save it beside the build and replay it with the CLI.
      const file = join(temp, 'browser.run.json');
      const run = await hook(page, 'exportRun', relative(temp, join(ROOT, GAME)));
      expect(run).not.toBeNull();
      expect(run!.ticks).toBe(await tick());
      const types = run!.orders.map((o) => o.type);
      expect(types).toEqual(['build', 'gather', 'train', 'train', 'train', 'gather', 'attack']);
      expect(run!.orders.at(-1)?.units).toContain(15);
      writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
      const replay = JSON.parse(
        execFileSync('pnpm', ['-s', 'cli', 'run', file, '--json'], { cwd: ROOT, encoding: 'utf8' }),
      ) as { ok: boolean; passed: boolean; hashesChecked: number; hashMismatch: unknown; finalHash: string };
      expect(replay).toMatchObject({ ok: true, passed: true, hashMismatch: null });
      expect(replay.hashesChecked).toBe(run!.hashes.length);
      expect(replay.finalHash).toBe(run!.hashes.at(-1)?.hash);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 300_000);
});
