import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import type { Action } from '@engine/core/input/actions';
import type { InputScript } from '@engine/core/input/scripted-input';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { playMissionRound, snapshotEntities, type MiniGameEnd } from '@engine/core/mission-adapter';
import { MissionHost } from '@engine/core/mission-host';
import type { MiniGameDef } from '@engine/core/minigame';
import type { MissionAdapter, MissionDef } from '@engine/core/missions';
import {
  applyOrder,
  missionPort,
  missionsOf,
  scenarioKeys,
  worldFromScenario,
  type World,
} from '@engine/sim/index';
import { rtsGame } from '@kits/rts';
import { roomChallenge, type ChallengeReport, type RoomChallenge, type RoomDef } from '@kits/topdown';
import { TopDownBot } from '@kits/topdown/bot';

// Live mission hosting (Engine 0.11 T5, items 172-174): a test-only host over the siege fixture.
// Kits may not import engine/sim, so this lives here, outside every layer, like
// mission-adapter.test.ts: the RTS kit's game over a siege world, a `MissionHost` over it with the
// sim's `missionPort`, and the topdown kit's room challenge as the raid's round. The played path
// goes through the real round with a recorded script, the delegated path through the world's draw;
// both commit at the open tick plus the raid's worldTimeCost (30 world ticks).

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../engine/sim/__fixtures__/${name}`, import.meta.url), 'utf8'),
  ) as unknown;

const SCENARIO = fixture('siege.world.json');
const RAID = fixture('raid.mission.json') as MissionDef;
const REFS = scenarioKeys(SCENARIO);
const OPEN_TICK = 3;
const COMMIT_TICK = OPEN_TICK + RAID.worldTimeCost;

/** The raid's round: a one-room challenge whose room the adapter builds (params `room`, `round`). */
const SABOTAGE: MiniGameDef = {
  id: 'sabotage',
  title: 'SABOTAGE',
  hostStatus: ['mission'],
  create: (ctx, seed) =>
    roomChallenge({
      id: 'sabotage',
      title: 'SABOTAGE',
      room: ctx.params['room'] as unknown as RoomDef,
    }).create({ ...ctx, params: ctx.params['round'] as JsonObject }, seed),
};

/**
 * The raid's adapter: the mission event's blue engines become knights laid out as they stand in
 * the world; destroyed engines map back to scenario keys, all three `clean`, some `partial`, none
 * `repelled`.
 */
function raidAdapter(): MissionAdapter<JsonObject, MiniGameEnd> {
  const keyOf = new Map(Object.entries(REFS).map(([key, id]) => [id, key]));
  const places = new Map<string, string>();
  return {
    input(snapshot, mission) {
      const engines = snapshotEntities(snapshot, 'EventMember', 'Owner', 'Position', 'Unit').filter(
        (e) =>
          (e.components['EventMember'] as { event: string }).event === mission.event &&
          (e.components['Owner'] as { faction: string }).faction === 'blue',
      );
      const at = (e: (typeof engines)[number]) => e.components['Position'] as { x: number; y: number };
      const minX = Math.min(...engines.map((e) => at(e).x));
      const minY = Math.min(...engines.map((e) => at(e).y));
      const rows = Array.from({ length: 11 }, (_, r) =>
        r === 0 || r === 10 ? '#'.repeat(16) : `#${'.'.repeat(14)}#`,
      ).map((row) => row.split(''));
      rows[8]![12] = '@';
      places.clear();
      for (const e of engines) {
        const col = 3 + (at(e).x - minX) * 3;
        const row = 3 + (at(e).y - minY) * 3;
        rows[row]![col] = 'n';
        places.set(`${col},${row}`, keyOf.get(e.id) ?? String(e.id));
      }
      return {
        room: { id: 'siege-camp', at: [0, 0], map: rows.map((r) => r.join('')) },
        round: { goal: 'defeat-all', ticks: 1200, hp: 6 },
      };
    },
    outcome(end) {
      const report = end.report as ChallengeReport;
      const destroyed = report.defeated.map((cell) => places.get(cell) ?? cell);
      const outcome =
        destroyed.length === places.size ? 'clean' : destroyed.length > 0 ? 'partial' : 'repelled';
      return { outcome, stats: { destroyed, ticks: end.ticks } };
    },
  };
}

/** A siege world with the RTS kit's game over it (no enemy plan) and a mission host over both. */
function siegeHost(): { world: World; host: MissionHost } {
  const world = worldFromScenario(SCENARIO);
  const game = rtsGame({
    world: {
      snapshot: () => world.snapshot(),
      applyOrder: (order) => applyOrder(world, order),
      step: () => world.step(),
    },
    seed: 7,
  });
  const host = new MissionHost({
    game,
    port: missionPort(world, { refs: REFS }),
    missions: [RAID],
    miniGames: [SABOTAGE],
    adapters: { sabotage: raidAdapter() },
  });
  return { world, host };
}

const NO_INPUT = new ScriptedInput({ steps: [] });
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 16);

/**
 * A recorded round that burns all three engines: the topdown kit's bot plays the raid's room once
 * (as a player would) and its held actions become a ScriptedInput script, frame 0 the round's first
 * tick, as a run file's `play` entry carries it.
 */
function recordedScript(): InputScript {
  const world = worldFromScenario(SCENARIO);
  const opened = missionPort(world, { refs: REFS }).open(RAID);
  if (!opened.ok) throw new Error(opened.error);
  const bot = new TopDownBot({ 'siege-camp': [{ do: 'fight' }] });
  const live = new ScriptedInput({ steps: [] });
  const steps: { frame: number; hold: Action[] }[] = [];
  const played = playMissionRound({
    mission: RAID,
    snapshot: opened.snapshot,
    adapter: raidAdapter(),
    start: (params) => SABOTAGE.create({ params, attempt: 1 }, opened.seed),
    input: (tick, round) => {
      const held = bot.next((round as RoomChallenge).world);
      const last = steps[steps.length - 1];
      if (last === undefined || last.hold.join() !== held.join())
        steps.push({ frame: tick, hold: [...held] });
      live.setHeld(held);
      live.next();
      return live;
    },
  });
  if (!played.ok || played.result.outcome !== 'clean')
    throw new Error('the recorded round must burn all three');
  return { steps };
}

interface Path {
  host: MissionHost;
  world: World;
  /** The game tick the commit landed on, and the world tick it landed at. */
  commitGameTick: number;
  hashes: string[];
  frozen: { tick: number; ram: unknown; s1: unknown }[];
  construction: number[];
}

/**
 * Steps the host from tick 0, opening the raid at world tick OPEN_TICK and then taking `then`
 * (`delegate`, or `play` with a script), until the world is two ticks past the commit.
 */
function runPath(then: JsonObject): Path {
  const { world, host } = siegeHost();
  const hashes: string[] = [];
  const frozen: Path['frozen'] = [];
  const construction: number[] = [];
  let commitGameTick = -1;
  for (let tick = 0; world.tick < COMMIT_TICK + 2; tick++) {
    if (world.tick === OPEN_TICK && missionsOf(world).status('raid') === null) {
      expect(host.mission({ mission: 'raid', action: 'open' })).toBeNull();
      expect(host.mission(then)).toBeNull();
    }
    host.step(NO_INPUT);
    hashes.push(hash(host.snapshot()));
    if (missionsOf(world).status('raid') === 'open' && host.miniGame() === null)
      frozen.push({
        tick: world.tick,
        ram: world.get(REFS['ram']!, 'Position'),
        s1: world.get(REFS['s1']!, 'Health'),
      });
    const site = world.get(REFS['site']!, 'Construction') as { progress: number } | undefined;
    if (site) construction.push(site.progress);
    if (commitGameTick < 0 && missionsOf(world).status('raid') === 'committed') commitGameTick = tick + 1;
  }
  return { host, world, commitGameTick, hashes, frozen, construction };
}

describe('MissionHost over the siege fixture (live mission hosting)', () => {
  const script = recordedScript();

  it('plays the raid through a scripted kit round: the world waits, then commits at open + cost', () => {
    const run = runPath({ mission: 'raid', action: 'play', input: script as unknown as JsonObject });
    const record = missionsOf(run.world).record('raid');
    expect(record).toMatchObject({
      outcome: 'clean',
      resolution: 'played',
      openTick: OPEN_TICK,
      commitTick: COMMIT_TICK,
    });
    expect(record?.report?.stats?.['destroyed']).toEqual(['ram', 'catapult', 'tower']);
    for (const key of ['ram', 'tower', 'catapult']) expect(run.world.alive(REFS[key]!)).toBe(false);
    // The round's ticks are game ticks the world did not move in.
    const roundTicks = run.host.missionExperience()[0]!.ticks;
    expect(roundTicks).toBeGreaterThan(30);
    expect(run.commitGameTick).toBe(COMMIT_TICK + roundTicks);
    expect(run.host.missionExperience()).toEqual([{ mission: 'raid', ticks: roundTicks }]);
  });

  it('delegates the raid: the world draws, and it commits at the same tick', () => {
    const run = runPath({ mission: 'raid', action: 'delegate' });
    expect(missionsOf(run.world).record('raid')).toMatchObject({
      outcome: 'partial',
      resolution: 'delegated',
      openTick: OPEN_TICK,
      commitTick: COMMIT_TICK,
    });
    expect(run.commitGameTick).toBe(COMMIT_TICK);
    expect(run.host.missionExperience()).toEqual([]);
  });

  it('holds the battle frozen while the mission is open, and the barracks keeps going up', () => {
    for (const then of [
      { mission: 'raid', action: 'delegate' },
      { mission: 'raid', action: 'play', input: script as unknown as JsonObject },
    ]) {
      const run = runPath(then);
      expect(run.frozen.length).toBeGreaterThan(20);
      for (const f of run.frozen) {
        expect(f.ram).toEqual(run.frozen[0]!.ram);
        expect(f.s1).toEqual(run.frozen[0]!.s1);
      }
      expect(run.construction.at(-1)).toBe(30); // the barracks finished during the cost
      expect(run.construction.some((p, i) => i > 0 && p > run.construction[i - 1]!)).toBe(true);
    }
  });

  it('shows the round in the snapshot only while it is hosted and on the tick it ends', () => {
    const { world, host } = siegeHost();
    expect(host.snapshot()['missions']).toBeUndefined();
    for (let t = 0; t < OPEN_TICK; t++) host.step(NO_INPUT);
    host.mission({ mission: 'raid', action: 'open' });
    host.mission({ mission: 'raid', action: 'play', input: script as unknown as JsonObject });
    expect(host.miniGame()).not.toBeNull();
    const before = world.tick;
    host.step(NO_INPUT);
    expect(world.tick).toBe(before); // the round steps, the world does not
    expect(host.snapshot()['missions']).toMatchObject({ round: { mission: 'raid', ticks: 1, result: null } });
    while (host.miniGame() !== null) host.step(NO_INPUT);
    expect(host.snapshot()['missions']).toMatchObject({ round: { result: 'pass', outcome: 'clean' } });
    host.step(NO_INPUT);
    expect(host.snapshot()['missions']).toBeUndefined();
    expect(world.tick).toBe(before + 1);
  });

  it('refuses steps and orders while a round is hosted, and a play nothing opened', () => {
    const { host } = siegeHost();
    expect(host.mission({ mission: 'raid', action: 'play' })).toMatchObject({ code: 'mission_not_open' });
    expect(host.mission({ mission: 'nowhere', action: 'open' })).toMatchObject({ code: 'unknown_mission' });
    expect(host.mission({ mission: 'raid', action: 'open' })).toBeNull();
    expect(host.mission({ mission: 'raid', action: 'play' })).toBeNull();
    expect(host.mission({ mission: 'raid', action: 'delegate' })).toMatchObject({ code: 'round_hosted' });
    expect(host.order({ id: 1, faction: 'red', type: 'stop', units: [5] })).toMatch(/^round_hosted/);
    // The round is quit (select): the raid resolves to its onQuit outcome.
    const quit = new ScriptedInput({ steps: [{ frame: 0, hold: ['select'] }] });
    quit.next();
    host.step(quit);
    expect(host.miniGame()).toBeNull();
    expect(host.snapshot()['missions']).toMatchObject({ round: { result: 'quit', outcome: 'repelled' } });
    expect(host.mission({ mission: 'raid', action: 'play' })).toMatchObject({ code: 'mission_resolved' });
  });

  it('steps the world after the round exactly as a run that resolved at the open tick (decision 3)', () => {
    const run = runPath({ mission: 'raid', action: 'play', input: script as unknown as JsonObject });
    const report = missionsOf(run.world).record('raid')!.report!;
    // The same world stepped tick by tick with the same result handed over at the open tick.
    const world = worldFromScenario(SCENARIO);
    const port = missionPort(world, { refs: REFS });
    const settled = () => {
      world.step();
      port.settle();
    };
    while (world.tick < OPEN_TICK) settled();
    expect(port.open(RAID).ok).toBe(true);
    expect(port.play('raid', { mission: 'raid', outcome: report.outcome, effects: [], report }).ok).toBe(
      true,
    );
    while (world.tick < run.world.tick) settled();
    expect(hash(world.snapshot())).toBe(hash(run.world.snapshot()));
  });

  it('gives the same hashes on every run, played and delegated', () => {
    const played = [0, 1].map(() =>
      runPath({ mission: 'raid', action: 'play', input: script as unknown as JsonObject }),
    );
    const delegated = [0, 1].map(() => runPath({ mission: 'raid', action: 'delegate' }));
    expect(played[1]!.hashes).toEqual(played[0]!.hashes);
    expect(delegated[1]!.hashes).toEqual(delegated[0]!.hashes);
    // The world after the commit is the world-run's for the same outcome (no experience written).
    expect({
      played: hash(played[0]!.world.snapshot()),
      delegated: hash(delegated[0]!.world.snapshot()),
    }).toEqual(GOLDEN);
  });
});

/** The world's hash two ticks after the commit, each path (pinned so a change is seen). */
const GOLDEN = { played: '16a272c049f63c93', delegated: 'a88e232b24518276' };
