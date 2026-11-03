import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './exit-codes';
import { main } from './main';

// A run file's `start` (Engine 0.14, gap G9, decision 6): a later level (`{ stage }`) or campaign
// entry (`{ entry }`), fresh, from tick 0. The platformer test's start-level run files, the mini
// siege's fresh dawn, the errors, and replays that keep `start`.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LEVEL_3 = 'games/samples/platformer/runs/level-3.run.json';
const LEVEL_3_START = 'games/samples/platformer/runs/level-3-start.run.json';
const DAWN_FRESH = 'games/samples/mini-siege/runs/dawn-fresh.run.json';
/** The tick the full-replay `level-3` run starts level 3 at (stage 2). */
const LEVEL_3_TICK = 1161;

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ww-start-'));
  temps.push(dir);
  return dir;
}

async function cli(
  argv: string[],
  outDir = join(tempDir(), 'out'),
): Promise<{ code: number; result: Record<string, unknown> }> {
  let stdout = '';
  const code = await main([...argv, '--json'], {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd: ROOT,
    outDir,
  });
  return { code, result: JSON.parse(stdout) as Record<string, unknown> };
}

/** Writes a run file for `game` (a repo folder) into a temp folder and returns its path. */
function runFile(game: string | null, fields: Record<string, unknown>): string {
  const dir = tempDir();
  const file = join(dir, 'start.run.json');
  const where = game === null ? {} : { game: relative(dir, join(ROOT, game)) };
  writeFileSync(file, JSON.stringify({ ...where, ticks: 10, ...fields }));
  return file;
}

const errorsOf = (result: Record<string, unknown>) =>
  (result.errors as { path: string; code: string; message: string }[]).map((e) => [e.path, e.code]);

describe('a run file that starts at a later level', () => {
  it('passes, and its tick 0 is the state the full replay reaches level 3 in', async () => {
    const { code, result } = await cli(['run', LEVEL_3_START]);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({ passed: true, start: { stage: 2 } });
    const hashes = result.hashes as { tick: number; hash: string }[];
    const full = await cli([
      'trace',
      LEVEL_3,
      '--paths',
      'level,stage,pause',
      '--from',
      String(LEVEL_3_TICK),
      '--to',
      String(LEVEL_3_TICK + 60),
      '--every',
      '60',
    ]);
    const rows = full.result.rows as { tick: number; hash: string; values: Record<string, unknown> }[];
    expect(rows[0]?.values).toEqual({ level: 'level-3', stage: 2, pause: 0 });
    expect(rows.map((r) => r.hash)).toEqual(hashes.slice(0, 2).map((h) => h.hash));
  });

  it('dump and trace count ticks from the start level and report it', async () => {
    const dump = await cli(['dump', LEVEL_3_START, '--tick', '0']);
    expect(dump.code).toBe(EXIT.ok);
    expect(dump.result).toMatchObject({
      start: { stage: 2 },
      tick: 0,
      state: { level: 'level-3', stage: 2 },
    });
    const trace = await cli(['trace', LEVEL_3_START, '--paths', 'stage', '--to', '0']);
    expect(trace.result).toMatchObject({ start: { stage: 2 }, rows: [{ tick: 0, values: { stage: 2 } }] });
    const plain = await cli(['dump', 'games/samples/platformer/runs/level-1.run.json', '--tick', '0']);
    expect(plain.result.start).toBeNull();
  });

  it('refuses a stage past the last level, naming start.stage', async () => {
    const { code, result } = await cli(['run', runFile('games/samples/platformer', { start: { stage: 4 } })]);
    expect(code).toBe(EXIT.invalidContent);
    expect(errorsOf(result)).toEqual([['start.stage', 'bad_start']]);
    expect(JSON.stringify(result.errors)).toContain('level-4');
  });
});

describe('a run file that starts at a campaign entry', () => {
  it('starts the entry fresh, with no carried record', async () => {
    const { code, result } = await cli(['run', DAWN_FRESH]);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({ passed: true, start: { entry: 'dawn' }, from: null, codesChecked: 1 });
    // The save is there once the entry is over (Engine 0.15 T8, gap M35: its ticks, no mission open).
    const early = await cli(['code', DAWN_FRESH, '--tick', '0']);
    expect(early.code).toBe(EXIT.invalidContent);
    const saved = await cli(['code', DAWN_FRESH]);
    expect(saved.result).toMatchObject({
      start: { entry: 'dawn' },
      save: {
        position: 2,
        carried: null,
        results: [
          { entry: 0, missions: [] },
          { entry: 1, missions: [] },
        ],
      },
    });
  });

  it('refuses an entry the campaign lacks, naming start.entry', async () => {
    const file = runFile('games/samples/mini-siege', { start: { entry: 'dusk' } });
    const { code, result } = await cli(['run', file]);
    expect(code).toBe(EXIT.invalidContent);
    expect(errorsOf(result)).toEqual([['start.entry', 'bad_start']]);
  });
});

describe('a start the game cannot honour', () => {
  it.each([
    ['games/samples/dungeon', { stage: 0 }],
    ['games/samples/mini-siege', { stage: 1 }],
    ['games/samples/platformer', { entry: 'level-2' }],
  ])('%s refuses start %j with exit 3 at start (no_start)', async (game, start) => {
    for (const command of [['run'], ['dump', '--tick', '0']]) {
      const file = runFile(game, { start });
      const { code, result } = await cli([command[0]!, file, ...command.slice(1)]);
      expect(code).toBe(EXIT.invalidContent);
      expect(errorsOf(result)).toEqual([['start', 'no_start']]);
    }
  });
});

describe('the start schema', () => {
  it('takes exactly one of stage and entry, never with from, and not on a world run', async () => {
    const bad = async (game: string | null, fields: Record<string, unknown>) =>
      errorsOf((await cli(['run', runFile(game, fields)])).result);
    expect(await bad('games/samples/platformer', { start: {} })).toEqual([['start', 'custom']]);
    expect(await bad('games/samples/platformer', { start: { stage: 1, entry: 'x' } })).toEqual([
      ['start', 'custom'],
    ]);
    expect(await bad('games/samples/platformer', { start: { stage: -1 } })).toEqual([
      ['start.stage', 'too_small'],
    ]);
    expect(await bad('games/samples/mini-siege', { start: { entry: 'dawn' }, from: { code: 'X' } })).toEqual([
      ['start', 'custom'],
    ]);
    const world = runFile(null, {});
    const text = JSON.parse(readFileSync(world, 'utf8')) as Record<string, unknown>;
    writeFileSync(
      world,
      JSON.stringify({
        ...text,
        world: relative(join(world, '..'), join(ROOT, 'engine/sim/__fixtures__/village.world.json')),
        start: { stage: 1 },
      }),
    );
    expect(errorsOf((await cli(['run', world])).result)).toEqual([['start', 'custom']]);
  });
});

describe('a replay of a run with start', () => {
  it('keeps start and reproduces the failure', async () => {
    const run = JSON.parse(readFileSync(join(ROOT, LEVEL_3_START), 'utf8')) as Record<string, unknown>;
    const file = runFile(null, {});
    writeFileSync(
      file,
      JSON.stringify({
        ...run,
        game: relative(join(file, '..'), join(ROOT, 'games/samples/platformer')),
        assertions: [{ tick: 62, path: 'lives', op: 'eq', value: 3 }],
      }),
    );
    const out = join(tempDir(), 'out');
    const failed = await cli(['run', file], out);
    expect(failed.code).toBe(EXIT.failedCheck);
    expect(failed.result).toMatchObject({ failure: { tick: 62, path: 'lives' } });
    const replayFile = failed.result.replayFile as string;
    const replay = JSON.parse(readFileSync(join(ROOT, replayFile), 'utf8')) as Record<string, unknown>;
    expect(replay.start).toEqual({ stage: 2 });
    const again = await cli(['run', replayFile], out);
    expect(again.code).toBe(EXIT.failedCheck);
    expect(again.result).toMatchObject({
      start: { stage: 2 },
      replay: { reproduced: true, expectedTick: 62, hashMismatch: null },
    });
  });
});
