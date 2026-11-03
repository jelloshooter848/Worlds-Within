import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './exit-codes';
import { main } from './main';
import { launchChromium, NoBrowserError } from './screenshot';
import { DEBUG_JOB_PATH } from './debugger/job';
import { closeDebugServers } from './debugger/server';

// `pnpm cli debug` (Engine 0.14 T10): the kinds of file it opens, its usage and content errors,
// the server's read-only job route, and with `--check` the page in headless Chromium against the
// headless run (skipped where Chromium is not installed, never in CI).

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WALK = 'games/demo/runs/walk-east.run.json';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterAll(() => closeDebugServers());

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ww-debug-'));
  temps.push(dir);
  return dir;
}

async function cli(argv: string[]): Promise<{ code: number; result: Record<string, unknown> }> {
  let stdout = '';
  const code = await main([...argv, '--json'], {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd: ROOT,
    outDir: join(tempDir(), 'out'),
  });
  expect(stdout.split('\n')).toHaveLength(2);
  return { code, result: JSON.parse(stdout) as Record<string, unknown> };
}

/** A copy of the demo's run file in a temp folder, changed by `edit`; its path from the repo. */
function walkCopy(edit: (run: Record<string, unknown>) => void): string {
  const dir = tempDir();
  const run = JSON.parse(readFileSync(join(ROOT, WALK), 'utf8')) as Record<string, unknown>;
  run.game = relative(dir, join(ROOT, 'games/demo'));
  edit(run);
  const file = join(dir, 'walk.run.json');
  writeFileSync(file, JSON.stringify(run));
  return relative(ROOT, file);
}

describe('debug: files and errors', () => {
  it('is a usage error for a file that is not there, a tick past the run and a world run', async () => {
    expect((await cli(['debug', 'games/demo/runs/nope.run.json'])).code).toBe(EXIT.usage);
    const late = await cli(['debug', WALK, '--tick', '241']);
    expect(late.code).toBe(EXIT.usage);
    expect(JSON.stringify(late.result)).toMatch(/after the run's last tick/);
    const world = await cli(['debug', 'engine/sim/__fixtures__/village-build.run.json']);
    expect(world.code).toBe(EXIT.usage);
    expect(JSON.stringify(world.result)).toMatch(/dump/);
  });

  it('is a content error for a file that is not JSON, a broken dump or a broken run file', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'bad.json'), '{ nope');
    writeFileSync(join(dir, 'dump.json'), JSON.stringify({ format: 'worlds-within/dump', version: 1 }));
    const notJson = await cli(['debug', relative(ROOT, join(dir, 'bad.json'))]);
    expect(notJson.code).toBe(EXIT.invalidContent);
    const dump = await cli(['debug', relative(ROOT, join(dir, 'dump.json'))]);
    expect(dump.code).toBe(EXIT.invalidContent);
    expect((dump.result.errors as { code: string }[])[0]!.code).toBe('invalid_dump');
    const run = await cli(['debug', walkCopy((r) => (r.ticks = -1))]);
    expect(run.code).toBe(EXIT.invalidContent);
  });

  it('serves the page and the job, read-only, until stopped', async () => {
    const { code, result } = await cli(['debug', WALK, '--tick', '30']);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({
      file: WALK,
      kind: 'run',
      game: 'games/demo',
      ticks: 240,
      openTick: 30,
      serving: true,
    });
    const url = new URL(String(result.url));
    expect(url.pathname).toBe('/engine/tools/debugger/index.html');
    expect(url.searchParams.get('tick')).toBe('30');
    const job = (await (await fetch(new URL(DEBUG_JOB_PATH, url))).json()) as Record<string, unknown>;
    expect(job).toMatchObject({
      kind: 'run',
      file: WALK,
      seed: 1,
      ticks: 240,
      openTick: 30,
      viewUrl: '/games/demo/view.ts',
    });
    expect((job.expected as unknown[]).length).toBeGreaterThan(0);
    expect((await fetch(new URL(DEBUG_JOB_PATH, url), { method: 'POST' })).status).toBe(405);
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('page.ts');
    await closeDebugServers();
  });

  it('opens a dump at its own tick only', async () => {
    const out = join(tempDir(), 'walk-60.json');
    expect((await cli(['dump', WALK, '--tick', '60', '--out', out])).code).toBe(EXIT.ok);
    const other = await cli(['debug', relative(ROOT, out), '--tick', '61']);
    expect(other.code).toBe(EXIT.usage);
    const { code, result } = await cli(['debug', relative(ROOT, out)]);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({ kind: 'dump', game: 'games/demo', ticks: 240, openTick: 60 });
    await closeDebugServers();
  });
});

/** Whether headless Chromium starts here (required in CI, as in screenshot.test.ts). */
async function browserMissing(): Promise<string | null> {
  try {
    await (await launchChromium()).close();
    return null;
  } catch (error) {
    if (process.env.CI || !(error instanceof NoBrowserError)) return null;
    return error.message;
  }
}
const missing = await browserMissing();
if (missing) console.warn(`skipping the debugger browser checks: ${missing}`);

describe.skipIf(missing !== null)('debug --check (headless Chromium)', () => {
  it("shows the headless run's state at the tick", async () => {
    const { code, result } = await cli(['debug', WALK, '--tick', '60', '--check']);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({
      kind: 'run',
      tick: 60,
      matchesHeadless: true,
      mismatch: null,
      eventCount: null,
    });
    expect(result.hash).toBe(result.headlessHash);
  }, 60_000);

  it('opens a dump file read-only and checks it against its run', async () => {
    const out = join(tempDir(), 'siege-120.json');
    const siege = 'games/samples/mini-siege/runs/delegated.run.json';
    expect((await cli(['dump', siege, '--tick', '120', '--out', out])).code).toBe(EXIT.ok);
    const { code, result } = await cli(['debug', relative(ROOT, out), '--check']);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({ kind: 'dump', tick: 120, matchesHeadless: true, mismatch: null });
    expect(result.eventCount).toBeGreaterThan(0);
  }, 60_000);

  it('opens a replay at its failing tick', async () => {
    const failing = walkCopy((r) => {
      (r.assertions as unknown[]).push({ tick: 100, path: 'hero.room', op: 'eq', value: 'nowhere' });
    });
    const dir = tempDir();
    let stdout = '';
    await main(['run', failing, '--json'], {
      stdout: (t) => void (stdout += t),
      stderr: () => {},
      cwd: ROOT,
      outDir: relative(ROOT, dir),
    });
    const replay = String((JSON.parse(stdout) as { replayFile: string }).replayFile);
    const { code, result } = await cli(['debug', replay, '--check']);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({ kind: 'replay', openTick: 100, tick: 100, matchesHeadless: true });
  }, 60_000);

  it('exits 4 when the page finds a stored hash that differs', async () => {
    const wrong = walkCopy((r) => (r.hashes = [{ tick: 20, hash: '0000000000000000' }]));
    const { code, result } = await cli(['debug', wrong, '--tick', '40', '--check']);
    expect(code).toBe(EXIT.failedCheck);
    expect(result).toMatchObject({
      tick: 20,
      mismatch: { tick: 20, kind: 'stored', expected: '0000000000000000' },
    });
    expect(result.matchesHeadless).toBe(false);
  }, 60_000);
});
