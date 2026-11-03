import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { JsonObject } from '@engine/core/headless';
import type { MiniGameEnd } from '@engine/core/mission-adapter';
import { miniGameParamErrors, missionMiniGameUses } from '@engine/core/minigame-params';
import type { MissionDef } from '@engine/core/missions';
import type { RoomChallenge } from './challenge';
import {
  MISSION_ROOM,
  missionRoom,
  missionRoomParams,
  topdownMissionAdapter,
  type MissionRoomInput,
  type MissionRoomReport,
} from './mission-room';
import { tileAt, type RoomDef } from './room';

// The data-driven mission room on its own, over a hand-written plain world snapshot (the kit
// never imports the sim; tests/kits/mission-adapter.test.ts plays it over the real siege world).

/** A world snapshot's `components`, as `World.snapshot()` gives them: `[id, data]` lists. */
const SNAPSHOT: JsonObject = {
  tick: 0,
  components: {
    Position: [
      [3, { x: 1, y: 1 }],
      [4, { x: 2, y: 1 }],
      [5, { x: 3, y: 1 }],
      [6, { x: 4, y: 1 }],
      [7, { x: 5, y: 1 }],
    ],
    Owner: [
      [3, { faction: 'red' }],
      [4, { faction: 'blue' }],
      [5, { faction: 'blue' }],
      [6, { faction: 'blue' }],
      [7, { faction: 'blue' }],
    ],
    Health: [
      [3, { hp: 30, max: 30 }],
      [4, { hp: 40, max: 40 }],
      [5, { hp: 9, max: 20 }],
      [6, { hp: 0, max: 20 }],
      [7, { hp: 20, max: 20 }],
    ],
    Unit: [
      [3, { type: 'soldier' }],
      [4, { type: 'engine' }],
      [5, { type: 'raider' }],
      [6, { type: 'raider' }],
      [7, { type: 'raider' }],
    ],
    Member: [[7, { name: 'Brak', squad: 9, role: 'captain' }]],
    EventMember: [
      [3, { event: 'siege' }],
      [4, { event: 'siege' }],
      [5, { event: 'siege' }],
      [6, { event: 'siege' }],
      [7, { event: 'camp' }],
    ],
    Missions: [[10, { open: [{ def: { id: 'raid' }, refs: { ram: 4 } }], committed: [] }]],
  },
};

const ROOM: RoomDef = {
  id: 'camp',
  at: [0, 0],
  map: [
    '################',
    '#..............#',
    '#..E....n....n.#',
    '#..............#',
    '#..E...........#',
    '#..............#',
    '#..............#',
    '#..............#',
    '#......@.......#',
    '#..............#',
    '################',
  ],
};

const PARAMS = {
  room: 'camp',
  goal: 'defeat-all',
  ticks: 300,
  foes: [
    { slot: 'E', kind: 'knight', select: { faction: 'blue', types: ['engine'] }, hpPer: 10 },
    { slot: 'n', kind: 'bat', select: { faction: 'blue' } },
  ],
  outcomes: [
    { outcome: 'burnt', when: { destroyed: ['ram'], result: 'pass' } },
    { outcome: 'some', when: { minDestroyed: 1, spared: ['ram'] } },
    { outcome: 'scorched', when: { minDestroyed: 1 } },
    { outcome: 'lost' },
  ],
};

const MISSION: MissionDef = {
  id: 'raid',
  title: 'Raid',
  event: 'siege',
  worldTimeCost: 10,
  play: MISSION_ROOM,
  params: PARAMS as unknown as JsonObject,
  onQuit: 'lost',
  outcomes: ['burnt', 'some', 'scorched', 'lost'].map((id) => ({ id, title: id, weight: 1, effects: [] })),
};
const withParams = (changes: object): MissionDef => ({
  ...MISSION,
  params: { ...PARAMS, ...changes } as unknown as JsonObject,
});

const DEF = missionRoom({ rooms: [ROOM] });
const input = (mission = MISSION) => topdownMissionAdapter.input(SNAPSHOT, mission) as MissionRoomInput;

/** A round's end as the adapter reads it: these room cells defeated, those hurt. */
function end(result: MiniGameEnd['result'], defeated: string[], hurt: string[] = []): MiniGameEnd {
  const report = {
    defeated,
    hurt,
    hero: { lost: 2 },
    placed: [
      { cell: '3,2', entity: 4, name: 'ram' },
      { cell: '8,2', entity: 5, name: '5' },
    ],
  } as unknown as MissionRoomReport;
  return { result, report, ticks: 77 };
}

describe('the mission room adapter: world to room', () => {
  it("picks the mission event's living entities each entry selects, ascending id, first entry first", () => {
    expect(input()).toEqual({
      room: 'camp',
      goal: 'defeat-all',
      ticks: 300,
      slots: ['E', 'n'],
      foes: [
        // The engine, named by the open mission's refs, at 40 / 10 hp.
        { slot: 'E', kind: 'knight', entity: 4, name: 'ram', hp: 4 },
        // A raider of the event (6 is dead, 7 is in another event), named by its id.
        { slot: 'n', kind: 'bat', entity: 5, name: '5' },
      ],
    });
  });

  it('selects by another event and by squad role, and rounds world hp up', () => {
    const foes = [{ slot: 'n', kind: 'knight', select: { event: 'camp', member: 'captain' }, hpPer: 7 }];
    const outcomes = [{ outcome: 'lost' }];
    expect(input(withParams({ foes, outcomes })).foes).toEqual([
      { slot: 'n', kind: 'knight', entity: 7, name: '7', hp: 3 },
    ]);
  });

  it('refuses a rule naming a world entity that is not one of the foes', () => {
    const outcomes = [{ outcome: 'burnt', when: { destroyed: ['tower'] } }, { outcome: 'lost' }];
    expect(() => input(withParams({ outcomes }))).toThrow(
      'outcomes.0.when.destroyed names "tower", which is not one of the round\'s foes (ram, 4, 5)',
    );
  });

  it('refuses malformed params naming the field', () => {
    expect(() => input(withParams({ goal: 'win' }))).toThrow(/mission-room params "goal"/);
    expect(() =>
      missionRoomParams({ ...PARAMS, outcomes: [{ outcome: 'lost', when: {} }] } as never),
    ).toThrow(/"outcomes.0.when": the last rule must have no `when`/);
  });
});

describe('the mission room adapter: report to outcome', () => {
  const outcome = (e: MiniGameEnd) => topdownMissionAdapter.outcome(e, MISSION);

  it('takes the first rule that holds, with what was destroyed and who was hurt', () => {
    expect(outcome(end('pass', ['3,2', '8,2']))).toEqual({
      outcome: 'burnt',
      stats: { destroyed: ['ram', '5'], hurt: [], heroLost: 2, ticks: 77 },
    });
    // The ram destroyed but the round failed: `burnt` needs a pass; `some` needs the ram spared.
    expect(outcome(end('fail', ['3,2'])).outcome).toBe('scorched');
    expect(outcome(end('fail', ['8,2'], ['3,2']))).toMatchObject({
      outcome: 'some',
      stats: { destroyed: ['5'], hurt: ['ram'] },
    });
    expect(outcome(end('fail', [])).outcome).toBe('lost');
  });

  it('names an entity by its id in a rule too', () => {
    const outcomes = [{ outcome: 'burnt', when: { destroyed: [4] } }, { outcome: 'lost' }];
    expect(topdownMissionAdapter.outcome(end('fail', ['3,2']), withParams({ outcomes })).outcome).toBe(
      'burnt',
    );
  });

  it('sends a quit to onQuit without the rules', () => {
    expect(outcome({ result: 'quit', report: null, ticks: 3 })).toEqual({ outcome: 'lost' });
  });

  it('throws on a report it cannot map', () => {
    expect(() => outcome({ result: 'pass', report: null, ticks: 3 })).toThrow('the round gave no report');
    expect(() => outcome(end('pass', ['1,1']))).toThrow(
      'the report names "1,1", which is no entity of the world',
    );
  });
});

describe('the mission room round', () => {
  it("places the foes in their slots' cells in reading order, spare slots as floor, at world hp", () => {
    const round = DEF.create({ params: input(), attempt: 1 }, 5) as RoomChallenge;
    expect(round.world.enemies().map((e) => [e.kind, e.key, e.hp])).toEqual([
      ['knight', '3,2', 4],
      ['bat', '8,2', 1],
    ]);
    // The spare E cell (3,4) and n cell (13,2) are floor.
    expect([tileAt(round.world.room, 3, 4), tileAt(round.world.room, 13, 2)]).toEqual(['floor', 'floor']);
    expect(round.world.room.def.map[2]).toBe('#..n....b......#');
    const report = round.report() as MissionRoomReport;
    expect(report.placed).toEqual([
      { cell: '3,2', entity: 4, name: 'ram' },
      { cell: '8,2', entity: 5, name: '5' },
    ]);
    expect(report.foes.map((f) => f.startHp)).toEqual([4, 1]);
    // Its frames tag each placed foe with its world name, for a skin's look by tag.
    const foes = round.present().entities.filter((e) => e.tags.some((t) => t.startsWith('foe:')));
    expect(foes.map((e) => [e.kind, e.tags])).toEqual([
      ['knight', ['foe:ram']],
      ['bat', ['foe:5']],
    ]);
    expect(DEF).toMatchObject({ id: 'mission-room', title: 'MISSION', hostStatus: ['mission'] });
  });

  it('refuses a round with more foes than slot cells, an unknown room or a kind no character spawns', () => {
    const many = {
      ...input(),
      foes: [
        ...input().foes,
        { slot: 'E', kind: 'knight', entity: 9, name: '9' },
        { slot: 'E', kind: 'knight', entity: 8, name: '8' },
      ],
    };
    expect(() => DEF.create({ params: many, attempt: 1 }, 5)).toThrow(
      'room "camp" has too few "E" cells: 1 more foe(s) (8)',
    );
    expect(() => DEF.create({ params: { ...input(), room: 'cellar' }, attempt: 1 }, 5)).toThrow(
      'mission room: no room "cellar"',
    );
    const dragon = { ...input(), foes: [{ slot: 'E', kind: 'dragon', entity: 4, name: 'ram' }] };
    expect(() => DEF.create({ params: dragon, attempt: 1 }, 5)).toThrow(
      'no legend character spawns "dragon"',
    );
    expect(() => DEF.create({ params: PARAMS as unknown as JsonObject, attempt: 1 }, 5)).toThrow(
      /mission room: input/,
    );
  });
});

describe('validate checks a mission room mission (G16)', () => {
  /** The errors `validate` reports for a game with this mission and the room `camp`. */
  function errors(mission: MissionDef) {
    const content = {
      manifest: {},
      entries: [{ kind: 'mission', name: 'raid', file: 'content/raid.mission.json', value: mission }],
    } as unknown as ContentBundle;
    return miniGameParamErrors(missionMiniGameUses(content), [DEF]).map((e) => ({
      path: e.path,
      code: e.code,
    }));
  }

  it('passes good params', () => {
    expect(errors(MISSION)).toEqual([]);
  });

  it('rejects malformed params at their fields', () => {
    expect(
      errors(
        withParams({
          goal: 'win',
          foes: [{ slot: 'EE', kind: 'knight', select: { team: 'blue' } }],
          outcomes: [{ outcome: 'lost' }, { outcome: 'burnt', when: { minDestroyed: -1 } }],
          lives: 3,
        }),
      ),
    ).toEqual([
      { path: 'params.goal', code: 'invalid_value' },
      { path: 'params.foes.0.slot', code: 'too_big' },
      { path: 'params.foes.0.select.team', code: 'unrecognized_keys' },
      { path: 'params.outcomes.1.when.minDestroyed', code: 'too_small' },
      { path: 'params.lives', code: 'unrecognized_keys' },
    ]);
    expect(errors(withParams({ outcomes: [{ outcome: 'lost' }, { outcome: 'some' }] }))).toEqual([
      { path: 'params.outcomes.0', code: 'custom' },
    ]);
    expect(errors(withParams({ foes: [] }))).toEqual([{ path: 'params.foes', code: 'too_small' }]);
  });

  it('rejects an unknown room, a slot the room lacks and an outcome the mission does not declare', () => {
    expect(errors(withParams({ room: 'cellar' }))).toEqual([
      { path: 'params.room', code: 'bad_mini_game_use' },
    ]);
    expect(
      errors(
        withParams({
          foes: [{ slot: 'Z', kind: 'knight' }],
          outcomes: [{ outcome: 'won', when: { minDestroyed: 1 } }, { outcome: 'lost' }],
        }),
      ),
    ).toEqual([
      { path: 'params.foes.0.slot', code: 'bad_mini_game_use' },
      { path: 'params.outcomes.0.outcome', code: 'bad_mini_game_use' },
    ]);
  });
});
