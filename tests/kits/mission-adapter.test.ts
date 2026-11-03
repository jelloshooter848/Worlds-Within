import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { playMissionRound, type MissionRoundResult } from '@engine/core/mission-adapter';
import type { MiniGameDef } from '@engine/core/minigame';
import { miniGameParamErrors } from '@engine/core/minigame-params';
import type { MissionDef } from '@engine/core/missions';
import {
  commitMission,
  delegateMission,
  missionsOf,
  openMission,
  playMission,
  quitMission,
  scenarioKeys,
  worldFromScenario,
  type World,
} from '@engine/sim/index';
import {
  MISSION_ROOM,
  missionRoom,
  topdownMissionAdapter,
  type MissionRoomInput,
  type MissionRoomReport,
  type RoomChallenge,
  type RoomDef,
} from '@kits/topdown';
import { TopDownBot } from '@kits/topdown/bot';

// A mission played through a kit without the kit importing the sim (Engine 0.10 T7; from Engine
// 0.11 T7 through the kit's own data-driven adapter, `kits/topdown/mission-room.ts`). Kits may not
// import engine/sim, so this lives here, outside every layer, like rts-sim.test.ts: the siege
// fixture world opens its `raid` mission, a real `mission-room` mission (Engine 0.15 T9, gap M12),
// whose params (in the sim's `raid.mission.json` itself) say which world entities become the room's
// knights and which report means which declared outcome. No mapping is written here: the round is played with
// a scripted bot, the kit's adapter maps its report, and the sim commits it. The same mission
// delegated is the second path.

const simFixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../engine/sim/__fixtures__/${name}`, import.meta.url), 'utf8'),
  ) as unknown;
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')) as unknown;

const SCENARIO = simFixture('siege.world.json');
/** The sim fixture's raid, played as it is: `play: "mission-room"` and its params (gap M12). */
const RAID = simFixture('raid.mission.json') as MissionDef;
const PARAMS = RAID.params as JsonObject;
const CAMP = fixture('siege-camp.room.json') as RoomDef;
const ROOM = missionRoom({ rooms: [CAMP] });
const REFS = scenarioKeys(SCENARIO);
const ROUND_SEED = 41;

/** The raid with some of its params changed (a shorter round, say): still data, not code. */
const withParams = (changes: JsonObject): MissionDef => ({ ...RAID, params: { ...PARAMS, ...changes } });

const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 16);

/**
 * A bot's round: `fight` until the round ends, or for `fightTicks` and then stand still; with
 * `quitAt`, press select (quit) on that tick.
 */
function botInput(fightTicks = Infinity, quitAt = Infinity) {
  const bot = new TopDownBot({ 'siege-camp': [{ do: 'fight' }] });
  const input = new ScriptedInput({ steps: [] });
  return (tick: number, round: unknown) => {
    const held = tick < fightTicks ? bot.next((round as RoomChallenge).world) : [];
    input.setHeld(tick === quitAt ? ['select'] : held);
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
function playRaid(
  opts: { mission?: MissionDef; def?: MiniGameDef; fightTicks?: number; quitAt?: number } = {},
): Played {
  const world = worldFromScenario(SCENARIO);
  const opened = openMission(world, opts.mission ?? RAID, { refs: REFS });
  if (!opened.ok) throw new Error(opened.error);
  const roundHashes: string[] = [];
  const input = botInput(opts.fightTicks, opts.quitAt);
  const played = playMissionRound({
    mission: opened.mission,
    snapshot: opened.snapshot,
    adapter: topdownMissionAdapter,
    start: (params) => (opts.def ?? ROOM).create({ params, attempt: 1 }, ROUND_SEED),
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

describe("a mission played through the topdown kit's data-driven adapter", () => {
  it('reads the sim fixture as a real mission-room mission, its params valid for the kit (M12)', () => {
    expect(RAID.play).toBe(MISSION_ROOM);
    const use = {
      file: 'raid.mission.json',
      game: RAID.play ?? '',
      gameAt: ['play'],
      params: PARAMS,
      paramsAt: ['params'],
      owner: RAID as unknown as JsonObject,
    };
    expect(miniGameParamErrors([use], [ROOM])).toEqual([]);
  });

  it("puts the world's real defenders in the room's slots, as the mission's data says", () => {
    const world = worldFromScenario(SCENARIO);
    const opened = openMission(world, RAID, { refs: REFS });
    if (!opened.ok) throw new Error(opened.error);
    const input = topdownMissionAdapter.input(opened.snapshot, opened.mission) as MissionRoomInput;
    expect(input).toMatchObject({ room: 'siege-camp', goal: 'defeat-all', ticks: 1200, hp: 6, slots: ['n'] });
    // The blue siege engines of the event, ascending id; the red soldiers (also members) are not picked.
    expect(input.foes.map((f) => [f.name, f.entity, f.kind])).toEqual([
      ['ram', REFS['ram'], 'knight'],
      ['tower', REFS['tower'], 'knight'],
      ['catapult', REFS['catapult'], 'knight'],
    ]);
    const round = ROOM.create({ params: input, attempt: 1 }, ROUND_SEED) as RoomChallenge;
    expect(round.world.enemies().map((e) => [e.kind, e.key])).toEqual([
      ['knight', '3,3'],
      ['knight', '6,3'],
      ['knight', '3,6'],
    ]);
    expect((round.report() as MissionRoomReport).placed).toEqual([
      { cell: '3,3', entity: REFS['ram'], name: 'ram' },
      { cell: '6,3', entity: REFS['tower'], name: 'tower' },
      { cell: '3,6', entity: REFS['catapult'], name: 'catapult' },
    ]);
  });

  it('plays the raid, maps a round with every engine beaten to `clean` and commits it', () => {
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
    expect(run.record.report?.stats).toMatchObject({ destroyed: ['ram', 'tower', 'catapult'], hurt: [] });
    // The world changed as `clean` declares: all three engines gone, the attackers untouched.
    for (const key of ['ram', 'tower', 'catapult']) expect(has(run.world, key)).toBe(false);
    expect(has(run.world, 's1') && has(run.world, 's2')).toBe(true);
    expect(run.world.tick).toBe(30);
    expect(missionsOf(run.world).status('raid')).toBe('committed');
  });

  it('maps a round that runs out of time with engines standing to `partial`', () => {
    const run = playedRun({ mission: withParams({ ticks: 160 }) });
    expect(run.played.ok && run.played.end.result).toBe('fail');
    expect(run.record.outcome).toBe('partial');
    expect(run.record.report?.stats).toMatchObject({ destroyed: ['ram'], hurt: ['tower'] });
    expect(has(run.world, 'ram')).toBe(false);
    expect((run.world.get(REFS['tower']!, 'Health') as { hp: number }).hp).toBe(15);
  });

  it('maps a round with no engine beaten to `repelled`, its effects applied', () => {
    const run = playedRun({ mission: withParams({ ticks: 30 }), fightTicks: 0 });
    expect(run.played.ok && run.played.end.result).toBe('fail');
    expect(run.record.outcome).toBe('repelled');
    expect(run.record.report?.stats).toMatchObject({ destroyed: [], hurt: [], ticks: 30 });
    for (const key of ['ram', 'tower', 'catapult']) expect(has(run.world, key)).toBe(true);
    expect((run.world.get(REFS['s1']!, 'Health') as { hp: number }).hp).toBe(18);
  });

  it('commits a quit as its onQuit outcome, resolution quit, even when onQuit is not playable', () => {
    const mission: MissionDef = { ...RAID, playable: ['clean', 'partial'] };
    const { world, played } = playRaid({ mission, quitAt: 20 });
    expect(played).toMatchObject({ ok: true, quit: true, end: { result: 'quit' } });
    if (!played.ok) throw new Error(played.error);
    expect(played.result.outcome).toBe('repelled');
    const quit = quitMission(world, 'raid');
    if (!quit.ok) throw new Error(quit.error);
    const done = commitMission(world, 'raid', played.result);
    if (!done.ok) throw new Error(done.error);
    expect(done.record).toMatchObject({ outcome: 'repelled', resolution: 'quit' });
    expect(done.record.report).toBeUndefined();
    for (const key of ['ram', 'tower', 'catapult']) expect(has(world, key)).toBe(true);
  });

  it('follows the rules in the order the data gives them', () => {
    // Moving `repelled` first (a rule that holds for any round that fails) changes the mapping.
    const outcomes = [
      { outcome: 'repelled', when: { result: 'fail' } },
      { outcome: 'partial', when: { spared: ['tower'] } },
      { outcome: 'clean' },
    ];
    expect(playedRun({ mission: withParams({ ticks: 160, outcomes }) }).record.outcome).toBe('repelled');
    expect(playedRun({ mission: withParams({ outcomes }) }).record.outcome).toBe('clean');
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
    // A room with a bat the world never had: the report names a cell that is no world entity.
    const map = [...CAMP.map];
    map[8] = '#.b.........@..#';
    const def = missionRoom({ rooms: [{ ...CAMP, map }] });
    const { world, played } = playRaid({ def });
    const before = hash(world.snapshot());
    expect(played).toMatchObject({ ok: false, code: 'unmappable_report' });
    expect(!played.ok && played.error).toMatch(/names "2,8", which is no entity of the world/);
    expect(hash(world.snapshot())).toBe(before);
    expect(missionsOf(world).open()[0]?.resolved).toBeNull();
  });

  it('refuses a round before it starts when the room has too few slots for the world', () => {
    const map = CAMP.map.map((row) => row.replace(/n/g, '.'));
    map[3] = '#..n...........#';
    const def = missionRoom({ rooms: [{ ...CAMP, map }] });
    expect(() => playRaid({ def })).toThrow(/too few "n" cells: 2 more foe\(s\) \(tower, catapult\)/);
  });

  it('refuses an outcome the mission does not let a player reach, in the adapter and in the sim', () => {
    const mission: MissionDef = { ...withParams({ ticks: 160 }), playable: ['clean', 'repelled'] };
    const { world, played } = playRaid({ mission });
    expect(played).toMatchObject({ ok: false, code: 'unknown_outcome' });
    expect(!played.ok && played.end?.result).toBe('fail');
    const direct = playMission(world, 'raid', { outcome: 'partial' });
    expect(direct).toMatchObject({ ok: false, code: 'unknown_outcome' });
    expect(missionsOf(world).open()[0]?.resolved).toBeNull();
  });
});

/**
 * The hashes both paths give, every run (the round's every 60 ticks; the world's after the commit).
 * The round's and the delegated world's are the 0.10 test's; `played` was re-recorded in 0.11 T7
 * (the record's stats now list the engines in slot order, ram, tower, catapult).
 */
const GOLDEN = {
  round: ['d17b39d74adaacb2', 'befc970f9a34003d', 'e050d8cd96c88660', '90f7ede8b6c3ec9d'],
  played: '01513067f9a5e3b2',
  delegated: '12e460df6445e177',
  drawn: 'partial',
};
