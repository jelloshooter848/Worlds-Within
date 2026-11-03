import { describe, expect, it } from 'vitest';
import type { JsonObject } from './headless';
import { ScriptedInput } from './input/scripted-input';
import { fateState, isLost, playMissionRound, snapshotEntities, type MiniGameEnd } from './mission-adapter';
import type { Action } from './input/actions';
import type { MiniGame, MiniGameInputMap, MiniGameResult } from './minigame';
import { parseMission, type MissionAdapter, type MissionDef } from './missions';

const parsed = parseMission({
  id: 'raid',
  title: 'Raid',
  worldTimeCost: 5,
  play: 'count',
  onQuit: 'off',
  playable: ['won', 'off'],
  outcomes: [
    { id: 'won', title: 'Won' },
    { id: 'off', title: 'Driven off' },
    { id: 'lucky', title: 'Only by luck' },
  ],
});
if (!parsed.ok) throw new Error(parsed.error);
const MISSION: MissionDef = parsed.mission;

const SNAPSHOT: JsonObject = {
  tick: 0,
  entities: [1, 2, 3],
  components: {
    Health: [
      [2, { hp: 5, max: 5 }],
      [3, { hp: 1, max: 5 }],
    ],
    Owner: [
      [3, { faction: 'blue' }],
      [1, { faction: 'red' }],
    ],
  },
};

/** A tiny round: ends after `n` ticks with `result`, reporting its ticks (or no report). */
function counter(n: number, result: MiniGameResult, withReport = true): MiniGame {
  let ticks = 0;
  const game: MiniGame = {
    step: () => void ticks++,
    snapshot: () => ({ ticks }),
    result: () => (ticks >= n ? result : null),
  };
  if (withReport) game.report = () => ({ ticks, result });
  return game;
}

/** Input: how many foes (entities with Health) there are; outcome: by the round's result. */
const ADAPTER: MissionAdapter<{ foes: number }, MiniGameEnd> = {
  input: (snapshot) => ({ foes: snapshotEntities(snapshot, 'Health').length }),
  outcome: (end, mission) => {
    if (end.report === null) throw new Error('no report');
    if (end.result === 'quit') return { outcome: mission.onQuit };
    return { outcome: end.result === 'pass' ? 'won' : 'lucky', stats: { ticks: end.ticks } };
  },
};

const input = new ScriptedInput({ steps: [] });
const step = () => {
  input.next();
  return input;
};

describe('snapshotEntities', () => {
  it('lists the entities having every named component, ascending, with all their components', () => {
    expect(snapshotEntities(SNAPSHOT, 'Health')).toEqual([
      { id: 2, components: { Health: { hp: 5, max: 5 } } },
      { id: 3, components: { Health: { hp: 1, max: 5 }, Owner: { faction: 'blue' } } },
    ]);
    expect(snapshotEntities(SNAPSHOT, 'Health', 'Owner').map((e) => e.id)).toEqual([3]);
    expect(snapshotEntities(SNAPSHOT).map((e) => e.id)).toEqual([1, 2, 3]);
    expect(snapshotEntities(SNAPSHOT, 'Missing')).toEqual([]);
  });

  it('throws on a snapshot that is not a world snapshot', () => {
    expect(() => snapshotEntities({ frame: 1 })).toThrow(/no "components"/);
    expect(() => snapshotEntities({ components: { Health: [[1]] } })).toThrow(/\[id, data\]/);
  });
});

describe('fateState and isLost (Engine 0.13)', () => {
  const e = (Fate?: unknown) => ({ id: 3, components: Fate === undefined ? {} : { Fate: Fate as never } });
  it('reads a Fate, active without one, and says who is lost to every mode', () => {
    expect(fateState(e())).toBe('active');
    expect(['injured', 'captured', 'freed', 'dead'].map((state) => fateState(e({ state })))).toEqual([
      'injured',
      'captured',
      'freed',
      'dead',
    ]);
    expect(['injured', 'captured', 'freed', 'dead'].map((state) => isLost(e({ state })))).toEqual([
      false,
      true,
      false,
      true,
    ]);
    expect(isLost(e())).toBe(false);
    expect(() => fateState(e({ state: 'missing' }))).toThrow(
      'entity 3\'s Fate has no known state ("missing")',
    );
  });
});

describe('playMissionRound', () => {
  it("plays the round from the adapter's input and maps its end to a declared outcome", () => {
    let foes = -1;
    const played = playMissionRound({
      mission: MISSION,
      snapshot: SNAPSHOT,
      adapter: ADAPTER,
      start: (kit) => {
        foes = kit.foes;
        return counter(4, 'pass');
      },
      input: step,
    });
    expect(foes).toBe(2);
    expect(played).toMatchObject({
      ok: true,
      end: { result: 'pass', ticks: 4, report: { ticks: 4, result: 'pass' } },
      result: {
        mission: 'raid',
        outcome: 'won',
        effects: [],
        report: { outcome: 'won', stats: { ticks: 4 } },
      },
    });
  });

  it('maps a quit to the onQuit outcome', () => {
    const played = playMissionRound({
      mission: MISSION,
      snapshot: SNAPSHOT,
      adapter: ADAPTER,
      start: () => counter(1, 'quit'),
      input: step,
    });
    expect(played).toMatchObject({ ok: true, quit: true, result: { outcome: 'off' } });
    expect(played.ok && played.result.report).toBeUndefined();
  });

  it('takes a quit to onQuit even when onQuit is not playable, without the adapter', () => {
    const mission: MissionDef = { ...MISSION, playable: ['won'] };
    const played = playMissionRound({
      mission,
      snapshot: SNAPSHOT,
      adapter: {
        ...ADAPTER,
        outcome: () => {
          throw new Error('the adapter maps no quit');
        },
      },
      start: () => counter(1, 'quit', false),
      input: step,
    });
    expect(played).toMatchObject({ ok: true, quit: true, result: { outcome: 'off', effects: [] } });
  });

  it('marks a played round as not quit', () => {
    const played = playMissionRound({
      mission: MISSION,
      snapshot: SNAPSHOT,
      adapter: ADAPTER,
      start: () => counter(1, 'pass'),
      input: step,
    });
    expect(played.ok && played.quit).toBe(false);
  });

  it('refuses an outcome outside the playable space', () => {
    const played = playMissionRound({
      mission: MISSION,
      snapshot: SNAPSHOT,
      adapter: ADAPTER,
      start: () => counter(2, 'fail'),
      input: step,
    });
    expect(played).toMatchObject({ ok: false, code: 'unknown_outcome', end: { result: 'fail' } });
    expect(!played.ok && played.error).toMatch(/no playable outcome "lucky"/);
  });

  it('refuses a report the adapter cannot map', () => {
    const played = playMissionRound({
      mission: MISSION,
      snapshot: SNAPSHOT,
      adapter: ADAPTER,
      start: () => counter(2, 'pass', false),
      input: step,
    });
    expect(played).toMatchObject({ ok: false, code: 'unmappable_report', end: { report: null } });
    expect(!played.ok && played.error).toBe('mission "raid": no report');
  });

  it('drops a button held into the round and applies the input map (gap G18)', () => {
    /** Passes on a press of attack, fails on left held. */
    const pressRound = (): MiniGame => {
      let result: MiniGameResult | null = null;
      return {
        step: (i) => {
          if (i.held('left')) result = 'fail';
          else if (i.pressed('attack')) result = 'pass';
        },
        snapshot: () => ({}),
        result: () => result,
        report: () => ({ result }),
      };
    };
    // The caller's input was already holding left and attack when the round started.
    const host = new ScriptedInput({ steps: [] });
    host.setHeld(['left', 'attack']);
    host.next();
    const holds: Action[][] = [['left', 'attack'], ['left'], ['left', 'attack']];
    const play = (inputMap?: MiniGameInputMap) =>
      playMissionRound({
        mission: MISSION,
        snapshot: SNAPSHOT,
        adapter: ADAPTER,
        start: pressRound,
        input: (tick) => {
          host.setHeld(holds[Math.min(tick, holds.length - 1)]!);
          host.next();
          return host;
        },
        maxTicks: 50,
        ...(inputMap ? { inputMap } : {}),
      });
    // Left and attack held into the round do nothing; attack pressed again on tick 2 passes it.
    expect(play()).toMatchObject({ ok: true, end: { result: 'pass', ticks: 3 } });
    // With the host's attack mapped to nothing and jump to attack, nothing ever presses it.
    host.setHeld(['left', 'attack']);
    host.next();
    expect(play({ attack: null, jump: 'attack' })).toMatchObject({ ok: false, code: 'unfinished' });
  });

  it("applies the input map to a script's frames", () => {
    let attacks = 0;
    const played = playMissionRound({
      mission: MISSION,
      snapshot: SNAPSHOT,
      adapter: ADAPTER,
      inputMap: { jump: 'attack' },
      start: () => {
        const round = counter(3, 'pass');
        return {
          ...round,
          step: (i) => {
            if (i.held('attack')) attacks++;
            round.step(i);
          },
        };
      },
      input: (() => {
        const script = new ScriptedInput({ steps: [{ frame: 0, hold: ['jump'] }] });
        return () => {
          script.next();
          return script;
        };
      })(),
    });
    expect(played.ok).toBe(true);
    expect(attacks).toBe(3);
  });

  it('refuses a round that does not end within maxTicks', () => {
    const played = playMissionRound({
      mission: MISSION,
      snapshot: SNAPSHOT,
      adapter: ADAPTER,
      start: () => counter(50, 'pass'),
      input: step,
      maxTicks: 10,
    });
    expect(played).toMatchObject({ ok: false, code: 'unfinished', end: null });
    expect(played.round.snapshot()).toEqual({ ticks: 10 });
  });
});
