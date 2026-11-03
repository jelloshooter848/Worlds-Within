import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '@engine/core/content/bundle';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { miniGameParamErrors, missionMiniGameUses } from '@engine/core/minigame-params';
import type { MiniGameEnd } from '@engine/core/mission-adapter';
import type { MissionDef } from '@engine/core/missions';
import { fixtureRound } from './__fixtures__/game';
import { TdBot, type TdBotStep } from './bot';
import {
  TD_DEFENCE,
  tdDefence,
  tdDefenceParams,
  towerdefenseMissionAdapter,
  type TdDefenceInput,
  type TdDefenceReport,
  type TdDefenceRound,
} from './mission-defence';

// The data-driven tower-defense mission on its own, over a hand-written plain world snapshot (the
// kit never imports the sim; tests/kits/td-mission.test.ts plays it over a real sim world). The
// round is the kit fixture's tiny map: the path bends from (0, 0) to the exit (5, 2), build cells
// (1, 1), (3, 1) and (2, 3).

/** A world snapshot's `components`, as `World.snapshot()` gives them: `[id, data]` lists. */
const SNAPSHOT: JsonObject = {
  tick: 0,
  components: {
    Position: [
      [2, { x: 0, y: 0 }],
      [3, { x: 1, y: 0 }],
      [4, { x: 2, y: 0 }],
      [5, { x: 9, y: 9 }],
      [6, { x: 9, y: 8 }],
      [7, { x: 9, y: 7 }],
      [8, { x: 9, y: 6 }],
    ],
    Owner: [
      [2, { faction: 'village' }],
      [3, { faction: 'village' }],
      [4, { faction: 'village' }],
      [5, { faction: 'raiders' }],
      [6, { faction: 'raiders' }],
      [7, { faction: 'raiders' }],
      [8, { faction: 'raiders' }],
    ],
    Building: [
      [2, { kind: 'hall', w: 2, h: 2 }],
      [3, { kind: 'wall', w: 1, h: 1 }],
      [4, { kind: 'wall', w: 1, h: 1 }],
    ],
    Stockpile: [[2, { faction: 'village' }]],
    Inventory: [[2, { gold: 50 }]],
    Health: [
      [2, { hp: 400, max: 400 }],
      [3, { hp: 80, max: 80 }],
      [4, { hp: 80, max: 80 }],
      [5, { hp: 30, max: 30 }],
      [6, { hp: 0, max: 30 }],
      [7, { hp: 25, max: 30 }],
      [8, { hp: 60, max: 60 }],
    ],
    Unit: [
      [5, { type: 'raider' }],
      [6, { type: 'raider' }],
      [7, { type: 'raider' }],
      [8, { type: 'captain' }],
    ],
    EventMember: [
      [5, { event: 'siege' }],
      [6, { event: 'siege' }],
      [7, { event: 'siege' }],
      [8, { event: 'siege' }],
    ],
    Missions: [[10, { open: [{ def: { id: 'fortify' }, refs: { gate: 4, brak: 8 } }], committed: [] }]],
  },
};

const PARAMS = {
  map: 'tiny',
  lives: 2,
  build: { select: { faction: 'village', types: ['wall'] } },
  budget: { faction: 'village', item: 'gold', cap: 40 },
  wave: [
    { kind: 'captain', select: { types: ['captain'] }, hpPer: 10, speed: 2, spacing: 6 },
    { kind: 'raider', select: { faction: 'raiders' }, hpPer: 10, speed: 4, spacing: 8, bounty: 1 },
  ],
  outcomes: [
    { outcome: 'held-cheap', when: { leaksAtMost: 0, spentAtMost: 25 } },
    { outcome: 'held', when: { leaksAtMost: 0, result: 'pass' } },
    { outcome: 'brak-slain', when: { killed: ['brak'] } },
    { outcome: 'breached' },
  ],
};

const MISSION: MissionDef = {
  id: 'fortify',
  title: 'Man the walls',
  event: 'siege',
  worldTimeCost: 10,
  play: TD_DEFENCE,
  params: PARAMS as unknown as JsonObject,
  onQuit: 'breached',
  outcomes: ['held-cheap', 'held', 'brak-slain', 'breached'].map((id) => ({
    id,
    title: id,
    weight: 1,
    effects: [],
  })),
};
const withParams = (changes: object): MissionDef => ({
  ...MISSION,
  params: { ...PARAMS, ...changes } as unknown as JsonObject,
});

const TINY = fixtureRound();
const DEF = tdDefence({ maps: [TINY.map], towers: TINY.towers });
const input = (mission = MISSION) => towerdefenseMissionAdapter.input(SNAPSHOT, mission) as TdDefenceInput;
const start = (mission = MISSION, seed = 5) =>
  DEF.create(
    { params: input(mission), attempt: 1, hostStatus: { mission: 'Man the walls' } },
    seed,
  ) as TdDefenceRound;

/** Plays a round to its end with the bot's plan (or quits on tick `quitAt`). */
function play(plan: TdBotStep[], mission = MISSION, quitAt = Infinity) {
  const round = start(mission);
  const bot = new TdBot(plan);
  const frame = new ScriptedInput({ steps: [] });
  const snapshots: string[] = [];
  for (let tick = 0; round.result() === null && tick < 5000; tick++) {
    frame.setHeld(tick === quitAt ? ['select'] : bot.next(round.game));
    frame.next();
    round.step(frame);
    snapshots.push(canonicalJson(round.snapshot()));
  }
  const end: MiniGameEnd = { result: round.result()!, report: round.report(), ticks: snapshots.length };
  return { round, end, report: round.report(), snapshots };
}

const DEFEND: TdBotStep[] = [
  { do: 'place', tower: 'cannon', col: 1, row: 1 },
  { do: 'place', tower: 'arrow', col: 3, row: 1 },
  { do: 'wave' },
];

describe('the td-defence adapter: world to round', () => {
  it('takes the walls, the capped budget, the lives and the wave in entry order from the snapshot', () => {
    expect(input()).toEqual({
      map: 'tiny',
      gold: 40,
      lives: 2,
      // The village's walls, ascending id; the hall is not a wall. 4 is named by the refs.
      walls: [
        { entity: 3, name: '3' },
        { entity: 4, name: 'gate' },
      ],
      foes: [
        // The first entry first (60 / 10 hp), then the living raiders of the event, ascending id.
        { entity: 8, name: 'brak', kind: 'captain', hp: 6, speed: 2, spacing: 6, bounty: 0 },
        { entity: 5, name: '5', kind: 'raider', hp: 3, speed: 4, spacing: 8, bounty: 1 },
        { entity: 7, name: '7', kind: 'raider', hp: 3, speed: 4, spacing: 8, bounty: 1 },
      ],
    });
  });

  it('honours fates (Engine 0.13): never a captured or dead one, the injured at their hp now', () => {
    const c = SNAPSHOT['components'] as Record<string, unknown[]>;
    const fate = (state: string) => ({ state, by: null, at: 0, held: null, history: [] });
    // By the data alone: raider 5 is captured and wall 3 "dead" though both still stand on the map;
    // the captain (8) is injured at 40 of 60 hp and comes at that hp.
    const snapshot: JsonObject = {
      ...SNAPSHOT,
      components: {
        ...(SNAPSHOT['components'] as JsonObject),
        Health: (c['Health'] ?? []).map((row) => {
          const [id, h] = row as [number, JsonObject];
          return id === 8 ? [8, { hp: 40, max: 60 }] : [id, h];
        }),
        Fate: [
          [3, fate('dead')],
          [5, fate('captured')],
          [8, fate('injured')],
        ],
      } as JsonObject,
    };
    const got = towerdefenseMissionAdapter.input(snapshot, MISSION) as TdDefenceInput;
    expect(got.walls).toEqual([{ entity: 4, name: 'gate' }]);
    expect(got.foes.map((f) => [f.name, f.hp])).toEqual([
      ['brak', 4],
      ['7', 3],
    ]);
  });

  it("leaves out what the map gives, and picks walls by key and the map's slot character", () => {
    const params = { ...PARAMS } as Record<string, unknown>;
    delete params['budget'];
    delete params['lives'];
    params['build'] = { select: { keys: ['gate'] }, slot: 'B' };
    params['timer'] = 30;
    const got = towerdefenseMissionAdapter.input(SNAPSHOT, { ...MISSION, params: params as JsonObject });
    expect(got).toMatchObject({ walls: [{ entity: 4, name: 'gate' }], slot: 'B', timer: 30 });
    expect(got).not.toHaveProperty('gold');
    expect(got).not.toHaveProperty('lives');
    expect(input(withParams({ budget: { faction: 'village', item: 'gold' } })).gold).toBe(50);
    expect(input(withParams({ budget: { faction: 'village', item: 'wood' } })).gold).toBe(0);
  });

  it('refuses what cannot make a round, naming why', () => {
    expect(() => input(withParams({ budget: { faction: 'raiders', item: 'gold' } }))).toThrow(
      `budget: no entity holds faction "raiders"'s Stockpile`,
    );
    expect(() => input(withParams({ wave: [{ kind: 'x', select: { faction: 'none' }, speed: 4 }] }))).toThrow(
      'the wave selects no world unit',
    );
    const outcomes = [{ outcome: 'held', when: { killed: ['gate'] } }, { outcome: 'breached' }];
    expect(() => input(withParams({ outcomes }))).toThrow(
      'outcomes.0.when.killed names "gate", which is not in the wave (brak, 8, 5, 7)',
    );
    expect(() => input(withParams({ map: '' }))).toThrow(/td-defence params "map"/);
    expect(() => tdDefenceParams({ ...PARAMS, outcomes: [{ outcome: 'held', when: {} }] } as never)).toThrow(
      /"outcomes.0.when": the last rule must have no `when`/,
    );
  });
});

describe('the td-defence round', () => {
  it('puts the walls on the build cells in reading order, the spare one blocked, with the budget and lives', () => {
    const round = start();
    const w = round.game.world;
    expect(w.map.map).toEqual(['S##...', '.B#B..', '..###X', '......']);
    expect([w.gold, w.lives]).toEqual([40, 2]);
    expect(round.cells).toEqual([
      { cell: '1,1', name: '3', entity: 3 },
      { cell: '3,1', name: 'gate', entity: 4 },
    ]);
    expect(w.waves.waves).toHaveLength(1);
    expect(w.waves.waves[0]!.groups.map((g) => [g.kind, g.hp, g.count])).toEqual([
      ['captain', 6, 1],
      ['raider', 3, 1],
      ['raider', 3, 1],
    ]);
  });

  it("names the map's own build cells by cell without `build`, and refuses more walls than cells", () => {
    const params = { ...PARAMS } as Record<string, unknown>;
    delete params['build'];
    const round = start({ ...MISSION, params: params as JsonObject });
    expect(round.cells.map((c) => c.name)).toEqual(['1,1', '3,1', '2,3']);
    expect(round.game.world.map.map).toEqual(TINY.map.map);
    // Every living entity with a position: six for three cells.
    const all = withParams({ build: { select: {} } });
    expect(() => start(all)).toThrow(/too few build cells: 3 more wall\(s\) \(5, 7, brak\)/);
    expect(() => DEF.create({ params: { ...input(), map: 'nowhere' }, attempt: 1 }, 1)).toThrow(
      'td-defence: no td-map "nowhere"',
    );
  });

  it('plays a held round: towers by type, gold spent, every raider killed by world name', () => {
    const { end, report } = play(DEFEND);
    expect(end.result).toBe('pass');
    expect(report).toMatchObject({
      result: 'pass',
      lives: 2,
      livesLeft: 2,
      leaked: 0,
      spent: 35,
      placed: { cannon: 1, arrow: 1 },
      towers: [
        { cell: '1,1', name: '3', type: 'cannon' },
        { cell: '3,1', name: 'gate', type: 'arrow' },
      ],
      killed: ['brak', '5', '7'],
      escaped: [],
      fallen: [],
    });
    expect(towerdefenseMissionAdapter.outcome(end, MISSION)).toEqual({
      outcome: 'held',
      stats: {
        placed: { cannon: 1, arrow: 1 },
        spent: 35,
        leaked: 0,
        livesLeft: 2,
        killed: ['brak', '5', '7'],
        escaped: [],
        fallen: [],
        ticks: end.ticks,
      },
    });
  });

  it('plays a breached round: leaks cost lives and bring down the walls nearest the exit first', () => {
    const { end, report } = play([{ do: 'wave' }]);
    expect(end.result).toBe('fail');
    expect(report).toMatchObject({ livesLeft: 0, leaked: 2, spent: 0, killed: [], escaped: ['5', '7'] });
    // The raiders overtook the slow captain. gate (3, 1) is nearer the exit (5, 2) than wall 3 (1, 1).
    expect(report.fallen).toEqual(['gate', '3']);
    expect(towerdefenseMissionAdapter.outcome(end, MISSION).outcome).toBe('breached');
  });

  it('follows the rules in the order the data gives them', () => {
    const { end } = play([{ do: 'place', tower: 'cannon', col: 1, row: 1 }, { do: 'wave' }]);
    const report = end.report as TdDefenceReport;
    // One cannon holds the tiny map: 25 gold spent, nothing leaked, every raider killed.
    expect(report).toMatchObject({ spent: 25, leaked: 0, killed: ['brak', '5', '7'] });
    const map = (m: MissionDef) => towerdefenseMissionAdapter.outcome(end, m).outcome;
    expect(map(MISSION)).toBe('held-cheap');
    expect(map(withParams({ outcomes: PARAMS.outcomes.slice(1) }))).toBe('held');
    // A killed rule (by id here) put first wins; one naming a raider not killed does not hold.
    const killedFirst = [{ outcome: 'brak-slain', when: { killed: [8] } }, ...PARAMS.outcomes];
    expect(map(withParams({ outcomes: killedFirst }))).toBe('brak-slain');
    const tooCheap = [{ outcome: 'held-cheap', when: { spentAtMost: 24 } }, { outcome: 'breached' }];
    expect(map(withParams({ outcomes: tooCheap }))).toBe('breached');
  });

  it('quits on select, which the round never sees, and sends it to onQuit', () => {
    const { round, end } = play(DEFEND, MISSION, 3);
    expect(end.result).toBe('quit');
    expect(round.game.world.tick).toBe(3);
    expect(towerdefenseMissionAdapter.outcome({ ...end, report: null }, MISSION)).toEqual({
      outcome: 'breached',
    });
  });

  it('throws on a report it cannot map', () => {
    expect(() =>
      towerdefenseMissionAdapter.outcome({ result: 'pass', report: null, ticks: 1 }, MISSION),
    ).toThrow('the round gave no report');
    expect(() =>
      towerdefenseMissionAdapter.outcome({ result: 'pass', report: { placed: [] }, ticks: 1 }, MISSION),
    ).toThrow(/is it a td-defence round/);
  });

  it('presents the round with each enemy tagged by its world name and the host status', () => {
    const round = start();
    const frame = new ScriptedInput({ steps: [{ frame: 0, hold: ['start'] }] });
    for (let i = 0; i < 12; i++) {
      frame.next();
      round.step(frame);
    }
    const shown = round.present();
    expect(shown.entities.filter((e) => e.id.startsWith('enemy-')).map((e) => e.tags.at(-1))).toEqual([
      'foe:brak',
      'foe:5',
    ]);
    expect(shown.status['host:mission']).toBe('Man the walls');
    expect(shown.events.some((e) => e.type === 'td-wave-start')).toBe(true);
    expect(round.present().events).toEqual([]);
  });

  it('gives the same snapshots from the same seed, and reading the report changes nothing', () => {
    const a = play(DEFEND);
    const b = play(DEFEND);
    expect(b.snapshots).toEqual(a.snapshots);
    expect(canonicalJson(a.round.report())).toBe(canonicalJson(b.report));
  });
});

describe('the td-defence params in validate', () => {
  const content = (params: object, outcomes = MISSION.outcomes) =>
    ({
      manifest: { kit: 'towerdefense' },
      entries: [
        {
          kind: 'mission',
          name: 'fortify',
          file: 'content/missions/fortify.mission.json',
          value: { ...MISSION, outcomes, params },
        },
      ],
    }) as unknown as ContentBundle;
  const errors = (params: object, outcomes = MISSION.outcomes) =>
    miniGameParamErrors(missionMiniGameUses(content(params, outcomes)), [DEF]).map((e) => [e.path, e.code]);

  it('accepts the params and checks the map, the slot and the outcomes', () => {
    expect(errors(PARAMS)).toEqual([]);
    expect(errors({ ...PARAMS, lives: 0 })).toEqual([['params.lives', 'too_small']]);
    expect(errors({ ...PARAMS, map: 'nowhere' })).toEqual([['params.map', 'bad_mini_game_use']]);
    expect(errors({ ...PARAMS, build: { select: {}, slot: 'Q' } })).toEqual([
      ['params.build.slot', 'bad_mini_game_use'],
    ]);
    expect(errors({ ...PARAMS, build: { select: {}, slot: '#' } })).toEqual([
      ['params.build.slot', 'bad_mini_game_use'],
    ]);
    expect(errors(PARAMS, MISSION.outcomes.slice(1))).toEqual([
      ['params.outcomes.0.outcome', 'bad_mini_game_use'],
    ]);
  });
});
