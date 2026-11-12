import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { CDPSession, Page } from 'playwright';
import type { DebugWindow, MenusView } from '@engine/core/shell';
import { browserMissing, launch, ROOT, serveBuilt } from './serve';

// The RTS skirmish's page in a browser (docs/ROADMAP.md, 0.9 "done when": build a barracks, train
// units and command them in the browser, and get the same state hashes when the recorded orders
// are replayed headless). The repo is built as `pnpm build` builds it and served as `pnpm preview`
// serves it; headless Chromium checks the launcher lists games/samples/rts-skirmish/, opens it and
// plays the opening of The River Ford (Engine 0.16 part D, D8: the 64x40 map, the AI across the
// river) with real input: mouse box selection, the Build barracks button and a click to place it,
// a right click to gather, a touch tap on the barracks, a Train soldier click, a touch box and a
// touch long-press to send the builders to gather, a middle-drag pan, a wheel zoom out, a click on
// the minimap that moves the camera to blue's base, a box and a Shift+click for the army and a
// right click that sends it to the centre ford. From D9 it starts from the title (Start, with
// `?debug=step&title=show`), and after the opening a fresh page replays the whole ten-minute win
// (`runs/match-won.run.json`) through the step hook (`__ww.replay`) to the end screen, its hashes
// the golden file's, and its own export replays headless. The page's loop is the test's
// (`?debug=step`: one loop step per `window.__ww.step(1)`, one game tick each), so the battle is
// the same every time. It then exports the recording (`window.wwSkirmish.exportRun`) and replays it
// headless with `pnpm -s cli run`, which must pass with every sync hash equal. Where things are on
// the page comes from the hook (`clientAt`, `units`), never from fixed pixels, so the camera can
// move. The page runs on its default backend, PixiJS (Engine 0.16 T13b-8). Skipped where Chromium
// is not installed (never in CI).

const GAME = 'games/samples/rts-skirmish/';
const TILE = 16;
/**
 * Loop steps per game tick in manual-loop mode: one (D9; `STEPS_PER_TICK`, 6, is the real-time
 * page's), so the step hook's `replay` hands a run file's orders over at its own ticks.
 */
const STEPS_PER_TICK = 1;
const WON = 'games/samples/rts-skirmish/runs/match-won.run.json';

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
interface Building {
  id: number;
  kind: string;
  faction: string | null;
  x: number;
  y: number;
  done: boolean;
}
interface Hook {
  tick(): number;
  buildings(): Building[];
  minimapClientAt(wx: number, wy: number): { x: number; y: number } | null;
  stats(): { trained: number; built: number; gold: number };
  sides(): Record<string, Side>;
  units(): Unit[];
  selection(): number[];
  camera(): { zoom: number; x: number; y: number };
  clientAt(wx: number, wy: number): { x: number; y: number };
  message(): string;
  result(): 'won' | 'lost' | null;
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
  it('is built and in the launcher, plays the opening by mouse and touch, and its recording replays headless', async () => {
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

      // The games index lists it by its name; follow the index's own link (Engine 0.15 T14).
      await page.goto(server.url);
      const link = page.locator(`#games a[href="${GAME}"]`);
      expect(await link.count()).toBe(1);
      expect(await link.locator('xpath=..').textContent()).toContain('The River Ford');
      await link.click();
      await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
      expect(new URL(page.url()).pathname).toBe(`/${GAME}`);

      // The page in manual-loop mode with its title shown (`?debug=step&title=show`):
      // `window.__ww.step(n)` takes n loop steps (see platformer.test.ts), one game tick each.
      await page.goto(`${page.url()}?debug=step&title=show`);
      await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
      const menus = () => page.evaluate(() => (window as DebugWindow).__ww!.menus()) as Promise<MenusView>;
      const steps = (n: number) => page.evaluate((n) => void (window as DebugWindow).__ww!.step(n), n);
      // D9: the match starts from the title: The River Ford, Start focused; Enter starts it.
      await steps(30);
      const title = await menus();
      expect([title.state, title.screen, title.focused]).toEqual(['title', 'title', 'start']);
      expect(await hook(page, 'tick')).toBe(0); // the title holds the game at its start
      await page.keyboard.press('Enter');
      for (let i = 0; i < 120 && (await menus()).state !== 'play'; i++) await steps(1);
      expect((await menus()).state).toBe('play');
      // PixiJS by default (Engine 0.16 T13b-8; headless Chromium's SwiftShader counts as WebGL), so
      // the selection, orders and touch below go through the PixiJS display's letterbox maths.
      expect(await page.evaluate(() => document.body.dataset.backend), errors.join('\n')).toBe('pixi');
      // The shell's volume control (gap M1), and no end screen yet.
      expect(await page.locator('#ww-volume').count()).toBe(1);
      expect(await page.isVisible('#end')).toBe(false);
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

      // Tick 0: a mouse box over workers 11-13, Build barracks, a click on cell 11,17 to place it.
      await mouseBox(8, 16, 9, 22);
      expect(await selection()).toEqual([11, 12, 13]);
      await page.click('#build-barracks');
      await frames(1);
      expect(await page.isVisible('#cancel')).toBe(true);
      const site = await cell(11, 17);
      await page.mouse.move(site.x, site.y);
      await frames(1);
      await click(11, 17);
      expect(await page.isVisible('#cancel')).toBe(false);
      // Worker 13 gathers at the southern gold (10,25): a click on it, then a right click.
      const worker = (await units()).find((u) => u.id === 13)!;
      await click(worker.x, worker.y);
      expect(await selection()).toEqual([13]);
      await click(10, 25, 'right');
      await until('a barracks', async () => (await sides()).red?.buildings['barracks'] === 1);
      const barracks = (await hook(page, 'buildings')).find(
        (x) => x.faction === 'red' && x.kind === 'barracks',
      )!;

      // A touch tap on the barracks selects it; Train soldier.
      await touch('touchStart', await cell(barracks.x, barracks.y));
      await touch('touchEnd');
      await frames(1);
      expect(await selection()).toEqual([barracks.id]);
      await page.click('#train-soldier');
      await frames(1);
      // A touch box over the builders, then a long-press on the northern gold (10,14): gather.
      const builders = (await units()).filter((u) => u.id === 11 || u.id === 12);
      const xs = builders.map((u) => u.x);
      const ys = builders.map((u) => u.y);
      const a = await client(Math.min(...xs) * TILE + 1, Math.min(...ys) * TILE + 1);
      const b = await client((Math.max(...xs) + 1) * TILE - 1, (Math.max(...ys) + 1) * TILE - 1);
      await touch('touchStart', a);
      for (let i = 1; i <= 5; i++)
        await touch('touchMove', { x: a.x + ((b.x - a.x) * i) / 5, y: a.y + ((b.y - a.y) * i) / 5 });
      await touch('touchEnd');
      await frames(1);
      expect(await selection()).toEqual([11, 12]);
      await touch('touchStart', await cell(10, 14));
      await page.waitForTimeout(650);
      await touch('touchEnd');
      await frames(1);

      await until('a soldier', async () => ((await sides()).red?.unitTypes['soldier'] ?? 0) >= 1);
      // The camera: a middle-drag pan, then the wheel zooms out.
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
      // A click on the minimap (bottom right) at blue's town centre moves the camera east and
      // gives no order (Engine 0.16 part D, D8); then back home the same way.
      const before = await hook(page, 'camera');
      const east = (await hook(page, 'minimapClientAt', 58.5 * TILE, 20.5 * TILE))!;
      await page.mouse.click(east.x, east.y);
      await frames(1);
      expect((await hook(page, 'camera')).x).toBeGreaterThan(before.x);
      const home = (await hook(page, 'minimapClientAt', 8 * TILE, 19 * TILE))!;
      await page.mouse.click(home.x, home.y);
      await frames(1);

      // The army: a box over the soldier, Shift+click the hero (19), right click the centre ford.
      const soldiers = (await units()).filter((u) => u.faction === 'red' && u.type === 'soldier');
      const sx = soldiers.map((u) => u.x);
      const sy = soldiers.map((u) => u.y);
      await mouseBox(Math.min(...sx), Math.min(...sy), Math.max(...sx), Math.max(...sy));
      const army = await selection();
      expect(army).toEqual(expect.arrayContaining(soldiers.map((u) => u.id)));
      const hero = (await units()).find((u) => u.id === 19)!;
      await page.keyboard.down('Shift');
      await click(hero.x, hero.y);
      await page.keyboard.up('Shift');
      expect(await selection()).toEqual([...army, 19].sort((p, q) => p - q));
      await click(24, 19, 'right');
      await frames(STEPS_PER_TICK * 5);
      // No end yet, and the stats count the opening.
      expect(await hook(page, 'result')).toBeNull();
      expect(await page.isVisible('#end')).toBe(false);
      const stats = await hook(page, 'stats');
      expect(stats.built).toBe(1);
      expect(stats.trained).toBe(1);
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
      expect(types).toEqual(['build', 'gather', 'train', 'gather', 'move']);
      expect(run!.orders.at(-1)?.units).toContain(19);
      writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
      const replay = JSON.parse(
        execFileSync('pnpm', ['-s', 'cli', 'run', file, '--json'], { cwd: ROOT, encoding: 'utf8' }),
      ) as { ok: boolean; passed: boolean; hashesChecked: number; hashMismatch: unknown; finalHash: string };
      expect(replay).toMatchObject({ ok: true, passed: true, hashMismatch: null });
      expect(replay.hashesChecked).toBe(run!.hashes.length);
      expect(replay.finalHash).toBe(run!.hashes.at(-1)?.hash);

      // D9: the whole ten-minute win replayed through the page with the step hook (a fresh page,
      // `?debug=step`), its state hash equal to the golden file's every 100 ticks, to the end
      // screen; the page's own export of it then replays headless with no hash mismatch.
      const won = JSON.parse(readFileSync(join(ROOT, WON), 'utf8')) as { ticks: number };
      const golden = (
        JSON.parse(readFileSync(join(ROOT, WON.replace('.run.json', '.hashes.json')), 'utf8')) as {
          hashes: { tick: number; hash: string }[];
        }
      ).hashes;
      const match = await context.newPage();
      match.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      await match.goto(`${server.url}${GAME}?debug=step`);
      await match.waitForSelector('body[data-backend]', { timeout: 60_000 });
      expect(await match.evaluate((run) => (window as DebugWindow).__ww!.replay(run), won)).toEqual({
        ticks: won.ticks,
      });
      const pageHashes: { tick: number; hash: string }[] = [];
      for (const { tick: at } of golden) {
        const now = await match.evaluate(() => (window as DebugWindow).__ww!.tick);
        await match.evaluate((n) => void (window as DebugWindow).__ww!.step(n), at - now);
        pageHashes.push({
          tick: at,
          hash: (await match.evaluate(() => (window as DebugWindow).__ww!.hash()))!,
        });
      }
      expect(pageHashes).toEqual(golden);
      // The page refuses what `pnpm cli run` refuses: the run's one early barracks it cannot pay for.
      expect(await match.evaluate(() => (window as DebugWindow).__ww!.refused)).toEqual([
        {
          tick: 110,
          kind: 'order',
          error: 'order 18: faction "red" cannot afford barracks: needs 120 gold, has 115',
        },
      ]);
      expect(await hook(match, 'result')).toBe('won');
      expect(await match.isVisible('#end')).toBe(true);
      expect(await match.textContent('#end-title')).toContain('Victory');
      expect(await match.textContent('#end-text')).toMatch(
        /^The enemy town centre fell at 9:\d\d \(tick \d+\)\. Trained \d+/,
      );
      const whole = await hook(match, 'exportRun', relative(temp, join(ROOT, GAME)));
      expect(whole!.ticks).toBe(won.ticks);
      const wholeFile = join(temp, 'match.run.json');
      writeFileSync(wholeFile, `${JSON.stringify(whole, null, 2)}\n`);
      // `spawnSync`, not `execFileSync`: a failed run exits 4, and its result says why.
      const replayed = JSON.parse(
        spawnSync('pnpm', ['-s', 'cli', 'run', wholeFile, '--json', '--max-output', '1000000'], {
          cwd: ROOT,
          encoding: 'utf8',
        }).stdout,
      ) as {
        passed: boolean;
        hashesChecked: number;
        hashMismatch: unknown;
        failure: unknown;
        errors?: unknown;
      };
      expect(replayed, JSON.stringify([replayed.errors, replayed.failure])).toMatchObject({
        passed: true,
        hashMismatch: null,
      });
      expect(replayed.hashesChecked).toBe(whole!.hashes.length);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 600_000);
});
