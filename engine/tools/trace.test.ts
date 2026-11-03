import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { traceTable, type TraceRow } from './commands/trace';
import { EXIT } from './exit-codes';
import { main } from './main';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WALK = 'games/demo/runs/walk-east.run.json';
const RAID = 'engine/sim/__fixtures__/raid-partial.run.json';
const SIEGE = 'games/samples/mini-siege/runs/played.run.json';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ww-trace-'));
  temps.push(dir);
  return dir;
}

async function cli(
  argv: string[],
): Promise<{ code: number; stdout: string; result: Record<string, unknown> }> {
  let stdout = '';
  const code = await main(argv, {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd: ROOT,
    outDir: join(tempDir(), 'out'),
  });
  const result = argv.includes('--json') ? (JSON.parse(stdout) as Record<string, unknown>) : {};
  return { code, stdout, result };
}

const rowsOf = (result: Record<string, unknown>) => result.rows as TraceRow[];

/** The run's own hashes at the ticks it printed them. */
async function runHashes(file: string): Promise<Map<number, string>> {
  const { result } = await cli(['run', file, '--json']);
  expect(result.passed).toBe(true);
  return new Map((result.hashes as { tick: number; hash: string }[]).map((h) => [h.tick, h.hash]));
}

describe('trace', () => {
  it('reads the paths at every K-th tick from N to M', async () => {
    const argv = ['trace', WALK, '--paths', 'hero.x,hero.room', '--from', '0', '--to', '60', '--every', '10'];
    const { code, stdout, result } = await cli([...argv, '--json']);
    expect(code).toBe(EXIT.ok);
    expect(stdout.split('\n')).toHaveLength(2);
    expect(result).toMatchObject({
      ok: true,
      command: 'trace',
      run: WALK,
      game: 'games/demo',
      world: null,
      seed: 1,
      from: 0,
      to: 60,
      every: 10,
      paths: ['hero.x', 'hero.room'],
      missing: [],
      orders: [],
      missions: [],
    });
    const rows = rowsOf(result);
    expect(rows.map((r) => r.tick)).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(rows[0]).toEqual({
      tick: 0,
      hash: 'd29e6b40530102ce',
      values: { 'hero.x': 112, 'hero.room': 'courtyard' },
    });
    expect(rows.every((r) => typeof r.values['hero.x'] === 'number')).toBe(true);
  });

  it('gives the same values as dump at a traced tick', async () => {
    const { result } = await cli([
      'trace',
      WALK,
      '--paths',
      'hero.x,hero.y',
      '--from',
      '35',
      '--to',
      '35',
      '--json',
    ]);
    const dumped = await cli(['dump', WALK, '--tick', '35', '--json']);
    const state = dumped.result.state as { hero: { x: number; y: number } };
    expect(rowsOf(result)).toEqual([
      { tick: 35, hash: dumped.result.hash, values: { 'hero.x': state.hero.x, 'hero.y': state.hero.y } },
    ]);
  });

  it("defaults to every tick from 0 to the run's ticks, and --every starts at --from", async () => {
    const all = await cli(['trace', WALK, '--paths', 'hero.x', '--json']);
    expect(rowsOf(all.result)).toHaveLength(241);
    const some = await cli([
      'trace',
      WALK,
      '--paths',
      'hero.x',
      '--from',
      '5',
      '--to',
      '30',
      '--every',
      '7',
      '--json',
    ]);
    expect(rowsOf(some.result).map((r) => r.tick)).toEqual([5, 12, 19, 26]);
  });

  it('gives null for a path missing from the snapshot and lists it in missing', async () => {
    const { code, result } = await cli([
      'trace',
      WALK,
      '--paths',
      'hero.x,hero.nope,entities.99',
      '--to',
      '20',
      '--every',
      '10',
      '--json',
    ]);
    expect(code).toBe(EXIT.ok);
    expect(rowsOf(result).map((r) => r.values['hero.nope'])).toEqual([null, null, null]);
    expect(result.missing).toEqual([
      { path: 'hero.nope', firstTick: 0, ticks: 3 },
      { path: 'entities.99', firstTick: 0, ticks: 3 },
    ]);
  });

  it('traces a world run with missions with the hashes run prints', async () => {
    const hashes = await runHashes(RAID);
    const { code, result } = await cli([
      'trace',
      RAID,
      '--paths',
      'tick,components.Missions.0.1.open',
      '--every',
      '5',
      '--json',
    ]);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({ game: null, world: 'engine/sim/__fixtures__/siege.world.json' });
    expect((result.missions as unknown[]).length).toBeGreaterThan(0);
    const rows = rowsOf(result);
    for (const row of rows) expect(row.values.tick).toBe(row.tick);
    const shared = rows.filter((r) => hashes.has(r.tick));
    expect(shared.length).toBeGreaterThan(2);
    for (const row of shared) expect(row.hash).toBe(hashes.get(row.tick));
  });

  it('traces a mini siege run with missions with the hashes run prints', async () => {
    const hashes = await runHashes(SIEGE);
    const { code, result } = await cli([
      'trace',
      SIEGE,
      '--paths',
      'tick',
      '--json',
      '--max-output',
      '10000000',
    ]);
    expect(code).toBe(EXIT.ok);
    expect((result.missions as unknown[]).length).toBeGreaterThan(0);
    const byTick = new Map(rowsOf(result).map((r) => [r.tick, r.hash]));
    for (const [tick, hash] of hashes) expect(byTick.get(tick)).toBe(hash);
  });

  it('halves the rows under the output cap and writes the whole trace to a file', async () => {
    const { result } = await cli([
      'trace',
      WALK,
      '--paths',
      'hero.x,hero.y',
      '--json',
      '--max-output',
      '2048',
    ]);
    expect(result).toMatchObject({ ok: true, command: 'trace', truncated: true });
    const rows = rowsOf(result);
    expect(rows.length).toBeLessThan(241);
    expect(rows[0]!.tick).toBe(0);
    expect((result.omitted as { rows: number }).rows).toBe(241 - rows.length);
    const full = JSON.parse(readFileSync(join(ROOT, result.fullOutput as string), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(rowsOf(full)).toHaveLength(241);
  });

  it('prints an aligned table without --json', async () => {
    const { code, stdout } = await cli([
      'trace',
      WALK,
      '--paths',
      'hero.x,hero.room',
      '--to',
      '20',
      '--every',
      '10',
    ]);
    expect(code).toBe(EXIT.ok);
    const lines = stdout.trimEnd().split('\n');
    expect(lines[0]).toBe(`${WALK}: ticks 0-20 every 10 (3 rows)`);
    expect(lines[1]).toMatch(/^tick {2}hash {14}hero\.x {2}hero\.room$/);
    expect(lines[2]).toBe('   0  d29e6b40530102ce  112     "courtyard"');
  });

  it.each([
    [['--paths', '']],
    [['--paths', ',']],
    [['--paths', 'hero.x,,hero.y']],
    [['--paths', 'hero..x']],
    [['--paths', 'hero.x,hero.x']],
    [['--paths', 'hero.x', '--every', '0']],
    [['--paths', 'hero.x', '--from', '30', '--to', '20']],
    [['--paths', 'hero.x', '--to', '241']],
    [['--paths', 'hero.x', '--from', '-1']],
    [['--paths', 'hero.x', '--tick', '3']],
    [[]],
  ])('is a usage error for %j', async (flags) => {
    const { code, result } = await cli(['trace', WALK, ...flags, '--json']);
    expect(code).toBe(EXIT.usage);
    expect(result).toMatchObject({ ok: false, error: { kind: 'usage' } });
  });

  it('is exit 3 for a bad run file', async () => {
    const file = join(tempDir(), 'bad.run.json');
    writeFileSync(file, JSON.stringify({ game: join(ROOT, 'games/demo'), ticks: 'many' }));
    const { code, result } = await cli(['trace', file, '--paths', 'hero.x', '--json']);
    expect(code).toBe(EXIT.invalidContent);
    expect((result.errors as unknown[]).length).toBeGreaterThan(0);
  });

  it('lays out a table with one column per path', () => {
    const rows: TraceRow[] = [
      { tick: 5, hash: 'h1', values: { a: 1, 'b.c': null } },
      { tick: 100, hash: 'h2', values: { a: 'long value', 'b.c': [1] } },
    ];
    expect(traceTable(rows, ['a', 'b.c'])).toBe(
      [
        'tick  hash  a             b.c',
        '   5  h1    1             null',
        ' 100  h2    "long value"  [1]',
      ].join('\n'),
    );
  });
});
