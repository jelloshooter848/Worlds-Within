import { describe, expect, it } from 'vitest';
import type { HeadlessGame, JsonObject } from './headless';
import { ScriptedInput } from './input/scripted-input';
import type { MiniGameEnd } from './mission-adapter';
import { MissionHost, missionHostEvents, type MissionWorldPort } from './mission-host';
import type { MiniGame, MiniGameDef } from './minigame';
import type { MissionAdapter, MissionDef, MissionRecord, MissionResult } from './missions';
import type { PresentFrame } from './present/types';

// MissionHost (Engine 0.11 T5, items 172-174) over a fake port and a counting round: what it calls
// on the port, when the game steps, and what the snapshot shows. The siege fixture over the real
// sim is tests/kits/mission-host.test.ts.

const RAID: MissionDef = {
  id: 'raid',
  title: 'Burn the engines',
  worldTimeCost: 5,
  play: 'count',
  params: { target: 3 },
  onQuit: 'lost',
  outcomes: [
    { id: 'won', title: 'Won', weight: 1, effects: [] },
    { id: 'lost', title: 'Lost', weight: 1, effects: [] },
  ],
};

/** A round that passes after `target` ticks holding attack, quits on select. */
const COUNT: MiniGameDef = {
  id: 'count',
  title: 'COUNT',
  hostStatus: ['mission'],
  create(ctx): MiniGame {
    let held = 0;
    let result: 'pass' | 'quit' | null = null;
    const target = ctx.params['target'] as number;
    return {
      step(input) {
        if (input.pressed('select')) result = 'quit';
        else if (input.held('attack') && ++held >= target) result = 'pass';
      },
      snapshot: () => ({ held, host: (ctx.hostStatus?.['mission'] as string) ?? null }),
      result: () => result,
      report: () => ({ held }),
      present: (): PresentFrame => ({
        frame: held,
        size: { width: 16, height: 16 },
        entities: [],
        events: [],
        status: { held },
      }),
    };
  },
};

const ADAPTER: MissionAdapter<JsonObject, MiniGameEnd> = {
  input: (snapshot, mission) => ({
    target: (mission.params?.['target'] as number) + (snapshot['bonus'] as number),
  }),
  outcome: (end) => ({ outcome: end.result === 'pass' ? 'won' : 'lost', stats: end.report ?? {} }),
};

/** A fake world: a tick, open missions committing at open + cost, a log of port calls. */
function fakePort() {
  const log: string[] = [];
  let tick = 0;
  const open = new Map<string, number>();
  const port: MissionWorldPort = {
    open(def) {
      if (open.has(def.id)) return { ok: false, code: 'mission_open', error: 'open' };
      open.set(def.id, tick + def.worldTimeCost);
      log.push(`open ${def.id}@${tick}`);
      return { ok: true, snapshot: { bonus: 0 }, commitTick: tick + def.worldTimeCost, seed: 9 };
    },
    delegate: (id) => (log.push(`delegate ${id}@${tick}`), { ok: true }),
    play: (id, result: MissionResult) => (log.push(`play ${id} ${result.outcome}@${tick}`), { ok: true }),
    quit: (id) => (log.push(`quit ${id}@${tick}`), { ok: true }),
    settle() {
      const due = [...open].filter(([, at]) => at <= tick).map(([id]) => id);
      for (const id of due) {
        open.delete(id);
        log.push(`commit ${id}@${tick}`);
      }
      return due;
    },
    snapshot: () => ({ tick }),
    step: () => void tick++,
  };
  return { port, log, tick: () => tick };
}

function host(game?: HeadlessGame) {
  const fake = fakePort();
  const h = new MissionHost({
    ...(game ? { game } : {}),
    port: fake.port,
    missions: [RAID],
    miniGames: [COUNT],
    adapters: { count: ADAPTER },
  });
  return { h, ...fake };
}

const idle = new ScriptedInput({ steps: [] });

describe('MissionHost', () => {
  it('without a game steps the world through the port and settles after every step', () => {
    const { h, log, tick } = host();
    expect(h.mission({ mission: 'raid', action: 'open' })).toBeNull();
    expect(h.mission({ mission: 'raid', action: 'delegate' })).toBeNull();
    for (let i = 0; i < 5; i++) h.step(idle);
    expect(tick()).toBe(5);
    expect(log).toEqual(['open raid@0', 'delegate raid@0', 'commit raid@5']);
    expect(h.snapshot()).toEqual({ world: { tick: 5 } });
  });

  it('plays the round with its script while the game and world wait, then resolves it on its last tick', () => {
    let gameSteps = 0;
    const game: HeadlessGame = { step: () => void gameSteps++, snapshot: () => ({ steps: gameSteps }) };
    const { h, log } = host(game);
    h.mission({ mission: 'raid', action: 'open' });
    const script = { steps: [{ frame: 0, hold: ['attack'] }] };
    expect(h.mission({ mission: 'raid', action: 'play', input: script as unknown as JsonObject })).toBeNull();
    expect(h.miniGame()).not.toBeNull();
    h.step(idle);
    h.step(idle);
    expect(gameSteps).toBe(0);
    expect(h.snapshot()).toEqual({
      steps: 0,
      missions: {
        round: {
          mission: 'raid',
          game: 'count',
          ticks: 2,
          state: { held: 2, host: 'Burn the engines' },
          result: null,
          outcome: null,
          refused: null,
        },
      },
    });
    h.step(idle);
    expect(h.miniGame()).toBeNull();
    expect(log).toEqual(['open raid@0', 'play raid won@0']);
    expect(h.snapshot()['missions']).toMatchObject({ round: { result: 'pass', outcome: 'won' } });
    h.step(idle);
    expect(gameSteps).toBe(1);
    expect(h.snapshot()['missions']).toBeUndefined();
    expect(h.missionExperience()).toEqual([{ mission: 'raid', ticks: 3 }]);
  });

  it("reads the host's frames when the play step carries no script, and a quit round resolves to quit", () => {
    const { h, log } = host();
    h.mission({ mission: 'raid', action: 'open' });
    h.play('raid');
    const quit = new ScriptedInput({ steps: [{ frame: 1, hold: ['select'] }] });
    quit.next();
    h.step(quit);
    quit.next();
    h.step(quit);
    expect(log).toEqual(['open raid@0', 'quit raid@0']);
  });

  it('refuses steps it cannot take, naming why', () => {
    const { h } = host();
    expect(h.mission({ mission: 'raid', action: 'play' })).toMatchObject({ code: 'mission_not_open' });
    expect(h.mission({ mission: 'other', action: 'open' })).toMatchObject({ code: 'unknown_mission' });
    expect(h.mission({ mission: 'raid', action: 'commit' })).toMatchObject({ code: 'bad_step' });
    expect(h.order({ id: 1 })).toBe('the game takes no orders');
    h.launch('raid');
    expect(h.mission({ mission: 'raid', action: 'open' })).toMatchObject({ code: 'mission_open' });
    h.play('raid');
    expect(h.mission({ mission: 'raid', action: 'quit' })).toMatchObject({ code: 'round_hosted' });
    expect(h.order({ id: 1 })).toMatch(/^round_hosted/);
    for (let i = 0; i < 30 && h.miniGame() !== null; i++) h.step(idle);
  });

  it('refuses a play whose adapter throws, and starts no round', () => {
    const fake = fakePort();
    const h = new MissionHost({
      port: fake.port,
      missions: [RAID],
      miniGames: [COUNT],
      adapters: {
        count: {
          ...ADAPTER,
          input: () => {
            throw new Error('too many engines');
          },
        },
      },
    });
    h.launch('raid');
    expect(h.play('raid')).toMatchObject({
      code: 'bad_mission_input',
      error: 'mission "raid": too many engines',
    });
    expect(h.miniGame()).toBeNull();
  });

  it('refuses to play a mission with no play (a choice, Engine 0.13), and delegates it', () => {
    const { play: _play, ...choice } = { ...RAID, id: 'pay' };
    const fake = fakePort();
    const h = new MissionHost({
      port: fake.port,
      missions: [choice],
      miniGames: [COUNT],
      adapters: { count: ADAPTER },
    });
    h.launch('pay');
    expect(h.play('pay')).toMatchObject({ code: 'not_playable' });
    expect(h.miniGame()).toBeNull();
    expect(h.delegate('pay')).toBeNull();
  });

  it('gives the world event log and timeline only when its port does (Engine 0.14 T7)', () => {
    const plain = host().h;
    expect(plain.worldEvents).toBeUndefined();
    expect(plain.timeline).toBeUndefined();

    const fake = fakePort();
    const seen: unknown[] = [];
    const port: MissionWorldPort = {
      ...fake.port,
      events: (since) => ({ from: 0, tick: fake.tick(), changes: [{ since }] }),
      timeline: (experience) => (seen.push(experience), { worldTick: fake.tick() }),
    };
    const h = new MissionHost({ port, missions: [RAID], miniGames: [COUNT], adapters: { count: ADAPTER } });
    h.mission({ mission: 'raid', action: 'open' });
    h.mission({ mission: 'raid', action: 'play', input: { steps: [{ frame: 0, hold: ['attack'] }] } });
    for (let i = 0; i < 4; i++) h.step(idle);
    expect(h.worldEvents?.(3)).toEqual({ from: 0, tick: 1, changes: [{ since: 3 }] });
    expect(h.timeline?.()).toEqual({ worldTick: 1 });
    // The host's own count of the round's ticks goes to the world's timeline.
    expect(seen).toEqual([[{ mission: 'raid', ticks: 3 }]]);
    // Reading changes nothing: the snapshot is the same before and after.
    const before = JSON.stringify(h.snapshot());
    h.worldEvents?.(0);
    h.timeline?.();
    expect(JSON.stringify(h.snapshot())).toBe(before);
  });

  it("hands the adapter the world's key table and gives keys and records from the port (Engine 0.15 T7)", () => {
    const plain = host().h;
    expect(plain.worldKeys()).toEqual({});
    expect(plain.records()).toEqual([]);

    const fake = fakePort();
    const keys = { ram: 4, hall: 2 };
    const seen: unknown[] = [];
    const record: MissionRecord = {
      mission: 'raid',
      outcome: 'won',
      effects: [],
      resolution: 'played',
      openTick: 0,
      commitTick: 5,
      experienceTicks: 0,
      skipped: [],
    };
    const port: MissionWorldPort = {
      ...fake.port,
      open: (def) => {
        const opened = fake.port.open(def);
        return opened.ok ? { ...opened, keys } : opened;
      },
      keys: () => keys,
      records: () => [record],
    };
    const adapter: MissionAdapter<JsonObject, MiniGameEnd> = {
      ...ADAPTER,
      input: (snapshot, mission, given) => (seen.push(given), ADAPTER.input(snapshot, mission)),
    };
    const h = new MissionHost({ port, missions: [RAID], miniGames: [COUNT], adapters: { count: adapter } });
    expect(h.worldKeys()).toEqual(keys);
    expect(h.records()).toEqual([record]);
    expect(h.mission({ mission: 'raid', action: 'open' })).toBeNull();
    expect(h.mission({ mission: 'raid', action: 'play' })).toBeNull();
    expect(seen).toEqual([keys]);
  });

  it('records a hosted round from its frame 0 when recording is on, and the recording replays it (Engine 0.14 T9)', () => {
    const { h } = host();
    expect(h.roundRecordings()).toEqual([]);
    h.recordRounds(true);
    h.step(idle);
    h.step(idle);
    h.mission({ mission: 'raid', action: 'open' });
    h.mission({ mission: 'raid', action: 'play' });
    // The host's frames: attack held from before the round (masked until released), then
    // released, then held again for three ticks, with a stray "left" on the way.
    const live = new ScriptedInput({
      steps: [
        { frame: 0, hold: ['attack'] },
        { frame: 2, hold: [] },
        { frame: 3, hold: ['attack', 'left'] },
        { frame: 4, hold: ['attack'] },
      ],
    });
    live.next(); // attack is already down before the round's first tick
    let ticks = 0;
    while (h.miniGame() !== null) {
      live.next();
      h.step(live);
      ticks++;
      if (ticks === 2) expect(h.roundRecordings()[0]).toMatchObject({ ticks: 2, done: false });
    }
    const [rec] = h.roundRecordings();
    // The masked attack is not recorded: the round never saw it.
    expect(rec).toEqual({
      mission: 'raid',
      tick: 2,
      ticks,
      done: true,
      input: {
        steps: [
          { frame: 2, hold: ['left', 'attack'] },
          { frame: 3, hold: ['attack'] },
        ],
      },
    });
    // Played again from the recording as its play step's input: the same round, tick for tick.
    const again = host();
    again.h.step(idle);
    again.h.step(idle);
    again.h.mission({ mission: 'raid', action: 'open' });
    again.h.mission({ mission: 'raid', action: 'play', input: rec!.input as unknown as JsonObject });
    let replayed = 0;
    while (again.h.miniGame() !== null) {
      again.h.step(idle);
      replayed++;
    }
    expect(replayed).toBe(ticks);
    expect(again.log).toEqual(['open raid@2', 'play raid won@2']);
    expect(again.h.roundRecordings()).toEqual([]);
  });

  it('records nothing while recording is off', () => {
    const { h } = host();
    h.mission({ mission: 'raid', action: 'open' });
    h.mission({
      mission: 'raid',
      action: 'play',
      input: { steps: [{ frame: 0, hold: ['attack'] }] } as unknown as JsonObject,
    });
    while (h.miniGame() !== null) h.step(idle);
    expect(h.roundRecordings()).toEqual([]);
  });

  it("adds its own events after the game's, per step, a step between steps shown with the next (gap M21)", () => {
    const fake = fakePort();
    const game: HeadlessGame & { events: unknown[] } = {
      events: [{ type: 'kit-thing' }],
      step: () => fake.port.step(),
      snapshot: () => ({}),
    };
    const records: MissionRecord[] = [];
    const port: MissionWorldPort = {
      ...fake.port,
      settle() {
        const due = fake.port.settle();
        for (const mission of due)
          records.push({
            mission,
            outcome: 'won',
            effects: [],
            resolution: 'played',
            openTick: 0,
            commitTick: 5,
            experienceTicks: 3,
            skipped: [],
          });
        return due;
      },
      records: () => records,
    };
    const h = new MissionHost({
      game,
      port,
      missions: [RAID],
      miniGames: [COUNT],
      adapters: { count: ADAPTER },
    });
    expect(h.events).toEqual([{ type: 'kit-thing' }]);
    h.mission({ mission: 'raid', action: 'open' });
    h.mission({ mission: 'raid', action: 'play', input: { steps: [{ frame: 0, hold: ['attack'] }] } });
    expect(h.events).toEqual([{ type: 'kit-thing' }]);
    h.step(idle);
    expect(h.events).toEqual([
      { type: 'kit-thing' },
      { type: 'mission-open', mission: 'raid', play: 'count' },
    ]);
    h.step(idle);
    expect(h.events).toEqual([{ type: 'kit-thing' }]);
    h.step(idle);
    expect(h.events).toEqual([
      { type: 'kit-thing' },
      { type: 'mini-game-end', mission: 'raid', game: 'count', result: 'pass' },
    ]);
    const seen: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      h.step(idle);
      seen.push(...h.events);
    }
    expect(missionHostEvents(seen)).toEqual([
      { type: 'mission-commit', mission: 'raid', outcome: 'won', resolution: 'played' },
    ]);
    // Events are draw data: never in the snapshot.
    expect(JSON.stringify(h.snapshot())).not.toContain('mission-commit');
  });

  it('commits without records when the port gives none: outcome and resolution null', () => {
    const { h } = host();
    h.launch('raid');
    h.delegate('raid');
    const seen: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      h.step(idle);
      seen.push(...h.events);
    }
    expect(seen).toEqual([
      { type: 'mission-open', mission: 'raid', play: 'count' },
      { type: 'mission-commit', mission: 'raid', outcome: null, resolution: null },
    ]);
    expect(missionHostEvents([{ type: 'kit-thing' }, null, 3, ...seen])).toEqual(seen);
  });

  it("names the hosted mini game on the round's frame, and has none without a round (gap D9)", () => {
    const { h } = host();
    expect(h.roundFrame()).toBeNull();
    h.launch('raid');
    h.play('raid');
    expect(h.roundFrame()).toMatchObject({ frame: 0, status: { held: 0, miniGame: 'count' } });
    for (let i = 0; i < 30 && h.miniGame() !== null; i++) h.step(idle);
  });

  it('asks canOpen first and calls onChange after every mission step and commit (gap M18)', () => {
    const fake = fakePort();
    let offered = false;
    let changes = 0;
    const h = new MissionHost({
      port: fake.port,
      missions: [RAID],
      miniGames: [COUNT],
      adapters: { count: ADAPTER },
      canOpen: (id) =>
        offered ? null : { code: 'not_offered', error: `mission "${id}" is not offered now` },
      onChange: () => void changes++,
    });
    expect(h.mission({ mission: 'raid', action: 'open' })).toEqual({
      code: 'not_offered',
      error: 'mission "raid" is not offered now',
    });
    expect(fake.log).toEqual([]);
    expect(changes).toBe(1);
    offered = true;
    expect(h.launch('raid')).toBeNull();
    expect(h.delegate('raid')).toBeNull();
    expect(changes).toBe(3);
    for (let i = 0; i < 4; i++) h.step(idle);
    expect(changes).toBe(3);
    h.step(idle);
    expect(fake.log.at(-1)).toBe('commit raid@5');
    expect(changes).toBe(4);
  });
});
