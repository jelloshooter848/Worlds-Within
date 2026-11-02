import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import {
  playMissionRound,
  snapshotEntities,
  type MiniGameEnd,
  type MissionRoundResult,
} from '@engine/core/mission-adapter';
import type { MissionAdapter, MissionDef } from '@engine/core/missions';
import {
  commitMission,
  delegateMission,
  missionsOf,
  openMission,
  playMission,
  scenarioKeys,
  worldFromScenario,
  type World,
} from '@engine/sim/index';
import { roomChallenge, type ChallengeReport, type RoomChallenge, type RoomDef } from '@kits/topdown';
import { TopDownBot } from '@kits/topdown/bot';

// A mission played through a kit without the kit importing the sim (Engine 0.10 T7). Kits may not
// import engine/sim, so this lives here, outside every layer, like rts-sim.test.ts: the siege
// fixture world opens its `raid` mission, a small adapter turns the mission's plain snapshot into
// a top-down room whose knights are the world's real siege engines, the round is played with a
// scripted bot, the kit's report is mapped to one of the raid's declared outcomes, and the sim
// commits it. The same mission delegated is the second path.

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../engine/sim/__fixtures__/${name}`, import.meta.url), 'utf8'),
  ) as unknown;

const SCENARIO = fixture('siege.world.json');
const RAID = fixture('raid.mission.json') as MissionDef;
const REFS = scenarioKeys(SCENARIO);
const ROUND_SEED = 41;

/** What the top-down kit plays the raid from. */
interface RaidInput {
  room: RoomDef;
  params: JsonObject;
}

/**
 * The glue for one raid round: the world's defenders (the mission event's members of the
 * defending faction) become knights in a one-room challenge, laid out as they stand in the world;
 * the round's report becomes `clean` (every engine beaten), `partial` (some), `repelled` (none) or
 * `onQuit`. `places` remembers which room cell holds which scenario key between `input` and
 * `outcome` (an adapter is made per round).
 */
function raidAdapter(refs: Readonly<Record<string, number>>, defending = 'blue') {
  const keyOf = new Map(Object.entries(refs).map(([key, id]) => [id, key]));
  const places = new Map<string, string>();
  const adapter: MissionAdapter<RaidInput, MiniGameEnd> = {
    input(snapshot, mission) {
      const defenders = snapshotEntities(snapshot, 'EventMember', 'Owner', 'Position', 'Unit').filter(
        (e) =>
          (e.components['EventMember'] as { event: string }).event === mission.event &&
          (e.components['Owner'] as { faction: string }).faction === defending,
      );
      if (defenders.length !== mission.params?.['engines'])
        throw new Error(
          `the world has ${defenders.length} engines, the mission says ${mission.params?.['engines']}`,
        );
      const at = (e: (typeof defenders)[number]) => e.components['Position'] as { x: number; y: number };
      const minX = Math.min(...defenders.map((e) => at(e).x));
      const minY = Math.min(...defenders.map((e) => at(e).y));
      const rows = Array.from({ length: 11 }, (_, r) =>
        r === 0 || r === 10 ? '#'.repeat(16) : `#${'.'.repeat(14)}#`,
      ).map((row) => row.split(''));
      rows[8]![12] = '@';
      places.clear();
      for (const e of defenders) {
        const col = 3 + (at(e).x - minX) * 3;
        const row = 3 + (at(e).y - minY) * 3;
        rows[row]![col] = 'n';
        places.set(`${col},${row}`, keyOf.get(e.id) ?? String(e.id));
      }
      return {
        room: { id: 'siege-camp', at: [0, 0], map: rows.map((r) => r.join('')) },
        params: { goal: 'defeat-all', ticks: 1200, hp: 6 },
      };
    },
    outcome(end, mission) {
      if (end.report === null) throw new Error('the round gave no report');
      const report = end.report as ChallengeReport;
      const named = (cells: readonly string[]) =>
        cells.map((cell) => {
          const key = places.get(cell);
          if (key === undefined)
            throw new Error(`the report names "${cell}", which is no engine of the world`);
          return key;
        });
      const destroyed = named(report.defeated);
      const hurt = named(report.hurt);
      const outcome =
        end.result === 'quit'
          ? mission.onQuit
          : destroyed.length === places.size
            ? 'clean'
            : destroyed.length > 0
              ? 'partial'
              : 'repelled';
      return { outcome, stats: { destroyed, hurt, heroLost: report.hero.lost, ticks: end.ticks } };
    },
  };
  return adapter;
}

const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 16);

/** A bot's round: `fight` until the round ends, or for `fightTicks` and then stand still. */
function botInput(fightTicks = Infinity) {
  const bot = new TopDownBot({ 'siege-camp': [{ do: 'fight' }] });
  const input = new ScriptedInput({ steps: [] });
  return (tick: number, round: unknown) => {
    input.setHeld(tick < fightTicks ? bot.next((round as RoomChallenge).world) : []);
    input.next();
    return input;
  };
}

interface Played {
  world: World;
  played: MissionRoundResult;
  roundHashes: string[];
}

/** Open the raid on a fresh siege world and play it through the kit (nothing committed yet). */
function playRaid(opts: { mission?: MissionDef; fightTicks?: number; ticks?: number } = {}): Played {
  const world = worldFromScenario(SCENARIO);
  const opened = openMission(world, opts.mission ?? RAID, { refs: REFS });
  if (!opened.ok) throw new Error(opened.error);
  const adapter = raidAdapter(REFS);
  const roundHashes: string[] = [];
  const input = botInput(opts.fightTicks);
  const played = playMissionRound({
    mission: opened.mission,
    snapshot: opened.snapshot,
    adapter,
    start: (kit) =>
      roomChallenge({ id: 'sabotage', title: 'SABOTAGE', room: kit.room }).create(
        { params: opts.ticks ? { ...kit.params, ticks: opts.ticks } : kit.params, attempt: 1 },
        ROUND_SEED,
      ),
    input: (tick, round) => {
      if (tick % 60 === 0) roundHashes.push(hash(round.snapshot()));
      return input(tick, round);
    },
  });
  return { world, played, roundHashes };
}

/** Play the raid and commit the played result: the round's and the world's hashes. */
function playedRun(opts: Parameters<typeof playRaid>[0] = {}) {
  const { world, played, roundHashes } = playRaid(opts);
  if (!played.ok) throw new Error(played.error);
  const done = commitMission(world, 'raid', played.result);
  if (!done.ok) throw new Error(done.error);
  return { world, played, record: done.record, roundHashes, worldHash: hash(world.snapshot()) };
}

function delegatedRun() {
  const world = worldFromScenario(SCENARIO);
  const opened = openMission(world, RAID, { refs: REFS });
  if (!opened.ok) throw new Error(opened.error);
  const resolved = delegateMission(world, 'raid');
  if (!resolved.ok) throw new Error(resolved.error);
  const done = commitMission(world, 'raid');
  if (!done.ok) throw new Error(done.error);
  return { world, record: done.record, worldHash: hash(world.snapshot()) };
}

const has = (world: World, key: string) => world.alive(REFS[key]!);

describe('a mission played through the topdown kit by an adapter', () => {
  it("builds the kit's room from the world's real defenders", () => {
    const world = worldFromScenario(SCENARIO);
    const opened = openMission(world, RAID, { refs: REFS });
    if (!opened.ok) throw new Error(opened.error);
    const input = raidAdapter(REFS).input(opened.snapshot, opened.mission);
    expect(input.room.map.join('\n').split('n').length - 1).toBe(3);
    expect(input.room.map[3]).toBe('#..n..n........#'); // ram (11,4) and catapult (12,4)
    expect(input.room.map[6]).toBe('#..n...........#'); // tower (11,5)
  });

  it('plays the raid, maps the report to a declared outcome and commits it', () => {
    const run = playedRun();
    expect(run.played.ok && run.played.end.result).toBe('pass');
    expect(run.record).toMatchObject({
      mission: 'raid',
      outcome: 'clean',
      resolution: 'played',
      openTick: 0,
      commitTick: 30,
      skipped: [],
    });
    expect(run.record.report?.stats?.['destroyed']).toEqual(['ram', 'catapult', 'tower']);
    // The world changed as `clean` declares: all three engines gone, the attackers untouched.
    for (const key of ['ram', 'tower', 'catapult']) expect(has(run.world, key)).toBe(false);
    expect(has(run.world, 's1') && has(run.world, 's2')).toBe(true);
    expect(run.world.tick).toBe(30);
    expect(missionsOf(run.world).status('raid')).toBe('committed');
  });

  it('maps a round that runs out of time with engines standing to `partial`', () => {
    const run = playedRun({ ticks: 160 });
    expect(run.played.ok && run.played.end.result).toBe('fail');
    expect(run.record.outcome).toBe('partial');
    expect(run.record.report?.stats).toMatchObject({ destroyed: ['ram'], hurt: ['catapult'] });
    expect(has(run.world, 'ram')).toBe(false);
    expect(has(run.world, 'catapult')).toBe(true);
  });

  it('delegates the same mission: a declared outcome drawn by the world, its effects applied', () => {
    const run = delegatedRun();
    expect(run.record.resolution).toBe('delegated');
    expect(RAID.outcomes.map((o) => o.id)).toContain(run.record.outcome);
    expect(run.record.outcome).toBe('partial'); // the seeded draw (pinned in GOLDEN too)
    expect(has(run.world, 'ram')).toBe(false);
    expect((run.world.get(REFS['tower']!, 'Health') as { hp: number }).hp).toBe(15);
    expect(run.world.tick).toBe(30);
  });

  it('gives the same hashes on every run, played and delegated', () => {
    const a = playedRun();
    const b = playedRun();
    expect(b.roundHashes).toEqual(a.roundHashes);
    expect(b.worldHash).toBe(a.worldHash);
    expect(canonicalJson(b.record)).toBe(canonicalJson(a.record));
    expect(delegatedRun().worldHash).toBe(delegatedRun().worldHash);
    const d = delegatedRun();
    expect({
      round: a.roundHashes,
      played: a.worldHash,
      delegated: d.worldHash,
      drawn: d.record.outcome,
    }).toEqual(GOLDEN);
  });

  it('refuses a report the adapter cannot map, and commits nothing', () => {
    const world = worldFromScenario(SCENARIO);
    const opened = openMission(world, RAID, { refs: REFS });
    if (!opened.ok) throw new Error(opened.error);
    const adapter = raidAdapter(REFS);
    const before = hash(world.snapshot());
    const played = playMissionRound({
      mission: opened.mission,
      snapshot: opened.snapshot,
      adapter,
      // A room with a knight the world never had: the report names a cell that is no engine.
      start: (kit) => {
        const map = [...kit.room.map];
        map[8] = '#.n.........@..#';
        return roomChallenge({ id: 'sabotage', room: { ...kit.room, map } }).create(
          { params: kit.params, attempt: 1 },
          ROUND_SEED,
        );
      },
      input: botInput(),
    });
    expect(played).toMatchObject({ ok: false, code: 'unmappable_report' });
    expect(!played.ok && played.error).toMatch(/names "2,8", which is no engine/);
    expect(hash(world.snapshot())).toBe(before);
    expect(missionsOf(world).open()[0]?.resolved).toBeNull();
  });

  it('refuses an outcome the mission does not let a player reach, in the adapter and in the sim', () => {
    const mission: MissionDef = { ...RAID, playable: ['clean', 'repelled'] };
    const { world, played } = playRaid({ mission, ticks: 160 });
    expect(played).toMatchObject({ ok: false, code: 'unknown_outcome' });
    expect(!played.ok && played.end?.result).toBe('fail');
    const direct = playMission(world, 'raid', { outcome: 'partial' });
    expect(direct).toMatchObject({ ok: false, code: 'unknown_outcome' });
    expect(missionsOf(world).open()[0]?.resolved).toBeNull();
  });
});

/** The hashes both paths give, every run (the round's every 60 ticks; the world's after the commit). */
const GOLDEN = {
  round: ['d17b39d74adaacb2', 'befc970f9a34003d', 'e050d8cd96c88660', '90f7ede8b6c3ec9d'],
  played: 'f3bc87d6ecbe8175',
  delegated: '12e460df6445e177',
  drawn: 'partial',
};
