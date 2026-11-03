import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './exit-codes';
import { main } from './main';

// Engine 0.8 T8: `run`, `dump`, state hashes and replays on a world run file (`world` instead of
// `game`), with the sample world engine/sim/__fixtures__/village.world.json.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const VILLAGE = 'engine/sim/__fixtures__/village-build.run.json';
const SCENARIO = join(ROOT, 'engine/sim/__fixtures__/village.world.json');
const SIM_GOLDEN = join(ROOT, 'engine/sim/__fixtures__/village.hashes.json');

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ww-world-run-'));
  temps.push(dir);
  return dir;
}

async function cli(argv: string[], outDir = join(tempDir(), 'out')) {
  let stdout = '';
  const code = await main([...argv, '--json'], {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd: ROOT,
    outDir,
  });
  return { code, result: JSON.parse(stdout) as Record<string, unknown> };
}

/** A run file in a temp folder: the village run with `edit` applied (`world` made absolute). */
function runFile(edit: (run: Record<string, unknown>) => void): string {
  const run = JSON.parse(readFileSync(join(ROOT, VILLAGE), 'utf8')) as Record<string, unknown>;
  run.world = SCENARIO;
  edit(run);
  const file = join(tempDir(), 'edited.run.json');
  writeFileSync(file, JSON.stringify(run, null, 2));
  return file;
}

interface TickHash {
  tick: number;
  hash: string;
}

describe('run on a world', () => {
  it('passes the village run, with the hashes engine/sim takes of the same world', async () => {
    const { code, result } = await cli(['run', VILLAGE]);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({
      ok: true,
      run: VILLAGE,
      game: null,
      world: 'engine/sim/__fixtures__/village.world.json',
      seed: 1808,
      disabledRules: [],
      ticks: 1000,
      lastTick: 1000,
      passed: true,
      failure: null,
      replayFile: null,
    });
    const hashes = result.hashes as TickHash[];
    expect(hashes.map((h) => h.tick)).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    const sim = (JSON.parse(readFileSync(SIM_GOLDEN, 'utf8')) as { hashes: TickHash[] }).hashes;
    for (const h of hashes) expect(h).toEqual(sim.find((s) => s.tick === h.tick));
    const again = await cli(['run', VILLAGE]);
    expect(again.result.hashes).toEqual(hashes);
  });

  it('takes the run file seed over the scenario seed', async () => {
    const { code, result } = await cli(['run', runFile((r) => (r.seed = 7))]);
    expect(code).toBe(EXIT.ok);
    expect(result.seed).toBe(7);
    const base = await cli(['run', VILLAGE]);
    expect(result.finalHash).not.toBe(base.result.finalHash);
  });

  it('fails a broken assertion, writes a replay that reproduces it and catches a hash mismatch', async () => {
    const out = join(tempDir(), 'out');
    const file = runFile((r) => {
      r.assertions = [{ tick: 300, path: 'components.Construction.0.1.done', op: 'eq', value: true }];
    });
    const failed = await cli(['run', file], out);
    expect(failed.code).toBe(EXIT.failedCheck);
    expect(failed.result.failure).toMatchObject({ tick: 300, kind: 'assertion', actual: false });
    const replayFile = failed.result.replayFile as string;
    expect(replayFile).toMatch(/edited-t300-[0-9a-f]{12}\.run\.json$/);
    const replay = JSON.parse(readFileSync(resolve(ROOT, replayFile), 'utf8')) as Record<string, unknown>;
    expect(replay).not.toHaveProperty('game');
    expect(resolve(ROOT, replayFile, '..', replay.world as string)).toBe(SCENARIO);

    const replayed = await cli(['run', replayFile]);
    expect(replayed.code).toBe(EXIT.failedCheck);
    expect(replayed.result.replayFile).toBeNull();
    expect(replayed.result.replay).toMatchObject({ reproduced: true, expectedTick: 300, hashMismatch: null });
    expect((replayed.result.replay as { hashesChecked: number }).hashesChecked).toBe(4);

    // Change one stored hash: the replay now reports the mismatch at that tick.
    const stored = replay.replay as { hashes: TickHash[] };
    stored.hashes[2]!.hash = '0000000000000000';
    writeFileSync(resolve(ROOT, replayFile), JSON.stringify(replay, null, 2));
    const mismatched = await cli(['run', replayFile]);
    expect(mismatched.code).toBe(EXIT.failedCheck);
    expect(mismatched.result.replay).toMatchObject({
      hashMismatch: { tick: 200, expected: '0000000000000000' },
    });
  });

  it('refuses --disable-rule: a world has no kit rules', async () => {
    const { code, result } = await cli(['run', VILLAGE, '--disable-rule', 'x']);
    expect(code).toBe(EXIT.usage);
    expect(JSON.stringify(result.error)).toContain('plays a world');
  });

  it('reports a scenario that does not build as content errors in the scenario file', async () => {
    const dir = tempDir();
    const bad = JSON.parse(readFileSync(SCENARIO, 'utf8')) as Record<string, unknown>;
    bad.version = 99;
    writeFileSync(join(dir, 'bad.world.json'), JSON.stringify(bad));
    const file = runFile((r) => (r.world = join(dir, 'bad.world.json')));
    const { code, result } = await cli(['run', file]);
    expect(code).toBe(EXIT.invalidContent);
    expect(result.errors).toEqual([expect.objectContaining({ path: 'version', code: 'invalid_scenario' })]);

    const missing = await cli(['run', runFile((r) => (r.world = join(dir, 'none.world.json')))]);
    expect(missing.code).toBe(EXIT.invalidContent);
    expect(missing.result.errors).toEqual([expect.objectContaining({ path: 'world', code: 'missing_file' })]);
  });
});

describe('run file schema: game or world', () => {
  const errorsOf = async (edit: (run: Record<string, unknown>) => void) => {
    const { code, result } = await cli(['run', runFile(edit)]);
    expect(code).toBe(EXIT.invalidContent);
    return result.errors as { path: string; message: string }[];
  };

  it('refuses a run file with both game and world', async () => {
    const errors = await errorsOf((r) => (r.game = '../games/samples/dungeon'));
    expect(errors).toEqual([
      expect.objectContaining({ path: 'world', message: 'a run file gives "game" or "world", not both' }),
    ]);
  });

  it('refuses a run file with neither', async () => {
    const errors = await errorsOf((r) => delete r.world);
    expect(errors).toEqual([
      expect.objectContaining({
        path: '',
        message:
          'a run file needs exactly one of "game" (a game folder) or "world" (a *.world.json scenario)',
      }),
    ]);
  });

  it('refuses input, disableRules and guards on a world run, and a world that is not *.world.json', async () => {
    const errors = await errorsOf((r) => {
      r.input = { steps: [{ frame: 0, hold: ['right'] }] };
      r.disableRules = ['x'];
      r.guards = ['y'];
    });
    expect(errors.map((e) => e.path).sort()).toEqual(['disableRules', 'guards', 'input.steps']);
    const named = await errorsOf((r) => (r.world = 'village.json'));
    expect(named).toEqual([expect.objectContaining({ path: 'world' })]);
  });
});

describe('dump and mutants on a world', () => {
  it('dump prints the world state and its hash at a tick', async () => {
    const run = await cli(['run', VILLAGE]);
    const { code, result } = await cli(['dump', VILLAGE, '--tick', '500', '--max-output', '1000000']);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({ run: VILLAGE, game: null, seed: 1808, tick: 500 });
    expect(result.hash).toBe((run.result.hashes as TickHash[]).find((h) => h.tick === 500)?.hash);
    const state = result.state as {
      tick: number;
      components: { Construction: [number, { done: boolean }][] };
    };
    expect(state.tick).toBe(500);
    expect(state.components.Construction[0]![1].done).toBe(true);
  });

  it('dump refuses a tick after the run', async () => {
    const { code } = await cli(['dump', VILLAGE, '--tick', '1001']);
    expect(code).toBe(EXIT.usage);
  });

  it('mutants refuses a world run with a usage error', async () => {
    const { code, result } = await cli(['mutants', VILLAGE]);
    expect(code).toBe(EXIT.usage);
    expect(JSON.stringify(result.error)).toContain('no kit rules');
  });
});
