import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './exit-codes';
import { main } from './main';

// Engine 0.10 T6 (item 161): a world run file's `missions` open, delegate, play and quit
// missions between ticks, defined by `*.mission.json` files beside the scenario; each commits by
// itself at its commit tick. The fixture is engine/sim/__fixtures__/siege.world.json.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = join(ROOT, 'engine/sim/__fixtures__');
const PARTIAL = 'engine/sim/__fixtures__/raid-partial.run.json';
const FAILURE = 'engine/sim/__fixtures__/raid-failure.run.json';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ww-missions-'));
  temps.push(dir);
  return dir;
}

async function cli(argv: string[], cwd = ROOT) {
  let stdout = '';
  const code = await main([...argv, '--json'], {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd,
    outDir: join(tempDir(), 'out'),
  });
  return { code, result: JSON.parse(stdout) as Record<string, unknown> };
}

type Run = Record<string, unknown> & { missions: Record<string, unknown>[] };

/** A run file in a temp folder: `world` is the siege fixture unless `dir` holds its own copy. */
function runFile(run: Run, dir = tempDir(), world = join(FIXTURES, 'siege.world.json')): string {
  const file = join(dir, 'test.run.json');
  writeFileSync(file, JSON.stringify({ world, ticks: 60, ...run }, null, 2));
  return file;
}

const errorsOf = async (file: string) => {
  const { code, result } = await cli(['run', file]);
  expect(code).toBe(EXIT.invalidContent);
  return (result.errors as { file: string; path: string; code: string; message: string }[]).map(
    (e) => `${e.file.split('/').pop()}: ${e.path}: ${e.code}: ${e.message}`,
  );
};

describe('missions in a world run file', () => {
  it('plays the partial-success fixture with its steps and experience ticks reported', async () => {
    const { code, result } = await cli(['run', PARTIAL]);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({
      passed: true,
      missions: 2,
      missionsPlayed: 2,
      refusedMissions: [],
      experience: [{ mission: 'raid', ticks: 240 }],
    });
  });

  it('reports refused mission steps (no retries) and goes on, as with orders', async () => {
    const { code, result } = await cli(['run', FAILURE]);
    expect(code).toBe(EXIT.ok);
    expect(result.refusedMissions).toEqual([
      expect.objectContaining({ tick: 10, mission: 'raid', action: 'play', code: 'mission_resolved' }),
      expect.objectContaining({ tick: 36, mission: 'raid', action: 'open', code: 'mission_committed' }),
      expect.objectContaining({ tick: 36, mission: 'raid', action: 'delegate', code: 'mission_committed' }),
    ]);
    expect(result.missionsPlayed).toBe(7);
  });

  it('shows mission steps in dump and keeps them in a replay file', async () => {
    const dumped = await cli(['dump', FAILURE, '--tick', '7', '--max-output', '10000000']);
    expect(dumped.code).toBe(EXIT.ok);
    expect((dumped.result.missions as unknown[]).length).toBe(2);

    const run = JSON.parse(readFileSync(join(ROOT, FAILURE), 'utf8')) as Run;
    run.world = join(FIXTURES, 'siege.world.json');
    run.assertions = [{ tick: 20, path: 'tick', op: 'eq', value: 0 }];
    const failed = await cli(['run', runFile(run)]);
    expect(failed.code).toBe(EXIT.failedCheck);
    const replay = JSON.parse(readFileSync(join(ROOT, failed.result.replayFile as string), 'utf8')) as Run;
    expect(replay.missions.map((m) => m.tick)).toEqual([5, 6, 10]);
  });

  it('names the run file and field for schema errors', async () => {
    const file = runFile({
      missions: [
        { tick: 5, mission: 'raid', action: 'play' },
        { tick: 4, mission: 'raid', action: 'open', outcome: 'clean' },
        { tick: 60, mission: 'raid', action: 'delegate', experienceTicks: 3 },
      ],
    });
    const errors = await errorsOf(file);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^test\.run\.json: missions\.0\.outcome: .*needs the outcome/),
        expect.stringMatching(/^test\.run\.json: missions\.1\.tick: .*tick order/),
        expect.stringMatching(/^test\.run\.json: missions\.1\.outcome: .*only a "play"/),
        expect.stringMatching(/^test\.run\.json: missions\.2\.tick: .*not before the run's last tick/),
        expect.stringMatching(/^test\.run\.json: missions\.2\.experienceTicks: /),
      ]),
    );
    // A bad shape is caught first (the checks across entries wait for a valid shape).
    const shape = runFile({ missions: [{ tick: 1, mission: 'Raid!', action: 'commit' }] });
    expect(await errorsOf(shape)).toEqual([
      expect.stringMatching(/^test\.run\.json: missions\.0\.mission: /),
      expect.stringMatching(/^test\.run\.json: missions\.0\.action: /),
    ]);
  });

  it('refuses missions on a game run', async () => {
    const dir = tempDir();
    const file = join(dir, 'g.run.json');
    writeFileSync(
      file,
      JSON.stringify({
        game: join(ROOT, 'games/demo'),
        ticks: 5,
        missions: [{ tick: 0, mission: 'raid', action: 'open' }],
      }),
    );
    expect(await errorsOf(file)).toEqual([expect.stringMatching(/^g\.run\.json: missions: .*game run/)]);
  });

  it('names a mission with no file, and a bad mission file by file and field', async () => {
    expect(await errorsOf(runFile({ missions: [{ tick: 0, mission: 'nowhere', action: 'open' }] }))).toEqual([
      expect.stringMatching(/^test\.run\.json: missions\.0\.mission: missing_file: no mission "nowhere"/),
    ]);

    const dir = tempDir();
    copyFileSync(join(FIXTURES, 'siege.world.json'), join(dir, 'siege.world.json'));
    mkdirSync(join(dir, 'missions'));
    const raid = JSON.parse(readFileSync(join(FIXTURES, 'raid.mission.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    writeFileSync(join(dir, 'missions', 'raid.mission.json'), JSON.stringify({ ...raid, worldTimeCost: 0 }));
    writeFileSync(join(dir, 'scout.mission.json'), JSON.stringify({ ...raid, id: 'raid' }));
    const file = runFile(
      {
        missions: [
          { tick: 0, mission: 'raid', action: 'open' },
          { tick: 0, mission: 'scout', action: 'open' },
        ],
      },
      dir,
      'siege.world.json',
    );
    expect(await errorsOf(file)).toEqual([
      expect.stringMatching(/^raid\.mission\.json: worldTimeCost: too_small: /),
      expect.stringMatching(/^scout\.mission\.json: id: id_mismatch: /),
    ]);
  });

  it('refuses at load a play after the commit tick its open fixed (mission_unresolved)', async () => {
    const file = runFile({
      missions: [
        { tick: 5, mission: 'raid', action: 'open' },
        { tick: 35, mission: 'raid', action: 'play', outcome: 'clean' },
      ],
    });
    expect(await errorsOf(file)).toEqual([
      expect.stringMatching(/^test\.run\.json: missions\.1\.tick: mission_unresolved: .*commits at tick 35/),
    ]);
  });
});
