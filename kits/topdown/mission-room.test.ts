import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { JsonObject, JsonValue } from '@engine/core/headless';
import type { MiniGameEnd } from '@engine/core/mission-adapter';
import { miniGameParamErrors, missionMiniGameUses } from '@engine/core/minigame-params';
import type { MissionDef } from '@engine/core/missions';
import type { RoomChallenge } from './challenge';
import {
  heroHpLost,
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

// ---- Engine 0.13: a round's hero taken from a world unit (M13), and fates honoured ----

const fate = (state: string) => ({ state, by: null, at: 0, held: null, history: [] });

/**
 * The snapshot above with named village people and fates: the captain (20) injured at 90 of 120 hp,
 * the sergeant (21) captured (off the map), a guard (22) dead, and a raider of the siege (8) whose
 * `Fate` says captured though it still has `Position` and `EventMember` (skipped by the data).
 */
const add = (name: string, rows: JsonValue[]): JsonValue[] => {
  const c = SNAPSHOT['components'] as Record<string, JsonValue[]>;
  return [...(c[name] ?? []), ...rows];
};
const FATES: JsonObject = {
  tick: 0,
  components: {
    ...(SNAPSHOT['components'] as JsonObject),
    Position: add('Position', [
      [8, { x: 6, y: 1 }],
      [20, { x: 7, y: 1 }],
    ]),
    Owner: add('Owner', [
      [8, { faction: 'blue' }],
      [20, { faction: 'village' }],
      [21, { faction: 'village' }],
      [22, { faction: 'village' }],
    ]),
    Health: add('Health', [
      [8, { hp: 20, max: 20 }],
      [20, { hp: 90, max: 120 }],
      [21, { hp: 30, max: 30 }],
      [22, { hp: 0, max: 30 }],
    ]),
    Unit: add('Unit', [
      [8, { type: 'raider' }],
      [20, { type: 'soldier' }],
    ]),
    Member: add('Member', [
      [20, { name: 'Hale', squad: null, role: 'captain' }],
      [21, { name: 'Mara', squad: null, role: 'hero' }],
      [22, { name: 'Tam', squad: null, role: 'regular' }],
    ]),
    EventMember: add('EventMember', [[8, { event: 'siege' }]]),
    Fate: [
      [8, fate('captured')],
      [20, fate('injured')],
      [21, fate('captured')],
      [22, fate('dead')],
    ],
    Missions: [[10, { open: [{ def: { id: 'raid' }, refs: { ram: 4, captain: 20 } }], committed: [] }]],
  },
};

const HERO = { select: { faction: 'village', member: 'captain' }, hpPer: 20 };
const heroInput = (changes: object = {}) =>
  topdownMissionAdapter.input(FATES, withParams({ hero: HERO, ...changes })) as MissionRoomInput;

describe('the mission room: a hero from a world unit (M13) and fates', () => {
  it("takes the hero's round hp from its world Health (hpPer, rounded up), an injured one at its hp now", () => {
    const got = heroInput();
    // 90 / 20 = 4.5, rounded up: 5 half hearts (the injured captain starts weaker than at 120).
    expect(got.hp).toBe(5);
    expect(got.hero).toEqual({ entity: 20, name: 'captain', worldHp: 90, hpPer: 20 });
  });

  it('never picks someone captured or dead as a foe, by their Fate, nor the hero', () => {
    // Raider 8 still has Position and the event but is captured; 5 is the only raider left.
    expect(heroInput().foes.map((f) => f.entity)).toEqual([4, 5]);
    expect(input().foes.map((f) => f.entity)).toEqual([4, 5]);
    const foes = [{ slot: 'n', kind: 'bat', select: { event: 'none', faction: 'village' } }];
    const everyone = [{ slot: 'n', kind: 'bat', select: { faction: 'village' } }];
    // The village's only standing person is the captain: as the hero, he is no foe.
    expect(() => heroInput({ foes: everyone, outcomes: [{ outcome: 'lost' }] })).not.toThrow();
    expect(heroInput({ foes: everyone, outcomes: [{ outcome: 'lost' }] }).foes).toEqual([]);
    expect(heroInput({ foes, outcomes: [{ outcome: 'lost' }] }).foes).toEqual([]);
  });

  it('refuses a hero who is captured or dead, none, or more than one', () => {
    expect(() => heroInput({ hero: { select: { member: 'hero' }, hpPer: 10 } })).toThrow(
      'the hero "21" is captured: the round cannot start',
    );
    expect(() => heroInput({ hero: { select: { member: 'regular' }, hpPer: 10 } })).toThrow(
      'the hero "22" is dead: the round cannot start',
    );
    expect(() => heroInput({ hero: { select: { faction: 'green' }, hpPer: 10 } })).toThrow(
      'hero.select picks no living world unit',
    );
    expect(() => heroInput({ hero: { select: { faction: 'blue' }, hpPer: 10 } })).toThrow(
      'hero.select picks 3 world units (ram, 5, 7); it must pick exactly one',
    );
  });

  it('plays the round with that hero and reports the world hp it cost, never the last one', () => {
    const round = DEF.create({ params: heroInput(), attempt: 1 }, 5) as RoomChallenge;
    expect(round.world.hero.hp).toBe(5);
    const report = round.report() as MissionRoomReport;
    expect(report.worldHero).toEqual({ entity: 20, name: 'captain', worldHp: 90, hpPer: 20, hpLost: 0 });
    // Through the adapter: 2 half hearts lost cost 40 world hp; 5 lost would be 100, capped at 89.
    const withHero = (lost: number): MiniGameEnd => {
      const base = end('fail', []).report as unknown as MissionRoomReport;
      const hero = { entity: 20, name: 'captain', worldHp: 90, hpPer: 20 };
      return {
        result: 'fail',
        ticks: 9,
        report: { ...base, hero: { lost }, worldHero: { ...hero, hpLost: Math.min(lost * 20, 89) } },
      } as unknown as MiniGameEnd;
    };
    const mission = withParams({ hero: HERO });
    expect(topdownMissionAdapter.outcome(withHero(2), mission).stats).toMatchObject({
      hero: 'captain',
      heroLost: 2,
      heroHpLost: 40,
    });
    expect(topdownMissionAdapter.outcome(withHero(5), mission).stats?.['heroHpLost']).toBe(89);
    const hero = { entity: 20, name: 'captain', worldHp: 90, hpPer: 20 };
    expect([0, 2, 4, 5, 9].map((lost) => heroHpLost(hero, lost))).toEqual([0, 40, 80, 89, 89]);
    expect(heroHpLost({ ...hero, worldHp: 1 }, 3)).toBe(0);
    // Without a world hero the stats are as before.
    expect(topdownMissionAdapter.outcome(end('fail', []), MISSION).stats).not.toHaveProperty('heroHpLost');
  });

  it('validate: hero with hp, an empty hero selector, and heroHpLost damage without a hero', () => {
    const mission = (
      params: object,
      effects: MissionDef['outcomes'][number]['effects'] = [],
    ): MissionDef => ({
      ...withParams(params),
      outcomes: ['burnt', 'some', 'scorched', 'lost'].map((id) => ({ id, title: id, weight: 1, effects })),
    });
    const content = (m: MissionDef) =>
      ({
        manifest: {},
        entries: [{ kind: 'mission', name: 'raid', file: 'content/raid.mission.json', value: m }],
      }) as unknown as ContentBundle;
    const errors = (m: MissionDef) =>
      miniGameParamErrors(missionMiniGameUses(content(m)), [DEF]).map((e) => ({
        path: e.path,
        code: e.code,
      }));
    const damage = (fromReport: string) => ({
      type: 'damage' as const,
      entity: 'captain',
      amount: 30,
      fromReport,
    });
    expect(errors(mission({ hero: HERO }, [damage('heroHpLost')]))).toEqual([]);
    expect(errors(mission({ hero: HERO, hp: 6 }))).toEqual([{ path: 'params.hp', code: 'custom' }]);
    expect(errors(mission({ hero: { select: {}, hpPer: 20 } }))).toEqual([
      { path: 'params.hero.select', code: 'custom' },
    ]);
    expect(errors(mission({ hero: { select: { member: 'captain' } } }))).toEqual([
      { path: 'params.hero.hpPer', code: 'invalid_type' },
    ]);
    expect(errors(mission({}, [damage('heroHpLost')]))).toEqual(
      Array(4).fill({ path: 'params.hero', code: 'bad_mini_game_use' }),
    );
    expect(errors(mission({ hero: HERO }, [damage('gold')]))[0]).toEqual({
      path: 'params',
      code: 'bad_mini_game_use',
    });
  });
});
