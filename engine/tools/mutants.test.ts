import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineKit, type KitDef } from '@engine/core/kit';
import { defineRules } from '@engine/core/rules';
import { EXIT } from './exit-codes';
import { main } from './main';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WALK = 'games/samples/dungeon/runs/walk-east.run.json';

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

/** The walk-east run with `edit` applied, written to a temp folder (its game is games/samples/dungeon). */
function runFile(edit: (run: Record<string, unknown>) => void): string {
  const run = JSON.parse(readFileSync(join(ROOT, WALK), 'utf8')) as Record<string, unknown>;
  run.game = join(ROOT, 'games/samples/dungeon');
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
      game: 'games/samples/dungeon',
      kit: 'topdown',
      baseline: { passed: true, failure: null },
      guarded: ['doors-change-room'],
      weak: [
        'walls-block-movement',
        'damage-reduces-hp',
        'keys-open-locked-doors',
        'dash-crosses-pits',
        'boss-patterns',
        'boss-phases',
        'boss-hit-invuln',
        'boss-seals-room',
      ],
    });
    const rows = result.rules as Row[];
    expect(rows.map((r) => [r.id, r.passed, r.guarded])).toEqual([
      ['walls-block-movement', true, false],
      ['doors-change-room', false, true],
      ['damage-reduces-hp', true, false],
      ['keys-open-locked-doors', true, false],
      ['dash-crosses-pits', true, false],
      ['boss-patterns', true, false],
      ['boss-phases', true, false],
      ['boss-hit-invuln', true, false],
      ['boss-seals-room', true, false],
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

// Strict mutants (Engine 0.5, item 41) with a test-only kit: the generated kit list gets a stub
// kit that opts in with `strictMutants: true`, and its game lives in a temp folder. Nothing here
// depends on a real strict kit.

vi.mock('./kit-list', async (importOriginal) => {
  const real = await importOriginal<{ KIT_HOOKS: readonly KitDef[] }>();
  const rules = defineRules([
    { id: 'moves', description: 'the dot moves one step per tick' },
    { id: 'counts', description: 'the counter goes up one per tick' },
  ]);
  const strict = defineKit({ name: 'stub-strict', kinds: () => [], rules, strictMutants: true });
  const loose = defineKit({ name: 'stub-loose', kinds: () => [], rules });
  return { KIT_HOOKS: [...real.KIT_HOOKS, strict, loose] };
});

/** The stub game's headless module: plain JS, so it imports from a temp folder as it is. */
const HEADLESS = `
export function createGame(content, seed, opts = {}) {
  const off = new Set(opts.disabledRules ?? []);
  const state = { x: 0, count: 0 };
  return {
    step() {
      if (!off.has('moves')) state.x += 1;
      if (!off.has('counts')) state.count += 1;
    },
    snapshot: () => ({ ...state }),
  };
}
`;

/** A temp working folder with `games/stub` on kit `kit` and the given run files in its `runs/`. */
function stubGame(
  kit: string,
  runs: Record<string, Record<string, unknown>>,
  uses?: string[],
  headless = HEADLESS,
): string {
  const cwd = tempDir();
  const game = join(cwd, 'games/stub');
  mkdirSync(join(game, 'runs'), { recursive: true });
  const manifest = {
    id: 'stub',
    kit,
    ...(uses ? { uses } : {}),
    content: {},
    start: { seed: 1 },
    headless: 'headless.mjs',
  };
  writeFileSync(join(game, 'game.json'), JSON.stringify(manifest));
  writeFileSync(join(game, 'headless.mjs'), headless);
  for (const [name, run] of Object.entries(runs))
    writeFileSync(join(game, 'runs', `${name}.run.json`), JSON.stringify({ game: '..', ticks: 5, ...run }));
  return cwd;
}

const checkX = { assertions: [{ tick: 5, path: 'x', op: 'eq', value: 5 }] };
const checkCount = { assertions: [{ tick: 5, path: 'count', op: 'eq', value: 5 }] };
const checkBoth = { assertions: [...checkX.assertions, ...checkCount.assertions] };

async function cliIn(cwd: string, argv: string[], json = true) {
  let stdout = '';
  const code = await main(json ? [...argv, '--json'] : argv, {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd,
    outDir: join(cwd, 'out'),
  });
  return { code, stdout, result: json ? (JSON.parse(stdout) as Record<string, unknown>) : {} };
}

describe('mutants on a strict kit, one run file', () => {
  it('exits 4 and lists the rule a run leaves unguarded under weak', async () => {
    const cwd = stubGame('stub-strict', { x: checkX });
    const { code, result } = await cliIn(cwd, ['mutants', 'games/stub/runs/x.run.json']);
    expect(code).toBe(EXIT.failedCheck);
    expect(result).toMatchObject({
      kit: 'stub-strict',
      strict: true,
      baseline: { passed: true },
      guards: null,
      guarded: ['moves'],
      weak: ['counts'],
    });
  });

  it('exits 0 when the run guards every rule', async () => {
    const cwd = stubGame('stub-strict', { both: checkBoth });
    const { code, result } = await cliIn(cwd, ['mutants', 'games/stub/runs/both.run.json']);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({ guarded: ['moves', 'counts'], weak: [] });
  });

  it('holds a run with guards only to those rules', async () => {
    const cwd = stubGame('stub-strict', {
      ok: { ...checkX, guards: ['moves'] },
      bad: { ...checkX, guards: ['counts'] },
    });
    const ok = await cliIn(cwd, ['mutants', 'games/stub/runs/ok.run.json']);
    expect(ok.code).toBe(EXIT.ok);
    expect(ok.result).toMatchObject({ guards: ['moves'], weak: [] });
    const rows = ok.result.rules as { id: string; expected: boolean; guarded: boolean }[];
    expect(rows.map((r) => [r.id, r.expected, r.guarded])).toEqual([
      ['moves', true, true],
      ['counts', false, false],
    ]);
    const bad = await cliIn(cwd, ['mutants', 'games/stub/runs/bad.run.json']);
    expect(bad.code).toBe(EXIT.failedCheck);
    expect(bad.result.weak).toEqual(['counts']);
  });

  it('says which rules are weak in text', async () => {
    const cwd = stubGame('stub-strict', { x: { ...checkX, guards: ['moves'] }, y: checkX });
    const x = await cliIn(cwd, ['mutants', 'games/stub/runs/x.run.json'], false);
    expect(x.stdout).toContain('(strict)');
    expect(x.stdout).toContain("not guarded: counts (not in the run's guards)");
    const y = await cliIn(cwd, ['mutants', 'games/stub/runs/y.run.json'], false);
    expect(y.stdout).toContain('weak: does not guard counts');
  });

  it('only reports weak rules for a kit that is not strict', async () => {
    const cwd = stubGame('stub-loose', { x: checkX });
    const { code, result } = await cliIn(cwd, ['mutants', 'games/stub/runs/x.run.json']);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({ strict: false, weak: ['counts'] });
  });
});

describe('guards in a run file', () => {
  it('is invalid content for an unknown rule id, naming the run file and the field', async () => {
    const cwd = stubGame('stub-strict', { x: { ...checkX, guards: ['moves', 'flies'] } });
    for (const command of ['mutants', 'run']) {
      const { code, result } = await cliIn(cwd, [command, 'games/stub/runs/x.run.json']);
      expect(code).toBe(EXIT.invalidContent);
      expect(result.errors).toEqual([
        expect.objectContaining({
          file: 'games/stub/runs/x.run.json',
          pointer: '/guards/1',
          code: 'unknown_rule',
          message: expect.stringContaining('no rule "flies" in "guards"') as unknown,
        }),
      ]);
    }
  });

  it('is invalid content for a rule listed twice or switched off by the run', async () => {
    const cwd = stubGame('stub-strict', {
      twice: { ...checkX, guards: ['moves', 'moves'] },
      off: { ...checkX, guards: ['counts'], disableRules: ['counts'] },
    });
    const twice = await cliIn(cwd, ['mutants', 'games/stub/runs/twice.run.json']);
    expect(twice.code).toBe(EXIT.invalidContent);
    expect(twice.result.errors).toEqual([expect.objectContaining({ pointer: '/guards/1' })]);
    const off = await cliIn(cwd, ['mutants', 'games/stub/runs/off.run.json']);
    expect(off.code).toBe(EXIT.invalidContent);
    expect(off.result.errors).toEqual([expect.objectContaining({ pointer: '/guards/0' })]);
  });
});

describe('mutants on a game folder', () => {
  it('lists the run files guarding each rule and exits 4 when a strict rule has none', async () => {
    const cwd = stubGame('stub-strict', { a: checkX, b: checkX });
    const { code, result } = await cliIn(cwd, ['mutants', 'games/stub']);
    expect(code).toBe(EXIT.failedCheck);
    expect(result).toMatchObject({
      game: 'games/stub',
      kit: 'stub-strict',
      strict: true,
      rules: [
        { id: 'moves', guardedBy: ['games/stub/runs/a.run.json', 'games/stub/runs/b.run.json'] },
        { id: 'counts', guardedBy: [] },
      ],
      unguarded: ['counts'],
    });
    // Without `guards`, each run is held only to the game as a whole.
    expect((result.runs as { weak: string[] }[]).map((r) => r.weak)).toEqual([[], []]);
    const text = await cliIn(cwd, ['mutants', 'games/stub'], false);
    expect(text.stdout).toContain('weak: no run file guards counts');
    expect(text.stdout).toContain('moves: guarded by games/stub/runs/a.run.json, games/stub/runs/b.run.json');
  });

  it('exits 0 when the run files between them guard every rule', async () => {
    const cwd = stubGame('stub-strict', { a: checkX, b: checkCount });
    const { code, result } = await cliIn(cwd, ['mutants', 'games/stub']);
    expect(code).toBe(EXIT.ok);
    expect(result.unguarded).toEqual([]);
  });

  it('exits 4 for a run that does not guard a rule in its guards', async () => {
    const cwd = stubGame('stub-strict', { a: checkX, b: { ...checkCount, guards: ['moves', 'counts'] } });
    const { code, result } = await cliIn(cwd, ['mutants', 'games/stub']);
    expect(code).toBe(EXIT.failedCheck);
    expect(result.unguarded).toEqual([]);
    expect(result.runs).toEqual([
      expect.objectContaining({ run: 'games/stub/runs/a.run.json', weak: [] }),
      expect.objectContaining({ run: 'games/stub/runs/b.run.json', weak: ['moves'] }),
    ]);
  });

  it('exits 4 when a run fails as it is, and 3 for a bad run file', async () => {
    const failing = stubGame('stub-loose', {
      a: { assertions: [{ tick: 5, path: 'x', op: 'eq', value: 9 }] },
    });
    expect((await cliIn(failing, ['mutants', 'games/stub'])).code).toBe(EXIT.failedCheck);
    const bad = stubGame('stub-loose', { a: { ...checkX, guards: ['nope'] } });
    const { code, result } = await cliIn(bad, ['mutants', 'games/stub']);
    expect(code).toBe(EXIT.invalidContent);
    expect(result.errors).toEqual([expect.objectContaining({ file: 'games/stub/runs/a.run.json' })]);
  });

  it('only reports unguarded rules for a kit that is not strict', async () => {
    const cwd = stubGame('stub-loose', { a: checkX });
    const { code, result } = await cliIn(cwd, ['mutants', 'games/stub']);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({ strict: false, unguarded: ['counts'] });
  });
});

// Engine 0.14 (gap G12, decision 8): a game on two kits, `stub-loose` with `uses: ["stub-strict"]`.
// Both kits name the rules `moves` and `counts`, so the second kit's are `stub-strict:moves` and
// `stub-strict:counts`: the game routes them to its second state (`y`, `total`), as a platformer
// game routes `topdown:<id>` to its round.

const HEADLESS_TWO = `
export function createGame(content, seed, opts = {}) {
  const off = new Set(opts.disabledRules ?? []);
  const offStrict = new Set(opts.disabledRulesByKit?.['stub-strict'] ?? []);
  const state = { x: 0, count: 0, y: 0, total: 0 };
  return {
    step() {
      if (!off.has('moves')) state.x += 1;
      if (!off.has('counts')) state.count += 1;
      if (!offStrict.has('moves')) state.y += 1;
      if (!offStrict.has('counts')) state.total += 1;
    },
    snapshot: () => ({ ...state }),
  };
}
`;

const checkY = { assertions: [{ tick: 5, path: 'y', op: 'eq', value: 5 }] };

function twoKitStub(runs: Record<string, Record<string, unknown>>): string {
  return stubGame('stub-loose', runs, ['stub-strict'], HEADLESS_TWO);
}

describe('rules of a kit the game uses (qualified ids)', () => {
  it("switches a `kit:id` rule off in that kit only; a bare id stays the main kit's", async () => {
    const cwd = twoKitStub({ x: checkX });
    const off = await cliIn(cwd, [
      'run',
      'games/stub/runs/x.run.json',
      '--disable-rule',
      'stub-strict:moves',
    ]);
    expect(off.code).toBe(EXIT.ok);
    expect(off.result.disabledRules).toEqual(['stub-strict:moves']);
    const bare = await cliIn(cwd, ['run', 'games/stub/runs/x.run.json', '--disable-rule', 'moves']);
    expect(bare.code).toBe(EXIT.failedCheck);
    expect(bare.result.disabledRules).toEqual(['moves']);
    // The main kit's rule may be qualified too; it is written bare.
    const own = await cliIn(cwd, ['run', 'games/stub/runs/x.run.json', '--disable-rule', 'stub-loose:moves']);
    expect(own.result.disabledRules).toEqual(['moves']);
    const y = twoKitStub({ y: { ...checkY, disableRules: ['stub-strict:moves'] } });
    const played = await cliIn(y, ['run', 'games/stub/runs/y.run.json']);
    expect(played.code).toBe(EXIT.failedCheck);
    expect(played.result).toMatchObject({ disabledRules: ['stub-strict:moves'], failure: { path: 'y' } });
  });

  it('refuses a kit prefix the game does not use, naming the kit, and a rule its kit lacks', async () => {
    const cwd = twoKitStub({
      a: { ...checkX, guards: ['nokit:moves'] },
      b: { ...checkX, disableRules: ['stub-strict:flies'] },
    });
    const a = await cliIn(cwd, ['run', 'games/stub/runs/a.run.json']);
    expect(a.code).toBe(EXIT.invalidContent);
    expect(a.result.errors).toEqual([
      expect.objectContaining({
        pointer: '/guards/0',
        code: 'unknown_rule',
        message: expect.stringContaining('the game uses no kit "nokit"') as unknown,
      }),
    ]);
    expect(JSON.stringify(a.result.errors)).toContain('its kits: stub-loose, stub-strict');
    const b = await cliIn(cwd, ['run', 'games/stub/runs/b.run.json']);
    expect(b.result.errors).toEqual([
      expect.objectContaining({
        pointer: '/disableRules/0',
        code: 'unknown_rule',
        message: expect.stringContaining(
          'kit "stub-strict" has no rule "flies" in "disableRules"',
        ) as unknown,
      }),
    ]);
    const flag = await cliIn(cwd, ['run', 'games/stub/runs/a.run.json', '--disable-rule', 'other:moves']);
    expect(flag.code).toBe(EXIT.invalidContent);
    const usage = await cliIn(twoKitStub({ x: checkX }), [
      'run',
      'games/stub/runs/x.run.json',
      '--disable-rule',
      'other:moves',
    ]);
    expect(usage.code).toBe(EXIT.usage);
    expect(JSON.stringify(usage.result)).toContain('the game uses no kit \\"other\\"');
  });

  it("mutant-checks every kit's rules, each with its own kit and strictness", async () => {
    const cwd = twoKitStub({
      x: { ...checkX, ...{ assertions: [...checkX.assertions, ...checkY.assertions] } },
    });
    const { code, result } = await cliIn(cwd, ['mutants', 'games/stub/runs/x.run.json']);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({
      kit: 'stub-loose',
      strict: false,
      kits: [
        { kit: 'stub-loose', strict: false, rules: 2 },
        { kit: 'stub-strict', strict: true, rules: 2 },
      ],
      guarded: ['moves', 'stub-strict:moves'],
      // Without guards a run is expected to guard its own kit's rules only.
      weak: ['counts'],
    });
    const rows = result.rules as { id: string; kit: string; strict: boolean; expected: boolean }[];
    expect(rows.map((r) => [r.id, r.kit, r.strict, r.expected])).toEqual([
      ['moves', 'stub-loose', false, true],
      ['counts', 'stub-loose', false, true],
      ['stub-strict:moves', 'stub-strict', true, false],
      ['stub-strict:counts', 'stub-strict', true, false],
    ]);
  });

  it("fails on a weak rule of the strict kit in guards, and only reports the lenient kit's", async () => {
    const cwd = twoKitStub({
      lenient: { ...checkY, guards: ['moves', 'stub-strict:moves'] },
      strict: { ...checkY, guards: ['stub-strict:moves', 'stub-strict:counts'] },
    });
    const lenient = await cliIn(cwd, ['mutants', 'games/stub/runs/lenient.run.json']);
    expect(lenient.code).toBe(EXIT.ok);
    expect(lenient.result).toMatchObject({ guarded: ['stub-strict:moves'], weak: ['moves'] });
    const strict = await cliIn(cwd, ['mutants', 'games/stub/runs/strict.run.json']);
    expect(strict.code).toBe(EXIT.failedCheck);
    expect(strict.result.weak).toEqual(['stub-strict:counts']);
    const text = await cliIn(cwd, ['mutants', 'games/stub/runs/strict.run.json'], false);
    expect(text.stdout).toContain('kit "stub-loose", kit "stub-strict" (strict)');
    expect(text.stdout).toContain('weak: does not guard stub-strict:counts');
  });

  it("holds a game to a strict `uses` kit's rules only where its run files list them", async () => {
    const both = { assertions: [...checkX.assertions, ...checkCount.assertions, ...checkY.assertions] };
    const cwd = twoKitStub({ a: { ...both, guards: ['moves', 'counts', 'stub-strict:moves'] } });
    const { code, result } = await cliIn(cwd, ['mutants', 'games/stub']);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({
      kits: [
        { kit: 'stub-loose', strict: false, unguarded: [] },
        { kit: 'stub-strict', strict: true, unguarded: ['stub-strict:counts'] },
      ],
      unguarded: ['stub-strict:counts'],
    });
    expect(result.rules).toContainEqual(
      expect.objectContaining({
        id: 'stub-strict:moves',
        kit: 'stub-strict',
        strict: true,
        guardedBy: ['games/stub/runs/a.run.json'],
      }),
    );
    const text = await cliIn(cwd, ['mutants', 'games/stub'], false);
    expect(text.stdout).toContain('not guarded: no run file guards stub-strict:counts');
    const weak = twoKitStub({ a: { ...both, guards: ['stub-strict:counts'] } });
    const failed = await cliIn(weak, ['mutants', 'games/stub']);
    expect(failed.code).toBe(EXIT.failedCheck);
    expect(failed.result.runs).toEqual([expect.objectContaining({ weak: ['stub-strict:counts'] })]);
  });
});
