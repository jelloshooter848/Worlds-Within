import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { Browser, Page } from 'playwright';
import { buildDebugJob, startDebugServer, type DebugServer } from '@engine/tools/debugger/server';
import { main } from '@engine/tools/main';
import { browserMissing, launch, ROOT } from './serve';

// Engine 0.14's Done when (docs/ROADMAP.md, "0.14 Creator tools v1"): "a new scenario added to the
// mini siege with data files only can be stepped through in the debugger, and a failing replay
// from the CLI opens at its failing tick". The new scenario is the ridge camp (T12): a third
// campaign entry with its own map, mission and run file, and no `.ts` change in the game. Its run
// file is opened in the debugger as `pnpm cli debug` serves it, stepped forward and rewound with
// the golden hashes checked at every hashed tick, and its timeline read against `pnpm cli
// timeline`. Then a temp copy of it with an assertion it cannot pass is run with `run --json`, and
// the replay file it names is opened with `debug --check` and in the page, at its failing tick.
// Skipped where Chromium is not installed (never in CI).

const RUN = 'games/samples/mini-siege/runs/ridge-raid.run.json';
const golden = (
  JSON.parse(readFileSync(join(ROOT, RUN.replace(/\.run\.json$/, '.hashes.json')), 'utf8')) as {
    hashes: { tick: number; hash: string }[];
  }
).hashes;

/** Runs the CLI in-process with `--json`; returns the exit code and the parsed result. */
async function cli(
  argv: string[],
  outDir?: string,
): Promise<{ code: number; result: Record<string, unknown> }> {
  let stdout = '';
  const code = await main([...argv, '--json'], {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd: ROOT,
    ...(outDir === undefined ? {} : { outDir }),
  });
  return { code, result: JSON.parse(stdout) as Record<string, unknown> };
}

const missing = await browserMissing();
if (missing) console.warn(`skipping the debugger done-when test: ${missing}`);

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

describe('the ridge camp is data only', () => {
  it('is a campaign entry the run file starts at, passing with its golden hashes', async () => {
    const run = JSON.parse(readFileSync(join(ROOT, RUN), 'utf8')) as { start: unknown };
    expect(run.start).toEqual({ entry: 'ridge' });
    const { code, result } = await cli(['run', RUN]);
    expect(code).toBe(0);
    expect(result).toMatchObject({ passed: true, start: { entry: 'ridge' }, failure: null });
    expect(result.hashes).toEqual(golden);
  }, 60_000);
});

describe.skipIf(missing !== null)("Engine 0.14's Done when: the ridge camp in the debugger", () => {
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

  it('steps forward and rewinds through the new scenario with the golden hashes and its timeline', async () => {
    const { page, server } = await openPage(browser, RUN);
    servers.push(server);
    const at = () =>
      page.evaluate(() => {
        const d = window.__wwDebugger!;
        return { tick: d.tick, hash: d.hash(), mismatch: d.mismatch() };
      });
    expect(await page.evaluate(() => window.__wwDebugger!.kind)).toBe('run');
    // Forward over every hashed tick, then rewound back over them in reverse.
    for (const { tick, hash } of golden) {
      const now = (await at()).tick;
      expect(await page.evaluate((n) => window.__wwDebugger!.step(n), tick - now)).toBe(tick);
      expect(await at()).toEqual({ tick, hash, mismatch: null });
    }
    for (const { tick, hash } of [...golden].reverse()) {
      expect(await page.evaluate((t) => window.__wwDebugger!.goto(t), tick)).toBe(tick);
      expect(await at()).toEqual({ tick, hash, mismatch: null });
    }
    // Every check of the run passes at the tick the stores are raided and the ram burns.
    await page.evaluate(() => window.__wwDebugger!.goto(30));
    const at30 = await page.evaluate(() => {
      const d = window.__wwDebugger!;
      // the ram by its scenario key, as the run file's own check reads it (Engine 0.15 T9: no
      // `named`): that check (`eq false`) passing at 30 is the ram burnt
      const ram = d.checks().find((c) => c.path === 'world.key.ram.alive' && c.tick === 30);
      return {
        ram: ram?.passed === true && ram.op === 'eq' ? ram.value : null,
        failed: d.checks().filter((c) => !c.passed).length,
        mission: d.events({ cause: 'mission' })?.length ?? null,
      };
    });
    expect(at30).toEqual({ ram: false, failed: 0, mission: expect.any(Number) });
    expect(at30.mission).toBeGreaterThan(0);

    // The timeline at the end: the window offered, taken and the commit, as `pnpm cli timeline` has.
    expect(await page.evaluate(() => window.__wwDebugger!.goto(160))).toBe(160);
    const text = (await page.evaluate(() => window.__wwDebugger!.timeline()))!;
    expect(text).toContain('stores-window');
    expect(text).toContain('open stores-raid');
    expect(text).toContain('commit stores-raid: ram-burnt (delegated)');
    const rows = await page.evaluate(() => window.__wwDebugger!.timelineLayout()!.rows.map((r) => r.id));
    expect(rows).toContain('mission:stores-raid');
    const { code, result } = await cli(['timeline', RUN]);
    expect(code).toBe(0);
    const record = (
      result as {
        timeline: {
          missions: { mission: string; openTick: number; commitTick: number; outcome: string }[];
          opportunities: { id: string; status: string }[];
        };
      }
    ).timeline;
    expect(record.missions).toEqual([
      expect.objectContaining({ mission: 'stores-raid', openTick: 10, commitTick: 30, outcome: 'ram-burnt' }),
    ]);
    expect(record.opportunities).toEqual([expect.objectContaining({ id: 'stores-window', status: 'taken' })]);
  }, 180_000);

  it("opens a deliberately failing copy's replay at its failing tick, with debug --check", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ww-done-when-'));
    temps.push(dir);
    const run = JSON.parse(readFileSync(join(ROOT, RUN), 'utf8')) as { game: string; assertions: unknown[] };
    run.game = relative(dir, join(ROOT, 'games/samples/mini-siege'));
    // The ram burns at tick 30: an assertion that it still stands there cannot pass.
    run.assertions.push({ tick: 30, path: 'world.key.ram.alive', op: 'eq', value: true });
    writeFileSync(join(dir, 'ridge-wrong.run.json'), JSON.stringify(run, null, 2));
    const failed = await cli(
      ['run', relative(ROOT, join(dir, 'ridge-wrong.run.json'))],
      relative(ROOT, join(dir, 'out')),
    );
    expect(failed.code).toBe(4);
    const replayFile = failed.result.replayFile as string;
    expect(replayFile).toEqual(expect.any(String));
    const stored = JSON.parse(readFileSync(join(ROOT, replayFile), 'utf8')) as {
      start?: unknown;
      replay: { failure: { tick: number; path: string } };
    };
    expect(stored.start).toEqual({ entry: 'ridge' });
    expect(stored.replay.failure).toMatchObject({ tick: 30, path: 'world.key.ram.alive' });

    const checked = await cli(['debug', replayFile, '--check']);
    expect(checked.code).toBe(0);
    expect(checked.result).toMatchObject({
      kind: 'replay',
      tick: stored.replay.failure.tick,
      openTick: stored.replay.failure.tick,
      matchesHeadless: true,
      mismatch: null,
      reproduced: true,
      hashMismatch: null,
      failure: { tick: 30, path: 'world.key.ram.alive', expected: true, actual: false },
    });

    const { page, server } = await openPage(browser, replayFile);
    servers.push(server);
    expect(await page.evaluate(() => window.__wwDebugger!.tick)).toBe(stored.replay.failure.tick);
    expect(await page.evaluate(() => window.__wwDebugger!.failure())).toMatchObject({
      tick: 30,
      path: 'world.key.ram.alive',
      expected: true,
      actual: false,
      reproduced: true,
      tickBefore: 29,
    });
    expect(await page.textContent('#failure-text')).toContain('world.key.ram.alive eq true');
  }, 180_000);
});
