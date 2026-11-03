import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { MissionHost } from '@engine/core/mission-host';
import type { MissionDef } from '@engine/core/missions';
import {
  capturePerson,
  fateOf,
  injurePerson,
  killPerson,
  missionPort,
  missionsOf,
  scenarioKeys,
  worldFromScenario,
  type World,
} from '@engine/sim/index';
import { readWorld } from '@kits/rts';
import {
  MISSION_ROOM,
  missionRoom,
  topdownMissionAdapter,
  type MissionRoomInput,
  type RoomChallenge,
  type RoomDef,
} from '@kits/topdown';
import { TopDownBot } from '@kits/topdown/bot';
import { TD_DEFENCE, towerdefenseMissionAdapter, type TdDefenceInput } from '@kits/towerdefense';

// M13 and fates in every mode (Engine 0.13 T4; docs/BUILD-LOG.md, Engine 0.13, decisions 3 and 4,
// items 222-223), over a real sim world. Kits may not import engine/sim, so this lives here,
// outside every layer, like mission-host.test.ts. The fixture world (`__fixtures__/hero.world.json`)
// has the village's captain Hale (90 of 120 hp, labelled injured below) and sergeant Mara, and the
// raiders of the `gate` event: two unnamed raiders and the named Grell (killed below) and Vosk
// (captured below). Its mission `hold-gate` is a `mission-room` round whose hero is the captain
// (`hero: { select, hpPer: 20 }`); each outcome's `damage` takes its amount from the round's
// `heroHpLost` when played and the declared amount otherwise, and `fell` captures him.

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')) as unknown;

const SCENARIO = fixture('hero.world.json');
const HOLD = fixture('hold-gate.mission.json') as MissionDef;
const GATE = fixture('gate.room.json') as RoomDef;
const REFS = scenarioKeys(SCENARIO);
const ROOM = missionRoom({ rooms: [GATE] });
const CAPTAIN = REFS['captain']!;

/** The same round again later in the world, for checking a captured hero is refused. */
const LAST_STAND: MissionDef = { ...HOLD, id: 'last-stand', title: 'The last stand' };

const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 16);
const hpOf = (world: World, id: number) => (world.get(id, 'Health') as { hp: number }).hp;

/** The world after an earlier fight: the captain injured, Grell dead and Vosk captured. */
function heroWorld(): World {
  const world = worldFromScenario(SCENARIO);
  const cause = 'scenario';
  expect(injurePerson(world, CAPTAIN, { cause }).ok).toBe(true);
  expect(killPerson(world, REFS['grell']!, { cause, by: 'village' }).ok).toBe(true);
  expect(capturePerson(world, REFS['vosk']!, { cause, by: 'village' }).ok).toBe(true);
  return world;
}

/** A host over the bare world (no game: the port steps it) with both hero missions. */
function heroHost() {
  const world = heroWorld();
  const host = new MissionHost({
    port: missionPort(world, { refs: REFS }),
    missions: [HOLD, LAST_STAND],
    miniGames: [ROOM],
    adapters: { [MISSION_ROOM]: topdownMissionAdapter },
  });
  return { world, host };
}

/** Round ticks the played round's player stands still before fighting. */
const IDLE = 120;

const NO_INPUT = new ScriptedInput({ steps: [] });
const QUIT = (() => {
  const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['select'] }] });
  input.next();
  return input;
})();

/**
 * Opens `hold-gate` at tick 0 and resolves it by `how` through the host (the played round driven
 * live by the topdown kit's bot after standing still for `idle` round ticks), then steps until it
 * commits. Returns the world and the record.
 */
function run(how: 'play' | 'delegate' | 'quit', idle = IDLE) {
  const { world, host } = heroHost();
  expect(host.mission({ mission: 'hold-gate', action: 'open' })).toBeNull();
  expect(host.mission({ mission: 'hold-gate', action: how === 'delegate' ? 'delegate' : 'play' })).toBeNull();
  const bot = new TopDownBot({ gate: [{ do: 'fight' }] });
  const live = new ScriptedInput({ steps: [] });
  const hashes: string[] = [];
  let round: RoomChallenge | null = null;
  for (let guard = 0; missionsOf(world).status('hold-gate') !== 'committed'; guard++) {
    if (guard > 5000) throw new Error('the mission never committed');
    const hosted = host.miniGame() as RoomChallenge | null;
    if (hosted !== null) round = hosted;
    if (how === 'quit' && hosted !== null) host.step(QUIT);
    else if (hosted !== null) {
      // The player stands still for the round's first IDLE ticks (the knights get their hits in),
      // then fights.
      const held = bot.next(hosted.world);
      live.setHeld(hosted.world.frame < idle ? [] : held);
      live.next();
      host.step(live);
    } else host.step(NO_INPUT);
    hashes.push(hash(host.snapshot()));
  }
  return { world, host, round, hashes, record: missionsOf(world).record('hold-gate')! };
}

describe('a mission round whose hero is a world unit (M13), through MissionHost', () => {
  it("starts the round's hero on the world unit's hp now (hpPer, rounded up), and skips the lost", () => {
    const world = heroWorld();
    const opened = missionPort(world, { refs: REFS }).open(HOLD);
    if (!opened.ok) throw new Error(opened.error);
    const input = topdownMissionAdapter.input(opened.snapshot, HOLD) as MissionRoomInput;
    // The injured captain at 90 hp: ceil(90 / 20) = 5 half hearts (6 at his full 120).
    expect(input.hp).toBe(5);
    expect(input.hero).toEqual({ entity: CAPTAIN, name: 'captain', worldHp: 90, hpPer: 20 });
    // Grell is dead and Vosk captured: only the two unnamed raiders come, r2 at its reduced hp.
    expect(input.foes.map((f) => [f.entity, f.hp])).toEqual([
      [REFS['r1'], 5],
      [REFS['r2'], 3],
    ]);
  });

  it('played: the hp the round cost goes back to the world through the damage effect', () => {
    const played = run('play');
    expect(played.record).toMatchObject({ mission: 'hold-gate', resolution: 'played' });
    const stats = played.record.report!.stats!;
    const lost = stats['heroLost'] as number;
    expect(stats['hero']).toBe('captain');
    expect(stats['heroHpLost']).toBe(Math.min(lost * 20, 89));
    expect(played.round!.world.hero.maxHp).toBe(5);
    const back = 90 - (stats['heroHpLost'] as number);
    expect(hpOf(played.world, CAPTAIN)).toBe(back);
    // The round never kills the world person: at least 1 hp is always left.
    expect(back).toBeGreaterThanOrEqual(1);
    // Pinned: the recorded play holds the gate after one half heart lost, 20 world hp.
    expect([played.record.outcome, lost, stats['heroHpLost'], back]).toEqual(['held', 1, 20, 70]);
    expect(played.record.skipped).toEqual([]);
    expect(fateOf(played.world, CAPTAIN)?.state).toBe('injured');
    // The same run twice gives the same hashes.
    expect(run('play').hashes).toEqual(played.hashes);
  });

  it('played and lost: the hp the round cost comes back, then the declared capture', () => {
    // The player never fights: the knights wear the hero down until the round runs out of time.
    const lost = run('play', Infinity);
    expect(lost.record).toMatchObject({ outcome: 'fell', resolution: 'played', skipped: [] });
    expect(lost.record.report!.stats).toMatchObject({ heroLost: 3, heroHpLost: 60 });
    expect(hpOf(lost.world, CAPTAIN)).toBe(30);
    expect(fateOf(lost.world, CAPTAIN)).toMatchObject({ state: 'captured', by: 'raiders' });
  });

  it('delegated: a declared outcome drawn by weight, with its declared amount (no report)', () => {
    const delegated = run('delegate');
    const { record, world } = delegated;
    expect(record.resolution).toBe('delegated');
    expect(record.report).toBeUndefined();
    expect(hpOf(world, CAPTAIN)).toBe(record.outcome === 'held' ? 70 : 60);
    expect(record.skipped).toEqual([]);
    expect(run('delegate').hashes).toEqual(delegated.hashes);
  });

  it('quit: onQuit commits the declared damage and the capture; every mode honours it after', () => {
    const { record, world, host } = run('quit');
    expect(record).toMatchObject({ outcome: 'fell', resolution: 'quit', skipped: [] });
    expect(record.report).toBeUndefined();
    expect(hpOf(world, CAPTAIN)).toBe(60);
    expect(fateOf(world, CAPTAIN)).toMatchObject({ state: 'captured', by: 'raiders' });

    // A later round with the same hero is refused: a captured hero cannot start one.
    expect(host.mission({ mission: 'last-stand', action: 'open' })).toBeNull();
    expect(host.mission({ mission: 'last-stand', action: 'play' })).toMatchObject({
      code: 'bad_mission_input',
      error: expect.stringContaining('the hero "captain" is captured') as unknown as string,
    });
    expect(host.miniGame()).toBeNull();

    // The RTS view no longer shows him, and lists him with his fate and hp for a HUD.
    const view = readWorld(world.snapshot());
    expect(view.units.map((u) => u.id)).not.toContain(CAPTAIN);
    expect(view.named.find((p) => p.id === CAPTAIN)).toMatchObject({
      name: 'Hale',
      fate: 'captured',
      hp: 60,
      x: null,
    });
    expect(view.named.map((p) => [p.name, p.fate])).toEqual([
      ['Hale', 'captured'],
      ['Mara', 'active'],
      ['Grell', 'dead'],
      ['Vosk', 'captured'],
    ]);
  });

  it('a tower-defense wave over the same world skips the dead and the captured', () => {
    const world = heroWorld();
    const defend: MissionDef = {
      id: 'man-walls',
      title: 'Man the walls',
      event: 'gate',
      worldTimeCost: 5,
      play: TD_DEFENCE,
      params: {
        map: 'tiny',
        wave: [{ kind: 'raider', select: { faction: 'raiders' }, hpPer: 4, speed: 4 }],
        outcomes: [{ outcome: 'held' }],
      } as JsonObject,
      onQuit: 'held',
      outcomes: [{ id: 'held', title: 'Held', weight: 1, effects: [] }],
    };
    const opened = missionPort(world, { refs: REFS }).open(defend);
    if (!opened.ok) throw new Error(opened.error);
    const input = towerdefenseMissionAdapter.input(opened.snapshot, defend) as TdDefenceInput;
    // Grell (30 hp) and Vosk are not in the wave; r2 comes at its reduced 12 hp.
    expect(input.foes.map((f) => [f.entity, f.hp])).toEqual([
      [REFS['r1'], 5],
      [REFS['r2'], 3],
    ]);
  });
});
