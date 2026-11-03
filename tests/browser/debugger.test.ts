import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { buildDebugJob, startDebugServer, type DebugServer } from '@engine/tools/debugger/server';
import { browserMissing, launch, ROOT } from './serve';

// The in-browser simulation debugger (Engine 0.14 T10) on a mini siege run: the page is served as
// `pnpm cli debug` serves it, opened in headless Chromium, stepped forward and back through
// `window.__wwDebugger`, and its hashes compared with the run's golden file at every tick it lands
// on, with the state and the world's event log read from the page. Skipped where Chromium is not
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
