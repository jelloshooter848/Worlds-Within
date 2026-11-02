import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './exit-codes';
import { main } from './main';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WALK = 'games/demo/runs/walk-east.run.json';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ww-mutants-'));
  temps.push(dir);
  return dir;
}

async function cli(argv: string[]): Promise<{ code: number; result: Record<string, unknown> }> {
  let stdout = '';
  const outDir = join(tempDir(), 'out');
  const code = await main([...argv, '--json'], {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd: ROOT,
    outDir,
  });
  return { code, result: JSON.parse(stdout) as Record<string, unknown> };
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

type Row = { id: string; skipped: boolean; passed: boolean | null; guarded: boolean | null };

describe('run --disable-rule', () => {
  it('fails walk-east with doors-change-room off: the run guards that rule', async () => {
    const { code, result } = await cli(['run', WALK, '--disable-rule', 'doors-change-room']);
    expect(code).toBe(EXIT.failedCheck);
    expect(result).toMatchObject({
      passed: false,
      disabledRules: ['doors-change-room'],
      failure: { tick: 240, kind: 'assertion', path: 'hero.room', actual: 'courtyard' },
    });
    // The replay switches the same rule off, so it fails the same way.
    const replay = JSON.parse(readFileSync(String(result.replayFile), 'utf8')) as Record<string, unknown>;
    expect(replay.disableRules).toEqual(['doors-change-room']);
  });

  it('still passes walk-east with a rule it does not guard switched off', async () => {
    const { code, result } = await cli(['run', WALK, '--disable-rule', 'damage-reduces-hp']);
    expect(code).toBe(EXIT.ok);
    expect(result.disabledRules).toEqual(['damage-reduces-hp']);
  });

  it('lists no rules off by default', async () => {
    const { result } = await cli(['run', WALK]);
    expect(result.disabledRules).toEqual([]);
  });

  it('is a usage error for a rule the kit does not name', async () => {
    const { code, result } = await cli(['run', WALK, '--disable-rule', 'doors-change-rom']);
    expect(code).toBe(EXIT.usage);
    expect(JSON.stringify(result.error)).toContain('no rule \\"doors-change-rom\\"');
  });
});

describe('disableRules in a run file', () => {
  it('switches the rules off', async () => {
    const file = runFile((run) => (run.disableRules = ['doors-change-room']));
    const { code, result } = await cli(['run', file]);
    expect(code).toBe(EXIT.failedCheck);
    expect(result.disabledRules).toEqual(['doors-change-room']);
  });

  it('is invalid content for an unknown rule, naming the file and the entry', async () => {
    const file = runFile((run) => (run.disableRules = ['walls-block-movement', 'nope']));
    const { code, result } = await cli(['run', file]);
    expect(code).toBe(EXIT.invalidContent);
    expect(result.errors).toEqual([
      expect.objectContaining({ pointer: '/disableRules/1', code: 'unknown_rule' }),
    ]);
  });
});

describe('mutants', () => {
  it('reports, per rule, whether walk-east still passes with it off, and flags the weak ones', async () => {
    const { code, result } = await cli(['mutants', WALK]);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({
      ok: true,
      command: 'mutants',
      run: WALK,
      game: 'games/demo',
      kit: 'topdown',
      baseline: { passed: true, failure: null },
      guarded: ['doors-change-room'],
      weak: ['walls-block-movement', 'damage-reduces-hp', 'keys-open-locked-doors'],
    });
    const rows = result.rules as Row[];
    expect(rows.map((r) => [r.id, r.passed, r.guarded])).toEqual([
      ['walls-block-movement', true, false],
      ['doors-change-room', false, true],
      ['damage-reduces-hp', true, false],
      ['keys-open-locked-doors', true, false],
    ]);
  });

  it('skips the rules the run file already switches off', async () => {
    const file = runFile((run) => {
      run.disableRules = ['damage-reduces-hp'];
    });
    const { result } = await cli(['mutants', file]);
    const row = (result.rules as Row[]).find((r) => r.id === 'damage-reduces-hp');
    expect(row).toMatchObject({ skipped: true, passed: null, guarded: null });
    expect(result.weak).not.toContain('damage-reduces-hp');
  });

  it('stops with a failed check when the run fails as it is', async () => {
    const file = runFile((run) => {
      run.assertions = [{ tick: 10, path: 'room', op: 'eq', value: 'nowhere' }];
    });
    const { code, result } = await cli(['mutants', file]);
    expect(code).toBe(EXIT.failedCheck);
    expect(result).toMatchObject({ baseline: { passed: false }, rules: [], weak: [] });
  });

  it('says "weak: does not guard X" in text', async () => {
    let stdout = '';
    await main(['mutants', WALK], { stdout: (t) => void (stdout += t), stderr: () => {}, cwd: ROOT });
    expect(stdout).toContain('weak: does not guard walls-block-movement');
    expect(stdout).toContain('guards: doors-change-room');
  });
});
