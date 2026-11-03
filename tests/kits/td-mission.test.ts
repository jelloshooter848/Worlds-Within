import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import type { Action } from '@engine/core/input/actions';
import { ScriptedInput, type InputScript } from '@engine/core/input/scripted-input';
import { playMissionRound, type MissionRoundResult } from '@engine/core/mission-adapter';
import { MissionHost } from '@engine/core/mission-host';
import type { MissionDef } from '@engine/core/missions';
import {
  commitMission,
  delegateMission,
  missionPort,
  missionsOf,
  openMission,
  quitMission,
  scenarioKeys,
  worldFromScenario,
  type World,
} from '@engine/sim/index';
import {
  TD_DEFENCE,
  TdBot,
  tdDefence,
  towerdefenseMissionAdapter,
  type TdBotStep,
  type TdDefenceInput,
  type TdDefenceRound,
} from '@kits/towerdefense';
import { fixtureRound } from '../../kits/towerdefense/__fixtures__/game';

// A mission played as a tower-defense round through the kit's data-driven adapter (Engine 0.12
// T6), over a real sim world. Kits may not import engine/sim, so this lives here, outside every
// layer, like mission-adapter.test.ts. The fixture world (`__fixtures__/walls.world.json`) has a
// village hall with 60 gold, two walls and three raiders of the `siege` event; its `fortify`
// mission (`__fixtures__/fortify.mission.json`) is played as `td-defence` on the kit fixture's tiny
// map, all from the mission's params: the walls stand on the build cells, the hall's gold (capped)
// pays, the raiders come as the wave. No mapping is written here: the round is played by the kit's
// bot, the kit's adapter maps its report, and the sim commits the declared outcome's effects.

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')) as unknown;

const SCENARIO = fixture('walls.world.json');
const FORTIFY = fixture('fortify.mission.json') as MissionDef;
const REFS = scenarioKeys(SCENARIO);
const TINY = fixtureRound();
const DEFENCE = tdDefence({ maps: [TINY.map], towers: TINY.towers });
const ROUND_SEED = 9;

/** One cannon on the west wall holds the tiny map for 25 gold. */
const CHEAP: TdBotStep[] = [{ do: 'place', tower: 'cannon', col: 1, row: 1 }, { do: 'wave' }];
/** A cannon and an arrow tower: held, for 35 gold. */
const DEAR: TdBotStep[] = [
  { do: 'place', tower: 'cannon', col: 1, row: 1 },
  { do: 'place', tower: 'arrow', col: 3, row: 1 },
  { do: 'wave' },
];
/** No towers: the raiders walk through. */
const NONE: TdBotStep[] = [{ do: 'wave' }];

const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 16);
const gold = (world: World) => (world.get(REFS['hall']!, 'Inventory') as { gold: number }).gold;
const hp = (world: World, key: string) => (world.get(REFS[key]!, 'Health') as { hp: number }).hp;

/** The bot's round as frame input (select on `quitAt`). */
function botInput(plan: readonly TdBotStep[], quitAt = Infinity) {
  const bot = new TdBot(plan);
  const input = new ScriptedInput({ steps: [] });
  return (tick: number, round: unknown) => {
    input.setHeld(tick === quitAt ? ['select'] : bot.next((round as TdDefenceRound).game));
    input.next();
    return input;
  };
}

/** Open the mission on a fresh world and play it through the kit (nothing committed yet). */
function playFortify(plan: readonly TdBotStep[], quitAt = Infinity) {
  const world = worldFromScenario(SCENARIO);
  const opened = openMission(world, FORTIFY, { refs: REFS });
  if (!opened.ok) throw new Error(opened.error);
  const roundHashes: string[] = [];
  const input = botInput(plan, quitAt);
  const played: MissionRoundResult = playMissionRound({
    mission: opened.mission,
    snapshot: opened.snapshot,
    adapter: towerdefenseMissionAdapter,
    start: (params) => DEFENCE.create({ params, attempt: 1 }, ROUND_SEED),
    input: (tick, round) => {
      if (tick % 10 === 0) roundHashes.push(hash(round.snapshot()));
      return input(tick, round);
    },
  });
  return { world, opened, played, roundHashes };
}

/** Play the mission and commit the played result. */
function playedRun(plan: readonly TdBotStep[]) {
  const { world, played, roundHashes } = playFortify(plan);
  if (!played.ok) throw new Error(played.error);
  const done = commitMission(world, 'fortify', played.result);
  if (!done.ok) throw new Error(done.error);
  return { world, played, record: done.record, roundHashes, worldHash: hash(world.snapshot()) };
}

function delegatedRun() {
  const world = worldFromScenario(SCENARIO);
  const opened = openMission(world, FORTIFY, { refs: REFS });
  if (!opened.ok) throw new Error(opened.error);
  const resolved = delegateMission(world, 'fortify');
  if (!resolved.ok) throw new Error(resolved.error);
  const done = commitMission(world, 'fortify');
  if (!done.ok) throw new Error(done.error);
  return { world, record: done.record, worldHash: hash(world.snapshot()) };
}

describe("a mission played through the towerdefense kit's data-driven adapter", () => {
  it("builds the round from the world: its walls, the hall's gold and the raiders", () => {
    const world = worldFromScenario(SCENARIO);
    const opened = openMission(world, FORTIFY, { refs: REFS });
    if (!opened.ok) throw new Error(opened.error);
    const input = towerdefenseMissionAdapter.input(opened.snapshot, opened.mission) as TdDefenceInput;
    expect(input).toEqual({
      map: 'tiny',
      gold: 40, // the hall's 60, capped
      lives: 2,
      walls: [
        { entity: REFS['west-wall'], name: 'west-wall' },
        { entity: REFS['gate'], name: 'gate' },
      ],
      foes: [
        { entity: REFS['brak'], name: 'brak', kind: 'captain', hp: 6, speed: 2, spacing: 6, bounty: 0 },
        { entity: REFS['r1'], name: 'r1', kind: 'raider', hp: 3, speed: 4, spacing: 8, bounty: 1 },
        { entity: REFS['r2'], name: 'r2', kind: 'raider', hp: 3, speed: 4, spacing: 8, bounty: 1 },
      ],
    });
    const round = DEFENCE.create({ params: input, attempt: 1 }, ROUND_SEED) as TdDefenceRound;
    expect(round.cells.map((c) => [c.cell, c.name])).toEqual([
      ['1,1', 'west-wall'],
      ['3,1', 'gate'],
    ]);
  });

  it('plays a cheap hold, maps it to `held-cheap` and commits its declared effects', () => {
    const run = playedRun(CHEAP);
    expect(run.played.ok && run.played.end.result).toBe('pass');
    expect(run.record).toMatchObject({ mission: 'fortify', outcome: 'held-cheap', resolution: 'played' });
    expect(run.record.report?.stats).toMatchObject({
      placed: { cannon: 1 },
      spent: 25,
      leaked: 0,
      livesLeft: 2,
      killed: ['brak', 'r1', 'r2'],
      fallen: [],
    });
    expect(gold(run.world)).toBe(60 - 25);
    for (const key of ['brak', 'r1', 'r2']) expect(run.world.alive(REFS[key]!)).toBe(false);
    expect(run.world.tick).toBe(20);
  });

  it('writes back the declared amount, not the amount the round spent (lesson D3)', () => {
    const run = playedRun(DEAR);
    expect(run.record.outcome).toBe('held');
    expect(run.record.report?.stats?.['spent']).toBe(35);
    // `held` declares 40 gold: the world loses 40, though the round spent 35.
    expect(gold(run.world)).toBe(60 - 40);
  });

  it('maps a breached round to `breached`, its fixed wall damage applied', () => {
    const run = playedRun(NONE);
    expect(run.played.ok && run.played.end.result).toBe('fail');
    expect(run.record.outcome).toBe('breached');
    expect(run.record.report?.stats).toMatchObject({
      leaked: 2,
      livesLeft: 0,
      fallen: ['gate', 'west-wall'],
    });
    expect([hp(run.world, 'gate'), hp(run.world, 'west-wall')]).toEqual([30, 60]);
    expect(gold(run.world)).toBe(60);
    for (const key of ['brak', 'r1', 'r2']) expect(run.world.alive(REFS[key]!)).toBe(true);
  });

  it('commits a quit as its onQuit outcome, resolution quit', () => {
    const { world, played } = playFortify(CHEAP, 5);
    expect(played).toMatchObject({ ok: true, quit: true, end: { result: 'quit' } });
    if (!played.ok) throw new Error(played.error);
    const quit = quitMission(world, 'fortify');
    if (!quit.ok) throw new Error(quit.error);
    const done = commitMission(world, 'fortify', played.result);
    if (!done.ok) throw new Error(done.error);
    expect(done.record).toMatchObject({ outcome: 'breached', resolution: 'quit' });
    expect(done.record.report).toBeUndefined();
    expect(hp(world, 'gate')).toBe(30);
  });

  it('delegates the same mission: a declared outcome drawn by the world, its effects applied', () => {
    const run = delegatedRun();
    expect(run.record.resolution).toBe('delegated');
    expect(FORTIFY.outcomes.map((o) => o.id)).toContain(run.record.outcome);
    expect(run.record.outcome).toBe(GOLDEN.drawn);
    expect(run.world.tick).toBe(20);
  });

  it('gives the same hashes on every run, played and delegated', () => {
    const a = playedRun(CHEAP);
    const b = playedRun(CHEAP);
    expect(b.roundHashes).toEqual(a.roundHashes);
    expect(b.worldHash).toBe(a.worldHash);
    expect(canonicalJson(b.record)).toBe(canonicalJson(a.record));
    const d = delegatedRun();
    expect(delegatedRun().worldHash).toBe(d.worldHash);
    expect({
      round: a.roundHashes,
      played: a.worldHash,
      delegated: d.worldHash,
      drawn: d.record.outcome,
    }).toEqual(GOLDEN);
  });
});

describe('the td-defence mission hosted live (MissionHost over the sim port)', () => {
  const OPEN_TICK = 2;

  /** A recorded round: the bot's held actions as a ScriptedInput script, frame 0 the round's first tick. */
  function recordedScript(plan: readonly TdBotStep[]): InputScript {
    const world = worldFromScenario(SCENARIO);
    const opened = missionPort(world, { refs: REFS }).open(FORTIFY);
    if (!opened.ok) throw new Error(opened.error);
    const bot = new TdBot(plan);
    const live = new ScriptedInput({ steps: [] });
    const steps: { frame: number; hold: Action[] }[] = [];
    playMissionRound({
      mission: FORTIFY,
      snapshot: opened.snapshot,
      adapter: towerdefenseMissionAdapter,
      start: (params) => DEFENCE.create({ params, attempt: 1 }, opened.seed),
      input: (tick, round) => {
        const held = bot.next((round as TdDefenceRound).game);
        const last = steps[steps.length - 1];
        if (last === undefined || last.hold.join() !== held.join())
          steps.push({ frame: tick, hold: [...held] });
        live.setHeld(held);
        live.next();
        return live;
      },
    });
    return { steps };
  }

  function hosted(then: JsonObject) {
    const world = worldFromScenario(SCENARIO);
    const host = new MissionHost({
      port: missionPort(world, { refs: REFS }),
      missions: [FORTIFY],
      miniGames: [DEFENCE],
      adapters: { [TD_DEFENCE]: towerdefenseMissionAdapter },
    });
    const none = new ScriptedInput({ steps: [] });
    const hashes: string[] = [];
    for (let tick = 0; world.tick < OPEN_TICK + FORTIFY.worldTimeCost + 1; tick++) {
      if (world.tick === OPEN_TICK && missionsOf(world).status('fortify') === null) {
        expect(host.mission({ mission: 'fortify', action: 'open' })).toBeNull();
        expect(host.mission(then)).toBeNull();
      }
      host.step(none);
      hashes.push(hash(host.snapshot()));
    }
    return { world, host, hashes };
  }

  it('plays a recorded round while the world waits, then commits at open + cost', () => {
    const script = recordedScript(CHEAP) as unknown as JsonObject;
    const run = hosted({ mission: 'fortify', action: 'play', input: script });
    expect(missionsOf(run.world).record('fortify')).toMatchObject({
      outcome: 'held-cheap',
      resolution: 'played',
      openTick: OPEN_TICK,
      commitTick: OPEN_TICK + 20,
    });
    expect(gold(run.world)).toBe(35);
    expect(run.host.missionExperience()[0]!.ticks).toBeGreaterThan(20);
    expect(hosted({ mission: 'fortify', action: 'play', input: script }).hashes).toEqual(run.hashes);
  });

  it('delegates it live, and quits a hosted round to onQuit', () => {
    const delegated = hosted({ mission: 'fortify', action: 'delegate' });
    expect(missionsOf(delegated.world).record('fortify')).toMatchObject({
      outcome: GOLDEN.drawn,
      resolution: 'delegated',
    });
    const quit = { steps: [{ frame: 0, hold: ['select'] }] };
    const world = worldFromScenario(SCENARIO);
    const host = new MissionHost({
      port: missionPort(world, { refs: REFS }),
      missions: [FORTIFY],
      miniGames: [DEFENCE],
      adapters: { [TD_DEFENCE]: towerdefenseMissionAdapter },
    });
    expect(host.mission({ mission: 'fortify', action: 'open' })).toBeNull();
    expect(host.mission({ mission: 'fortify', action: 'play', input: quit })).toBeNull();
    // The recorded script presses select on the round's first tick.
    const none = new ScriptedInput({ steps: [] });
    while (host.miniGame() !== null) host.step(none);
    expect(host.snapshot()['missions']).toMatchObject({ round: { result: 'quit', outcome: 'breached' } });
  });
});

/** The hashes both paths give (the round's every 10 ticks; the world's after the commit). */
const GOLDEN = {
  round: ['74669aa03ed3e796', 'a77ea819a34611a2', '2e1c6210f5e6462f'],
  played: 'ff29b2868b603426',
  delegated: 'd8b30910e50cde8e',
  drawn: 'held-cheap',
};
