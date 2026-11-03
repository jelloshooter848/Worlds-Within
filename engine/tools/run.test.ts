import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './exit-codes';
import { main } from './main';
import { failsCheck, valueAt } from './run-file';
import { debugLine } from './commands/run';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WALK = 'games/demo/runs/walk-east.run.json';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ww-run-'));
  temps.push(dir);
  return dir;
}

async function cli(
  argv: string[],
  cwd = ROOT,
): Promise<{ code: number; stdout: string; result: Record<string, unknown> }> {
  let stdout = '';
  const code = await main(argv, {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd,
    outDir: join(tempDir(), 'out'),
  });
  let result: Record<string, unknown> = {};
  if (argv.includes('--json')) {
    expect(stdout.split('\n')).toHaveLength(2);
    result = JSON.parse(stdout) as Record<string, unknown>;
  }
  return { code, stdout, result };
}

/** The walk-east run with `edit` applied, written to a temp folder (its game is games/demo). */
function runFile(edit: (run: Record<string, unknown>) => void): string {
  const run = JSON.parse(readFileSync(join(ROOT, WALK), 'utf8')) as Record<string, unknown>;
  run.game = join(ROOT, 'games/demo');
  edit(run);
  const file = join(tempDir(), 'edited.run.json');
  writeFileSync(file, JSON.stringify(run, null, 2));
  return file;
}

describe('run', () => {
  it('passes the walk-east run and lists state hashes', async () => {
    const { code, result } = await cli(['run', WALK, '--json']);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({
      ok: true,
      command: 'run',
      run: WALK,
      game: 'games/demo',
      seed: 1,
      ticks: 240,
      lastTick: 240,
      passed: true,
      failure: null,
      failures: [],
      checks: { assertions: 3, invariants: 2 },
    });
    const hashes = result.hashes as { tick: number; hash: string }[];
    expect(hashes.map((h) => h.tick)).toEqual([0, 40, 80, 120, 160, 200, 240]);
    for (const h of hashes) expect(h.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(result.finalHash).toBe(hashes[6]!.hash);
  });

  it('gives the same hashes on two runs in a row', async () => {
    const a = await cli(['run', WALK, '--json']);
    const b = await cli(['run', WALK, '--json']);
    expect(b.result.hashes).toEqual(a.result.hashes);
  });

  it('gives different hashes for a different seed or input', async () => {
    const base = (await cli(['run', WALK, '--json'])).result.hashes as { hash: string }[];
    const still = runFile((r) => (r.input = { steps: [] }));
    const other = (await cli(['run', still, '--json'])).result.hashes as { hash: string }[];
    expect(other[0]!.hash).toBe(base[0]!.hash);
    expect(other[6]!.hash).not.toBe(base[6]!.hash);
  });

  it('reports the first failing tick of a wrong assertion, with expected and actual', async () => {
    const file = runFile((r) => {
      r.assertions = [
        { tick: 200, path: 'hero.hp', op: 'eq', value: 3 },
        { tick: 30, path: 'room', op: 'eq', value: 'guard-room' },
      ];
    });
    const { code, result } = await cli(['run', file, '--json']);
    expect(code).toBe(EXIT.failedCheck);
    expect(result).toMatchObject({ ok: false, exitCode: 4, passed: false, lastTick: 30 });
    expect(result.failure).toEqual({
      tick: 30,
      kind: 'assertion',
      index: 1,
      path: 'room',
      op: 'eq',
      expected: 'guard-room',
      actual: 'courtyard',
      message: 'room is "courtyard", expected "guard-room"',
    });
    const hashes = result.hashes as { tick: number }[];
    expect(hashes[hashes.length - 1]!.tick).toBe(30);
  });

  it('checks invariants on every tick, tick 0 included', async () => {
    const file = runFile((r) => (r.invariants = [{ path: 'room', op: 'eq', value: 'courtyard' }]));
    const { code, result } = await cli(['run', file, '--json']);
    expect(code).toBe(EXIT.failedCheck);
    const failure = result.failure as { tick: number; kind: string; actual: unknown };
    expect(failure.kind).toBe('invariant');
    expect(failure.actual).toBe('guard-room');
    expect(failure.tick).toBeGreaterThan(0);
    // The tick before it held.
    const dumped = await cli(['dump', file, '--tick', String(failure.tick - 1), '--json']);
    expect((dumped.result.state as { room: string }).room).toBe('courtyard');
  });

  it('fails a check on a path that is not in the snapshot', async () => {
    const file = runFile((r) => (r.invariants = [{ path: 'hero.hpp', op: 'ne', value: 0 }]));
    const { result } = await cli(['run', file, '--json']);
    expect(result.failure).toMatchObject({ tick: 0, actual: null, message: 'no value at "hero.hpp"' });
  });

  it('names the run file and field of a broken run file, with the invalid-content code', async () => {
    const file = runFile((r) => {
      r.assertions = [{ tick: 500, path: 'room', op: 'gte', value: 'x' }];
    });
    const { code, result } = await cli(['run', file, '--json']);
    expect(code).toBe(EXIT.invalidContent);
    const errors = result.errors as { file: string; path: string }[];
    expect(errors.map((e) => e.path).sort()).toEqual(['assertions.0.tick', 'assertions.0.value']);
    expect(errors[0]!.file).toMatch(/edited\.run\.json$/);
  });

  it('reports bad game content as invalid content', async () => {
    const root = tempDir();
    cpSync(join(ROOT, 'games/demo'), join(root, 'games/demo'), { recursive: true });
    writeFileSync(join(root, 'games/demo/content/songs/demo.json'), '{ nope');
    const { code, result } = await cli(['run', WALK, '--json'], root);
    expect(code).toBe(EXIT.invalidContent);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ file: 'games/demo/content/songs/demo.json' }),
    );
  });

  it('reports a missing headless module at the manifest field', async () => {
    const root = tempDir();
    cpSync(join(ROOT, 'games/demo'), join(root, 'games/demo'), { recursive: true });
    const manifest = join(root, 'games/demo/game.json');
    writeFileSync(manifest, readFileSync(manifest, 'utf8').replace('"headless.ts"', '"gone.ts"'));
    const { code, result } = await cli(['run', WALK, '--json'], root);
    expect(code).toBe(EXIT.invalidContent);
    expect(result.errors).toEqual([
      expect.objectContaining({ file: 'games/demo/game.json', path: 'headless', code: 'missing_file' }),
    ]);
  });

  it('calls a missing run file a usage error', async () => {
    const { code, result } = await cli(['run', 'games/demo/runs/nope.run.json', '--json']);
    expect(code).toBe(EXIT.usage);
    expect(result).toMatchObject({ error: { kind: 'usage' } });
  });

  it('prints a pass line and the hashes for people', async () => {
    const { stdout } = await cli(['run', WALK]);
    expect(stdout).toContain(`${WALK}: passed (seed 1, 240/240 ticks)`);
    expect(stdout).toMatch(/hash @240: [0-9a-f]{16}/);
  });
});

describe('replay files', () => {
  type Hash = { tick: number; hash: string };
  type Failure = { tick: number; kind: string; path: string; op: string; expected: unknown };
  const sameCheck = (f: Failure) => ({
    tick: f.tick,
    kind: f.kind,
    path: f.path,
    op: f.op,
    expected: f.expected,
  });

  /** The walk-east run with a wrong assertion at tick 100, played once. */
  async function failing() {
    const file = runFile((r) => {
      (r.assertions as unknown[]).push({ tick: 100, path: 'hero.room', op: 'eq', value: 'nowhere' });
    });
    const first = await cli(['run', file, '--json']);
    const replayFile = resolve(ROOT, first.result.replayFile as string);
    return { file, first: first.result, replayFile };
  }

  it('a failing run writes a replay file whose path is in the result', async () => {
    const { file, first, replayFile } = await failing();
    expect(first).toMatchObject({ exitCode: 4, lastTick: 100, replay: null });
    expect(first.replayFile).toMatch(/replays\/edited-t100-[0-9a-f]{12}\.run\.json$/);
    const replay = JSON.parse(readFileSync(replayFile, 'utf8')) as Record<string, unknown>;
    expect(replay).toMatchObject({ seed: 1, ticks: 100, hashEvery: 40 });
    expect((replay.assertions as { tick: number }[]).every((a) => a.tick <= 100)).toBe(true);
    const stored = replay.replay as { source: string; failure: Failure; hashes: Hash[] };
    expect(resolve(replayFile, '..', stored.source)).toBe(resolve(file));
    expect(sameCheck(stored.failure)).toEqual(sameCheck(first.failure as Failure));
    expect(stored.hashes).toEqual(first.hashes);
  });

  it('a passing run writes no replay file', async () => {
    const { result } = await cli(['run', WALK, '--json']);
    expect(result).toMatchObject({ replayFile: null, replay: null, debug: null });
  });

  it('a failing run names the debugger line that opens its replay at the failing tick', async () => {
    const { first } = await failing();
    expect(first.debug).toBe(`pnpm cli debug ${String(first.replayFile)}`);
    const file = runFile((r) => {
      (r.assertions as unknown[]).push({ tick: 100, path: 'hero.room', op: 'eq', value: 'nowhere' });
    });
    const text = await cli(['run', file]);
    expect(text.stdout).toMatch(
      /open it in the debugger: pnpm cli debug \S+replays\/edited-t100-[0-9a-f]{12}\.run\.json/,
    );
    // A replay that fails again opens itself; a world run has no debugger line.
    const again = await cli(['run', String(first.replayFile), '--json']);
    expect(again.result.debug).toBe(`pnpm cli debug ${String(first.replayFile)}`);
    expect(debugLine('w.run.json', 'w.world.json', null, null)).toBeNull();
    expect(debugLine('r.run.json', null, null, 40)).toBe('pnpm cli debug r.run.json --tick 40');
  });

  it('running the replay fails at the same tick, with the same check and the same hashes', async () => {
    const { file, first, replayFile } = await failing();
    const { code, result } = await cli(['run', replayFile, '--json']);
    expect(code).toBe(EXIT.failedCheck);
    expect(result).toMatchObject({ passed: false, lastTick: 100, replayFile: null });
    expect(sameCheck(result.failure as Failure)).toEqual(sameCheck(first.failure as Failure));
    expect(result.hashes).toEqual(first.hashes);
    expect(result.replay).toEqual({
      source: expect.any(String),
      expectedTick: 100,
      reproduced: true,
      hashesChecked: (first.hashes as Hash[]).length,
      hashMismatch: null,
    });
    expect(resolve(ROOT, (result.replay as { source: string }).source)).toBe(resolve(file));
  });

  it('reports the first tick whose hash differs from the stored one', async () => {
    const { replayFile } = await failing();
    const replay = JSON.parse(readFileSync(replayFile, 'utf8')) as { replay: { hashes: Hash[] } };
    const at80 = replay.replay.hashes.find((h) => h.tick === 80)!;
    const real = at80.hash;
    at80.hash = '0000000000000000';
    replay.replay.hashes.find((h) => h.tick === 100)!.hash = 'ffffffffffffffff';
    writeFileSync(replayFile, JSON.stringify(replay));
    const { code, result } = await cli(['run', replayFile, '--json']);
    expect(code).toBe(EXIT.failedCheck);
    expect(result.passed).toBe(false);
    expect(result.replay).toMatchObject({
      reproduced: true,
      hashMismatch: { tick: 80, expected: '0000000000000000', actual: real },
    });
    const text = await cli(['run', replayFile]);
    expect(text.stdout).toContain('hash MISMATCH at tick 80');
  });

  it('checks the replay block like the rest of the run file', async () => {
    const { replayFile } = await failing();
    const replay = JSON.parse(readFileSync(replayFile, 'utf8')) as { replay: { hashes: Hash[] } };
    replay.replay.hashes[0]!.hash = 'not-a-hash';
    writeFileSync(replayFile, JSON.stringify(replay));
    const { code, result } = await cli(['run', replayFile, '--json']);
    expect(code).toBe(EXIT.invalidContent);
    expect(JSON.stringify(result.errors)).toContain('replay.hashes.0.hash');
  });

  it('writes a replay that stops at tick 0 for a failure at the start', async () => {
    const file = runFile((r) => (r.invariants = [{ path: 'room', op: 'eq', value: 'guard-room' }]));
    const first = await cli(['run', file, '--json']);
    expect(first.result.lastTick).toBe(0);
    const again = await cli(['run', resolve(ROOT, first.result.replayFile as string), '--json']);
    expect(again.result).toMatchObject({ lastTick: 0, replay: { reproduced: true, hashMismatch: null } });
  });
});

describe('dump', () => {
  it('prints the snapshot at a tick, with the hash run gives for that tick', async () => {
    const { code, result } = await cli(['dump', WALK, '--tick', '240', '--json']);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({ ok: true, command: 'dump', run: WALK, tick: 240, seed: 1 });
    const state = result.state as { room: string; hero: { room: string; hp: number } };
    expect(state.room).toBe('guard-room');
    expect(state.hero).toMatchObject({ room: 'guard-room', hp: 6 });
    const run = await cli(['run', WALK, '--json']);
    expect(result.hash).toBe(run.result.finalHash);
  });

  it('shows the start at tick 0', async () => {
    const { result } = await cli(['dump', WALK, '--tick', '0', '--json']);
    expect(result).toMatchObject({ tick: 0, state: { frame: 0, room: 'courtyard' } });
  });

  it('is capped like every command', async () => {
    const { result } = await cli(['dump', WALK, '--tick', '10', '--json', '--max-output', '256']);
    expect(result).toMatchObject({ truncated: true, command: 'dump' });
    expect(result.fullOutput).toMatch(/dump-[0-9a-f]+\.json$/);
  });

  it.each([[['dump', WALK, '--json']], [['dump', WALK, '--tick', '241', '--json']]])(
    'calls %j a usage error',
    async (argv) => {
      expect((await cli(argv)).code).toBe(EXIT.usage);
    },
  );
});

describe('checks', () => {
  const state = { hero: { hp: 4, room: 'a' }, list: [1, { k: 'v' }], name: 'guard-room' };

  it('reads dotted paths, array indexes and lengths', () => {
    expect(valueAt(state, 'hero.hp')).toBe(4);
    expect(valueAt(state, 'list.1.k')).toBe('v');
    expect(valueAt(state, 'list.length')).toBe(2);
    expect(valueAt(state, 'list.x')).toBeUndefined();
    expect(valueAt(state, 'hero.hp.x')).toBeUndefined();
    expect(valueAt(state, 'toString')).toBeUndefined();
  });

  it.each([
    ['hero.hp', 'eq', 4, true],
    ['hero.hp', 'ne', 4, false],
    ['hero.hp', 'lt', 5, true],
    ['hero.hp', 'lte', 3, false],
    ['hero.hp', 'gt', 3, true],
    ['hero.hp', 'gte', 4, true],
    ['hero.room', 'in', ['a', 'b'], true],
    ['hero.room', 'nin', ['a', 'b'], false],
    ['list', 'contains', { k: 'v' }, true],
    ['name', 'contains', 'guard', true],
    ['hero', 'eq', { room: 'a', hp: 4 }, true],
    ['name', 'gt', 1, false],
  ] as const)('%s %s %j holds: %s', (path, op, value, holds) => {
    expect(failsCheck(state, { path, op, value: value as never }) === null).toBe(holds);
  });
});
