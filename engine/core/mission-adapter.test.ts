import { describe, expect, it } from 'vitest';
import type { JsonObject } from './headless';
import { ScriptedInput } from './input/scripted-input';
import { playMissionRound, snapshotEntities, type MiniGameEnd } from './mission-adapter';
import type { MiniGame, MiniGameResult } from './minigame';
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
    expect(played.ok && played.result.outcome).toBe('off');
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
