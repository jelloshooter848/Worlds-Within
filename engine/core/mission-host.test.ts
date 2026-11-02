import { describe, expect, it } from 'vitest';
import type { HeadlessGame, JsonObject } from './headless';
import { ScriptedInput } from './input/scripted-input';
import type { MiniGameEnd } from './mission-adapter';
import { MissionHost, type MissionWorldPort } from './mission-host';
import type { MiniGame, MiniGameDef } from './minigame';
import type { MissionAdapter, MissionDef, MissionResult } from './missions';

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
});
