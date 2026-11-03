import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Change, Timeline, TimelineEntry } from '@engine/sim/index';
import { causeMatches } from './commands/events';
import { DUMP_FORMAT, dumpFileSchema, parseDumpFile } from './dump-file';
import { EXIT } from './exit-codes';
import { main } from './main';

// The mini siege's played run is replayed several times per test (each `events` call plays it), so
// on a busy machine a test can pass its work and still go over vitest's default 5 s (as item 233).
vi.setConfig({ testTimeout: 60_000 });

// `events`, `timeline` and `dump --out` (Engine 0.14 T7; docs/BUILD-LOG.md, Engine 0.14,
// decisions 2-4): the world's event log and timeline as data, for game and world runs.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PLAYED = 'games/samples/mini-siege/runs/played.run.json';
const SKIRMISH = 'games/samples/rts-skirmish/runs';
const WALK = 'games/samples/dungeon/runs/walk-east.run.json';
const RAID = 'engine/sim/__fixtures__/raid-partial.run.json';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ww-world-data-'));
  temps.push(dir);
  return dir;
}

async function cli(
  argv: string[],
): Promise<{ code: number; result: Record<string, unknown>; stdout: string }> {
  let stdout = '';
  const code = await main(argv, {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd: ROOT,
    outDir: join(tempDir(), 'out'),
  });
  const result = argv.includes('--json') ? (JSON.parse(stdout) as Record<string, unknown>) : {};
  return { code, result, stdout };
}

describe('timeline', () => {
  it("lists the mini siege's sabotage: open at 40, frozen span, commit at its fixed tick, outcome", async () => {
    const { code, result } = await cli(['timeline', PLAYED, '--json', '--max-output', '1000000']);
    expect(code).toBe(EXIT.ok);
    const timeline = result.timeline as Timeline;
    expect(result).toMatchObject({ tick: 666, ticks: 666, worldTick: 260, logFrom: 0 });
    expect(timeline.frozen).toEqual([{ event: 'siege', by: 'mission:sabotage', from: 40, to: 160 }]);
    expect(timeline.missions).toEqual([
      {
        mission: 'sabotage',
        status: 'committed',
        openTick: 40,
        commitTick: 160,
        resolution: 'played',
        outcome: 'both-burnt',
        experienceTicks: 0,
      },
    ]);
    // The round's own ticks, counted by the game, never written to the world.
    expect(timeline.experience).toEqual([{ mission: 'sabotage', from: 40, ticks: 406 }]);
    // The world stood still while the round was played (game ticks 40 to 446).
    expect(timeline.clock).toEqual([
      { game: 0, world: 0 },
      { game: 40, world: 40 },
      { game: 446, world: 40 },
      { game: 666, world: 260 },
    ]);
    const fortify = timeline.opportunities.find((o) => o.id === 'fortify-window');
    expect(fortify).toMatchObject({ opens: 5, closes: 30, status: 'closed' });
    expect(fortify?.history.map((h) => [h.status, h.by, h.at])).toEqual([
      ['waiting', 'scenario', 0],
      ['offered', 'time', 5],
      ['closed', 'time', 30],
    ]);
    const entries = (result.entries as TimelineEntry[]).filter((e) => e.kind !== 'opportunity');
    expect(entries.map((e) => [e.tick, e.game, e.kind, e.id, e.detail])).toEqual([
      [40, 40, 'open', 'sabotage', null],
      [40, 40, 'freeze', 'siege', null],
      [160, 566, 'unfreeze', 'siege', null],
      [160, 566, 'commit', 'sabotage', 'both-burnt'],
    ]);
  });

  it('reads the record at an earlier tick: the mission open and its event still frozen', async () => {
    const { code, result } = await cli(['timeline', PLAYED, '--tick', '100', '--json']);
    expect(code).toBe(EXIT.ok);
    const timeline = result.timeline as Timeline;
    expect(timeline.worldTick).toBe(40);
    expect(timeline.frozen).toEqual([{ event: 'siege', by: 'mission:sabotage', from: 40, to: null }]);
    expect(timeline.missions[0]).toMatchObject({ mission: 'sabotage', status: 'open', commitTick: 160 });
  });

  it('works on a world run (no clock) and is the same every run', async () => {
    const first = await cli(['timeline', RAID, '--json']);
    expect(first.code).toBe(EXIT.ok);
    const timeline = first.result.timeline as Timeline;
    expect(timeline.clock).toBeNull();
    expect(timeline.frozen).toEqual([{ event: 'siege', by: 'mission:raid', from: 5, to: 35 }]);
    expect(timeline.missions[0]).toMatchObject({ outcome: 'partial', commitTick: 35, experienceTicks: 0 });
    const again = await cli(['timeline', RAID, '--json']);
    expect(again.stdout).toBe(first.stdout);
  });

  it('prints one line per entry in text form', async () => {
    const { code, stdout } = await cli(['timeline', PLAYED]);
    expect(code).toBe(EXIT.ok);
    expect(stdout).toContain('world 160 (game 566)');
    expect(stdout).toMatch(/commit\s+sabotage -> both-burnt {2}by mission:sabotage/);
  });

  it('refuses a game with no world (no_world at headless) and a --tick past the run', async () => {
    const { code, result } = await cli(['timeline', WALK, '--json']);
    expect(code).toBe(EXIT.invalidContent);
    expect(result.errors).toEqual([
      expect.objectContaining({
        file: 'games/samples/dungeon/game.json',
        path: 'headless',
        code: 'no_world',
      }),
    ]);
    expect((await cli(['timeline', PLAYED, '--tick', '667', '--json'])).code).toBe(EXIT.usage);
  });
});

describe('events', () => {
  it("lists one world tick's changes with their causes", async () => {
    const { code, result } = await cli(['events', PLAYED, '--from', '40', '--to', '41', '--json']);
    expect(code).toBe(EXIT.ok);
    const events = result.events as Change[];
    expect(result).toMatchObject({ from: 40, to: 41, worldTick: 260, logFrom: 0, count: events.length });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((c) => c.tick >= 40 && c.tick <= 41)).toBe(true);
    const sabotage = events.filter((c) => c.cause === 'mission:sabotage');
    expect(sabotage.map((c) => c.component)).toEqual([
      'Opportunities',
      'WorldTime',
      'WorldTime',
      'Missions',
      'Missions',
    ]);
  });

  it('filters by cause (and sub-causes), component and entity', async () => {
    const byCause = await cli(['events', PLAYED, '--cause', 'mission', '--json', '--max-output', '1000000']);
    const changes = byCause.result.events as Change[];
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c.cause === 'mission:sabotage')).toBe(true);
    const time = await cli(['events', PLAYED, '--component', 'WorldTime', '--json']);
    const times = time.result.events as Change[];
    expect(times.every((c) => c.component === 'WorldTime')).toBe(true);
    expect(times.map((c) => c.tick)).toContain(160);
    const entity = times[0]!.entity;
    const one = await cli([
      'events',
      PLAYED,
      '--entity',
      String(entity),
      '--from',
      '160',
      '--to',
      '160',
      '--json',
    ]);
    expect((one.result.events as Change[]).every((c) => c.entity === entity && c.tick === 160)).toBe(true);
    expect(causeMatches('mission:sabotage', 'mission')).toBe(true);
    expect(causeMatches('missionary', 'mission')).toBe(false);
  });

  it('gives a world run its log, and the RTS skirmish its own', async () => {
    const world = await cli(['events', RAID, '--cause', 'mission:raid', '--json']);
    expect(world.code).toBe(EXIT.ok);
    expect((world.result.events as Change[]).map((c) => c.tick)).toContain(35);
    const skirmish = await cli(['events', `${SKIRMISH}/battle.run.json`, '--to', '0', '--json']);
    expect(skirmish.code).toBe(EXIT.ok);
    const opening = skirmish.result.events as Change[];
    expect(opening.length).toBeGreaterThan(0);
    expect(opening.every((c) => c.tick === 0)).toBe(true);
    expect(opening.map((c) => c.cause)).toContain('scenario');
  });

  it('refuses a game with no world and --from after --to', async () => {
    const { code, result } = await cli(['events', WALK, '--json']);
    expect(code).toBe(EXIT.invalidContent);
    expect(result.errors).toEqual([expect.objectContaining({ path: 'headless', code: 'no_world' })]);
    expect((await cli(['events', PLAYED, '--from', '5', '--to', '4', '--json'])).code).toBe(EXIT.usage);
  });

  it('cuts the event list whole when it is over the output cap', async () => {
    const { result } = await cli(['events', PLAYED, '--json', '--max-output', '4096']);
    expect(result.truncated).toBe(true);
    expect((result.omitted as Record<string, number>).events).toBeGreaterThan(0);
  });
});

describe('dump --out', () => {
  it('writes a dump file that round-trips through the dump schema', async () => {
    const dir = tempDir();
    const out = join(dir, 'siege-t200.json');
    const { code, result } = await cli(['dump', PLAYED, '--tick', '200', '--out', out, '--json']);
    expect(code).toBe(EXIT.ok);
    expect(result.state).toBeUndefined();
    expect(result).toMatchObject({ tick: 200, format: DUMP_FORMAT, timeline: true });
    const text = readFileSync(out, 'utf8');
    const parsed = parseDumpFile(text);
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    const dump = parsed.dump;
    expect(`${JSON.stringify(dumpFileSchema.parse(JSON.parse(text)))}\n`).toBe(text);
    expect(dump.hash).toBe(result.hash);
    expect(dump.run).toBe(relative(dir, join(ROOT, PLAYED)).replaceAll('\\', '/'));
    expect(dump.events?.changes.every((c) => c.tick <= 40)).toBe(true);
    expect(dump.timeline?.missions[0]).toMatchObject({ mission: 'sabotage', status: 'open' });
    // The plain dump at the same tick has the same state and hash.
    const plain = await cli(['dump', PLAYED, '--tick', '200', '--json', '--max-output', '10000000']);
    expect(plain.result.state).toEqual(dump.state);
    expect(plain.result.hash).toBe(dump.hash);
  });

  it('writes null events and timeline for a game with no world', async () => {
    const out = join(tempDir(), 'walk.json');
    const { code } = await cli(['dump', WALK, '--tick', '10', '--out', out, '--json']);
    expect(code).toBe(EXIT.ok);
    const parsed = parseDumpFile(readFileSync(out, 'utf8'));
    expect(parsed.ok && parsed.dump.events === null && parsed.dump.timeline === null).toBe(true);
  });

  it('refuses a name not ending in .json, and a bad file is named field by field', async () => {
    const out = join(tempDir(), 'walk.txt');
    expect((await cli(['dump', WALK, '--tick', '1', '--out', out, '--json'])).code).toBe(EXIT.usage);
    expect(existsSync(out)).toBe(false);
    const bad = parseDumpFile('{"format":"worlds-within/dump","version":2}');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.errors.some((e) => e.startsWith('version:'))).toBe(true);
    expect(parseDumpFile('nope').ok).toBe(false);
  });
});
