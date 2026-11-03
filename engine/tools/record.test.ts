import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickRecording } from './commands/record';
import { EXIT, UsageError } from './exit-codes';
import { main } from './main';

// `record` (Engine 0.14 T9, gap M19) on copies of the mini siege's played run files in a temp
// folder: a recording from the page (`window.__ww.recordings()`) or the kit's bot written into
// the `play` step through the checked edit path, then the run played with its golden sync hashes.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GAME = join(ROOT, 'games/samples/mini-siege');
const BOT = '{"engine-camp": [{"do": "fight"}]}';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ww-record-'));
  temps.push(dir);
  return dir;
}

interface PlayStep {
  tick: number;
  mission: string;
  action: string;
  input?: { steps: { frame: number; hold: string[] }[] };
}

/** A copy of a mini siege run file in a temp folder (its `game` pointing back), and its parsed JSON. */
function copyRun(name: string, edit?: (run: { missions: PlayStep[] }) => void) {
  const dir = tempDir();
  const run = JSON.parse(readFileSync(join(GAME, `runs/${name}.run.json`), 'utf8')) as {
    game: string;
    missions: PlayStep[];
  };
  const committed = structuredClone(run.missions.find((m) => m.action === 'play')!.input!);
  run.game = relative(dir, GAME);
  edit?.(run);
  const file = join(dir, `${name}.run.json`);
  writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
  return { dir, file, committed };
}

async function cli(argv: string[]): Promise<{ code: number; result: Record<string, unknown> }> {
  let stdout = '';
  const code = await main([...argv, '--json'], {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd: ROOT,
    outDir: join(tempDir(), 'out'),
  });
  return { code, result: JSON.parse(stdout) as Record<string, unknown> };
}

const playInput = (file: string) =>
  (JSON.parse(readFileSync(file, 'utf8')) as { missions: PlayStep[] }).missions.find(
    (m) => m.action === 'play',
  )!.input;

describe('record', () => {
  it("re-records played.run.json's sabotage round with the kit's bot: the committed input, unchanged hashes", async () => {
    const { file, committed } = copyRun('played', (run) => {
      // Start from no recorded input: the bot plays the round, the recorder writes it.
      delete run.missions.find((m) => m.action === 'play')!.input;
    });
    const { code, result } = await cli(['record', file, '--mission', 'sabotage', '--bot', BOT]);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({
      mission: 'sabotage',
      tick: 40,
      source: 'bot',
      ticks: 406,
      steps: committed.steps.length,
      path: 'missions.1.input',
      written: true,
      verified: true,
      changed: true,
      passed: true,
      finalHash: '4cb20d9d684a4849',
      hashMismatch: null,
    });
    expect(result.input).toEqual(committed);
    expect(playInput(file)).toEqual(committed);
  }, 60_000);

  it("re-records fortify-played's walls round with TdBot, unchanged", async () => {
    const { file, committed } = copyRun('fortify-played');
    const plan = JSON.stringify([
      { do: 'place', tower: 'archers', col: 11, row: 1 },
      { do: 'place', tower: 'archers', col: 4, row: 5 },
      { do: 'wave' },
    ]);
    const { code, result } = await cli(['record', file, '--mission', 'fortify', '--bot', plan]);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({ ticks: 116, verified: true, passed: true });
    // Engine 0.15 T8: fortify's report-driven effects moved its hashes (0b43372f77faea35 before).
    expect(result.finalHash).toBe('2b9327daefddd9a1');
    expect(result.input).toEqual(committed);
    expect(playInput(file)).toEqual(committed);
  }, 60_000);

  it("with two rounds, --bot drives only the target play step's round (fortify played as written, then sabotage)", async () => {
    const { file, committed } = copyRun('fortify-played', (run) => {
      const r = run as typeof run & {
        ticks: number;
        hashes: { tick: number }[];
        assertions: { tick: number }[];
        invariants: unknown[];
      };
      // A sabotage round after the walls round; the checks after tick 170 described a world
      // without it (and the burnt engines break the "alive" invariants), so they go.
      r.missions.push(
        { tick: 170, mission: 'sabotage', action: 'open' },
        { tick: 170, mission: 'sabotage', action: 'play' },
      );
      r.ticks = 700;
      r.hashes = r.hashes.filter((h) => h.tick <= 170);
      r.assertions = r.assertions.filter((a) => a.tick <= 170);
      r.invariants = [];
    });
    const { code, result } = await cli(['record', file, '--mission', 'sabotage', '--bot', BOT]);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({
      tick: 170,
      source: 'bot',
      path: 'missions.3.input',
      written: true,
      verified: true,
      passed: true,
      hashMismatch: null,
    });
    const missions = (JSON.parse(readFileSync(file, 'utf8')) as { missions: PlayStep[] }).missions;
    // The walls round keeps its own input; the sabotage round gets the bot's.
    expect(missions[1]!.input).toEqual(committed);
    expect(missions[3]!.input).toEqual(result.input);
    expect((result.input as { steps: unknown[] }).steps.length).toBeGreaterThan(0);
  }, 60_000);

  it('writes a page recording (the list from window.__ww.recordings()) and plays the run', async () => {
    const { dir, file, committed } = copyRun('played', (run) => {
      run.missions.find((m) => m.action === 'play')!.input = { steps: [] };
    });
    const recording = join(dir, 'recording.json');
    writeFileSync(
      recording,
      JSON.stringify([
        { mission: 'fortify', tick: 10, ticks: 3, done: true, input: { steps: [] } },
        { mission: 'sabotage', tick: 40, ticks: 406, done: true, input: committed },
      ]),
    );
    const { code, result } = await cli(['record', file, '--mission', 'sabotage', '--input', recording]);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({
      source: 'input',
      ticks: 406,
      written: true,
      verified: true,
      passed: true,
    });
    expect(result.finalHash).toBe('4cb20d9d684a4849');
    expect(playInput(file)).toEqual(committed);
  }, 60_000);

  it('exits 4 when a different round moves the hashes, and puts the run file back', async () => {
    const { dir, file } = copyRun('played');
    const before = readFileSync(file, 'utf8');
    const recording = join(dir, 'idle.json');
    writeFileSync(recording, JSON.stringify({ steps: [{ frame: 0, hold: ['up'] }] }));
    const { code, result } = await cli(['record', file, '--mission', 'sabotage', '--input', recording]);
    expect(code).toBe(EXIT.failedCheck);
    expect(result).toMatchObject({ written: true, verified: true, passed: false, restored: true });
    expect(result.hashMismatch).not.toBeNull();
    expect(readFileSync(file, 'utf8')).toBe(before);
  }, 60_000);

  it('a bad mission id is a usage error (exit 2), a recording that breaks the schema exit 3 with the file untouched', async () => {
    const { dir, file } = copyRun('played');
    const before = readFileSync(file, 'utf8');
    const bad = await cli(['record', file, '--mission', 'nope', '--bot', BOT]);
    expect(bad.code).toBe(EXIT.usage);
    expect(String((bad.result.error as { message: string }).message)).toMatch(
      /no "play" step for mission "nope" \(play steps: sabotage\)/,
    );
    const recording = join(dir, 'bad.json');
    writeFileSync(recording, JSON.stringify({ steps: [{ frame: 0, hold: ['fly'] }] }));
    const broken = await cli(['record', file, '--mission', 'sabotage', '--input', recording]);
    expect(broken.code).toBe(EXIT.invalidContent);
    expect(broken.result).toMatchObject({ written: false, verified: false });
    expect(JSON.stringify(broken.result.errors)).toMatch(/missions\.1\.input\.steps\.0\.hold\.0/);
    expect(readFileSync(file, 'utf8')).toBe(before);
    // No source, both sources, a bad plan, a missing file: usage errors, nothing written.
    for (const argv of [
      ['record', file, '--mission', 'sabotage'],
      ['record', file, '--mission', 'sabotage', '--bot', BOT, '--input', recording],
      ['record', file, '--mission', 'sabotage', '--bot', '[{"do": "fight"}]'],
      ['record', file, '--mission', 'sabotage', '--input', join(dir, 'missing.json')],
      ['record', file, '--mission', 'sabotage', '--play', '1', '--bot', BOT],
    ])
      expect((await cli(argv)).code).toBe(EXIT.usage);
    expect(readFileSync(file, 'utf8')).toBe(before);
  }, 60_000);
});

describe('pickRecording', () => {
  const input = { steps: [{ frame: 0, hold: ['up'] }] };
  it('takes a bare script, one recording, or the one of a list at the play tick', () => {
    expect(pickRecording(input, 'sabotage', 40)).toEqual({ input, tick: null, ticks: null });
    const rec = { mission: 'sabotage', tick: 40, ticks: 9, done: true, input };
    expect(pickRecording(rec, 'sabotage', 40)).toEqual({ input, tick: 40, ticks: 9 });
    const other = { ...rec, tick: 90, input: { steps: [] } };
    expect(pickRecording([other, rec], 'sabotage', 40).input).toEqual(input);
  });

  it('refuses another mission, another tick and an unfinished round', () => {
    const rec = { mission: 'sabotage', tick: 40, ticks: 9, done: true, input };
    expect(() => pickRecording([rec], 'fortify', 40)).toThrow(UsageError);
    expect(() => pickRecording(rec, 'sabotage', 41)).toThrow(/played at tick 40.*plays it at tick 41/);
    expect(() => pickRecording({ ...rec, done: false }, 'sabotage', 40)).toThrow(/had not ended/);
    expect(() => pickRecording([rec, { ...rec, tick: 90 }], 'sabotage', 41)).toThrow(/none at/);
  });
});
