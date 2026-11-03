import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { Browser, Page } from 'playwright';
import { buildDebugJob, startDebugServer, type DebugServer } from '@engine/tools/debugger/server';
import { main } from '@engine/tools/main';
import { browserMissing, launch, ROOT } from './serve';

// The in-browser simulation debugger (Engine 0.14 T10) on a mini siege run: the page is served as
// `pnpm cli debug` serves it, opened in headless Chromium, stepped forward and back through
// `window.__wwDebugger`, and its hashes compared with the run's golden file at every tick it lands
// on, with the state and the world's event log read from the page. Engine 0.14 T11: a failing
// replay written by `run` opens at its failing tick with the failed check shown, and the mini
// siege's played run's timeline is read (text and rows) and clicked. Skipped where Chromium is not
// installed (never in CI).

const RUN = 'games/samples/mini-siege/runs/delegated.run.json';
const golden = new Map(
  (
    JSON.parse(readFileSync(join(ROOT, RUN.replace(/\.run\.json$/, '.hashes.json')), 'utf8')) as {
      hashes: { tick: number; hash: string }[];
    }
  ).hashes.map((h) => [h.tick, h.hash]),
);

const missing = await browserMissing();
if (missing) console.warn(`skipping the debugger page test: ${missing}`);

describe.skipIf(missing !== null)('the debugger page on a mini siege run', () => {
  let browser: Browser;
  let server: DebugServer;
  let page: Page;

  beforeAll(async () => {
    const built = await buildDebugJob(ROOT, RUN);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    server = await startDebugServer(built.value);
    browser = await launch();
    page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(server.url);
    await page.waitForFunction(
      () => window.__wwDebugger?.ready === true || window.__wwDebugger?.error,
      undefined,
      {
        timeout: 60_000,
      },
    );
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.__wwDebugger!.error)).toBeNull();
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  const at = () =>
    page.evaluate(() => {
      const d = window.__wwDebugger!;
      return { tick: d.tick, hash: d.hash(), mismatch: d.mismatch() };
    });

  it('steps forward and back with the golden hashes', async () => {
    expect(await at()).toEqual({ tick: 0, hash: golden.get(0), mismatch: null });
    expect(await page.evaluate(() => window.__wwDebugger!.step(40))).toBe(40);
    expect(await at()).toEqual({ tick: 40, hash: golden.get(40), mismatch: null });
    expect(await page.evaluate(() => window.__wwDebugger!.goto(160))).toBe(160);
    expect((await at()).hash).toBe(golden.get(160));
    expect(await page.evaluate(() => window.__wwDebugger!.goto(60))).toBe(60);
    expect((await at()).hash).toBe(golden.get(60));
    expect(await page.evaluate(() => window.__wwDebugger!.step(100))).toBe(160);
    expect(await at()).toEqual({ tick: 160, hash: golden.get(160), mismatch: null });
    expect(await page.evaluate(() => window.__wwDebugger!.kind)).toBe('run');
  }, 60_000);

  it('reads the state, the diff and the event log through the hook', async () => {
    await page.evaluate(() => window.__wwDebugger!.goto(40));
    const read = await page.evaluate(() => {
      const d = window.__wwDebugger!;
      const state = d.state() as { world?: { tick?: number } };
      return {
        worldTick: state.world?.tick,
        events: d.events()?.length ?? null,
        mission: d.events({ cause: 'mission' })?.length ?? null,
        count: d.eventCount(),
        diff: d.diff().length,
        checks: d.checks().filter((c) => !c.passed).length,
      };
    });
    expect(read.worldTick).toBe(40);
    expect(read.events).toBe(read.count);
    expect(read.count).toBeGreaterThan(0);
    expect(read.diff).toBeGreaterThan(0);
    expect(read.checks).toBe(0);
    // The mission opens at tick 40 (after its state): its changes appear once the page steps past.
    expect(read.mission).toBe(0);
    await page.evaluate(() => window.__wwDebugger!.step(1));
    const after = await page.evaluate(() => window.__wwDebugger!.events({ cause: 'mission' })!.length);
    expect(after).toBeGreaterThan(0);
    await page.evaluate(() => window.__wwDebugger!.goto(40));
    expect(await page.evaluate(() => window.__wwDebugger!.events({ cause: 'mission' })!.length)).toBe(0);
    // The panels show the same: the tick, and the event log's head line.
    expect(await page.textContent('#where')).toContain('tick 40 / 260');
    expect(await page.textContent('#events-head')).toMatch(/change\(s\) shown of \d+ kept/);
  }, 60_000);
});

/** Opens the debugger page on `file` (as `pnpm cli debug` serves it) and waits for it to load. */
async function openPage(browser: Browser, file: string): Promise<{ page: Page; server: DebugServer }> {
  const built = await buildDebugJob(ROOT, file);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  const server = await startDebugServer(built.value);
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(server.url);
  await page.waitForFunction(
    () => window.__wwDebugger?.ready === true || window.__wwDebugger?.error,
    undefined,
    { timeout: 60_000 },
  );
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__wwDebugger!.error)).toBeNull();
  return { page, server };
}

describe.skipIf(missing !== null)('the debugger page on a failing replay and a timeline (T11)', () => {
  let browser: Browser;
  const servers: DebugServer[] = [];
  const temps: string[] = [];

  beforeAll(async () => {
    browser = await launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await Promise.all(servers.map((s) => s.close()));
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
  });

  it('opens a failing replay at its failing tick with the failed check and the tick before', async () => {
    // A deliberately failing run: the demo's walk-east with an assertion it cannot pass.
    const dir = mkdtempSync(join(tmpdir(), 'ww-debugger-replay-'));
    temps.push(dir);
    const run = JSON.parse(
      readFileSync(join(ROOT, 'games/samples/dungeon/runs/walk-east.run.json'), 'utf8'),
    ) as {
      game: string;
      assertions: unknown[];
    };
    run.game = relative(dir, join(ROOT, 'games/samples/dungeon'));
    run.assertions.push({ tick: 100, path: 'hero.room', op: 'eq', value: 'nowhere' });
    writeFileSync(join(dir, 'failing.run.json'), JSON.stringify(run));
    let stdout = '';
    await main(['run', relative(ROOT, join(dir, 'failing.run.json')), '--json'], {
      stdout: (t) => void (stdout += t),
      stderr: () => {},
      cwd: ROOT,
      outDir: relative(ROOT, join(dir, 'out')),
    });
    const replayFile = (JSON.parse(stdout) as { replayFile: string }).replayFile;
    const stored = (
      JSON.parse(readFileSync(join(ROOT, replayFile), 'utf8')) as { replay: { failure: { tick: number } } }
    ).replay.failure;

    const { page, server } = await openPage(browser, replayFile);
    servers.push(server);
    expect(await page.evaluate(() => window.__wwDebugger!.tick)).toBe(stored.tick);
    expect(await page.evaluate(() => window.__wwDebugger!.kind)).toBe('replay');
    expect(await page.evaluate(() => window.__wwDebugger!.failure())).toMatchObject({
      tick: 100,
      path: 'hero.room',
      op: 'eq',
      expected: 'nowhere',
      actual: 'guard-room',
      reproduced: true,
      tickBefore: 99,
    });
    expect(await page.isVisible('#failure')).toBe(true);
    const text = await page.textContent('#failure-text');
    expect(text).toContain('hero.room eq "nowhere"');
    expect(text).toContain('actual "guard-room"');
    await page.click('#fail-before');
    expect(await page.evaluate(() => window.__wwDebugger!.tick)).toBe(99);
    await page.click('#fail-at');
    expect(await page.evaluate(() => window.__wwDebugger!.tick)).toBe(100);
    // The demo has no world, so no timeline.
    expect(await page.evaluate(() => window.__wwDebugger!.timeline())).toBeNull();
  }, 120_000);

  it("reads the mini siege's played run's timeline: the sabotage open, the frozen span and the commit", async () => {
    const { page, server } = await openPage(browser, 'games/samples/mini-siege/runs/played.run.json');
    servers.push(server);
    expect(await page.evaluate(() => window.__wwDebugger!.goto(666))).toBe(666);
    const text = (await page.evaluate(() => window.__wwDebugger!.timeline()))!;
    expect(text).toContain('world clock: game 0-40 world 0-40 | game 40-446 world stands at 40');
    expect(text).toContain('frozen siege: game 40-566 siege frozen by mission:sabotage');
    expect(text).toContain('game 40 (world 40) open: open sabotage');
    expect(text).toContain('game 40 (world 40) opportunity: sabotage-window taken by mission:sabotage');
    expect(text).toContain('game 566 (world 160) commit: commit sabotage: both-burnt (played)');
    const rows = await page.evaluate(() => window.__wwDebugger!.timelineLayout()!.rows.map((r) => r.id));
    expect(rows).toContain('frozen:siege:40');
    expect(rows).toContain('mission:sabotage');
    // The panel draws the same rows; clicking the commit marker goes to its game tick.
    await page.goto(server.url.replace('tick=0', 'tick=666'));
    await page.waitForFunction(() => window.__wwDebugger?.ready === true);
    expect(await page.locator('#timeline .tl-row').count()).toBe(rows.length);
    await page.click('#timeline [data-row="mission:sabotage"] .tl-m-commit');
    expect(await page.evaluate(() => window.__wwDebugger!.tick)).toBe(566);
    await page.click('#timeline [data-row="mission:sabotage"] .tl-m-open');
    expect(await page.evaluate(() => window.__wwDebugger!.tick)).toBe(40);
    // Back at tick 40 the record is the world's then: the sabotage just opened, nothing committed.
    const at40 = (await page.evaluate(() => window.__wwDebugger!.timeline()))!;
    expect(at40).not.toContain('commit sabotage');
  }, 120_000);
});
