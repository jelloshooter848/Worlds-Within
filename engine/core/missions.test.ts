import { describe, expect, it } from 'vitest';
import { validate } from './content/validate';
import type { JsonObject } from './headless';
import {
  MISSION_EFFECT_TYPES,
  missionResult,
  missionSchema,
  parseMission,
  pickOutcome,
  playedResult,
  totalWeight,
  type MissionAdapter,
  type MissionDef,
} from './missions';

const RAID = {
  id: 'raid',
  title: 'Burn the siege engines',
  event: 'siege',
  worldTimeCost: 30,
  play: 'sabotage',
  params: { engines: 3 },
  onQuit: 'repelled',
  outcomes: [
    {
      id: 'clean',
      title: 'All burnt',
      weight: 1,
      effects: [
        { type: 'destroy', entity: 'ram' },
        { type: 'damage', entity: 7, amount: 5 },
      ],
    },
    {
      id: 'partial',
      title: 'Two of three',
      weight: 2,
      effects: [
        { type: 'inventory', entity: 'camp', item: 'oil', add: -2 },
        { type: 'set', entity: 'tower', component: 'Health', values: { hp: 1 } },
      ],
    },
    { id: 'repelled', title: 'Driven off', effects: [{ type: 'opportunity', open: 'rescue' }] },
  ],
};

const mission = (): MissionDef => missionSchema.parse(RAID);

function errorsOf(data: unknown) {
  return validate('raid.mission.json', data, missionSchema).errors.map((e) => ({
    path: e.path,
    code: e.code,
  }));
}

describe('missions', () => {
  it('accepts a valid mission as plain JSON, with defaults filled in', () => {
    const result = parseMission(RAID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mission.outcomes[2]).toEqual({
      id: 'repelled',
      title: 'Driven off',
      weight: 1,
      effects: [{ type: 'opportunity', open: 'rescue' }],
    });
    expect(JSON.parse(JSON.stringify(result.mission))).toEqual(result.mission);
    expect(totalWeight(result.mission)).toBe(4);
    expect(MISSION_EFFECT_TYPES).toEqual(['damage', 'destroy', 'inventory', 'set', 'opportunity', 'fate']);
    const minimal = {
      id: 'm',
      title: 'M',
      worldTimeCost: 1,
      play: 'g',
      onQuit: 'a',
      outcomes: [{ id: 'a', title: 'A' }],
    };
    expect(parseMission(minimal).ok).toBe(true);
  });

  it('takes fate effects (Engine 0.13): "at" exactly on "freed", a known fate, a faction id', () => {
    const withEffects = (effects: unknown[]) => ({
      ...RAID,
      outcomes: [{ ...RAID.outcomes[0], effects }, RAID.outcomes[1], RAID.outcomes[2]],
    });
    const good = [
      { type: 'fate', entity: 'captain', fate: 'captured', by: 'raiders' },
      { type: 'fate', entity: 7, fate: 'injured' },
      { type: 'fate', entity: 'captain', fate: 'freed', at: { x: 1, y: 2 } },
      { type: 'fate', entity: 'captain', fate: 'dead' },
    ];
    expect(errorsOf(withEffects(good))).toEqual([]);
    const bad = [
      { type: 'fate', entity: 'captain', fate: 'freed' },
      { type: 'fate', entity: 'captain', fate: 'dead', at: { x: 1, y: 2 } },
      { type: 'fate', entity: 'captain', fate: 'active' },
      { type: 'fate', entity: 'captain', fate: 'captured', by: '9th' },
      { type: 'fate', entity: 0, fate: 'dead' },
      { type: 'fate', entity: 'captain', fate: 'freed', at: { x: 1.5, y: 2 } },
    ];
    expect(errorsOf(withEffects(bad)).map((e) => e.path)).toEqual([
      'outcomes.0.effects.0.at',
      'outcomes.0.effects.1.at',
      'outcomes.0.effects.2.fate',
      'outcomes.0.effects.3.by',
      'outcomes.0.effects.4.entity',
      'outcomes.0.effects.5.at.x',
    ]);
    expect(errorsOf(withEffects(bad))[0]!.code).toBe('bad_effect');
  });

  it('takes a damage amount from a played report stat with "fromReport" (Engine 0.13, M13)', () => {
    const withEffects = (effects: unknown[]) => ({
      ...RAID,
      outcomes: [{ ...RAID.outcomes[0], effects }, RAID.outcomes[1], RAID.outcomes[2]],
    });
    const damage = { type: 'damage', entity: 'captain', amount: 30 };
    expect(errorsOf(withEffects([{ ...damage, fromReport: 'heroHpLost' }]))).toEqual([]);
    expect(
      errorsOf(
        withEffects([
          { ...damage, fromReport: '' },
          { type: 'damage', entity: 'captain', fromReport: 'x' },
        ]),
      ).map((e) => e.path),
    ).toEqual(['outcomes.0.effects.0.fromReport', 'outcomes.0.effects.1.amount']);
  });

  it('makes "play" optional: a mission without it is a choice, only delegated (Engine 0.13)', () => {
    const { play: _play, params: _params, ...choice } = RAID;
    expect(parseMission(choice).ok).toBe(true);
  });

  it('rejects a mission with no outcomes', () => {
    expect(errorsOf({ ...RAID, outcomes: [], onQuit: 'x' })).toContainEqual({
      path: 'outcomes',
      code: 'too_small',
    });
  });

  it('rejects duplicate outcome ids, at the second one', () => {
    const outcomes = [RAID.outcomes[0], { ...RAID.outcomes[1], id: 'clean' }, RAID.outcomes[2]];
    expect(errorsOf({ ...RAID, outcomes })).toEqual([{ path: 'outcomes.1.id', code: 'duplicate_outcome' }]);
  });

  it('rejects a negative, zero or non-integer worldTimeCost', () => {
    for (const worldTimeCost of [-3, 0, 2.5, '30'])
      expect(errorsOf({ ...RAID, worldTimeCost }).map((e) => e.path)).toEqual(['worldTimeCost']);
    expect(errorsOf({ ...RAID, worldTimeCost: undefined }).map((e) => e.path)).toEqual(['worldTimeCost']);
  });

  it('names each other bad field', () => {
    expect(errorsOf({ ...RAID, onQuit: 'nope' })).toEqual([{ path: 'onQuit', code: 'unknown_outcome' }]);
    expect(errorsOf({ ...RAID, playable: ['clean', 'gone', 'clean'] })).toEqual([
      { path: 'playable.1', code: 'unknown_outcome' },
      { path: 'playable.2', code: 'duplicate_outcome' },
    ]);
    expect(errorsOf({ ...RAID, attempt: 2 })).toEqual([{ path: 'attempt', code: 'unrecognized_keys' }]);
    const bad = structuredClone(RAID) as { outcomes: { weight?: number; effects: unknown[] }[] };
    bad.outcomes[0]!.weight = 0;
    bad.outcomes[1]!.effects = [{ type: 'inventory', entity: 'camp', item: 'oil', add: 0 }];
    bad.outcomes[2]!.effects = [{ type: 'opportunity', open: 'a', close: 'b' }, { type: 'teleport' }];
    expect(errorsOf(bad).map((e) => e.path)).toEqual([
      'outcomes.0.weight',
      'outcomes.1.effects.0.add',
      'outcomes.2.effects.0',
      'outcomes.2.effects.1.type',
    ]);
    expect(errorsOf(bad)[2]!.code).toBe('bad_effect');
    const lines = parseMission({ ...RAID, id: 'Raid', worldTimeCost: 0 });
    expect(lines.ok).toBe(false);
    if (!lines.ok)
      expect(lines.error.split('\n').map((l) => l.split(':')[0])).toEqual(['id', 'worldTimeCost']);
  });

  it('walks the weights in file order for a delegation draw', () => {
    const m = mission();
    expect([0, 1, 2, 3].map((n) => pickOutcome(m, n).id)).toEqual([
      'clean',
      'partial',
      'partial',
      'repelled',
    ]);
    expect(() => pickOutcome(m, 4)).toThrow(/total weight 4/);
    expect(() => pickOutcome(m, -1)).toThrow();
  });

  it('gives a structured result only for a declared (and playable) outcome', () => {
    const m = mission();
    expect(missionResult(m, 'partial')).toEqual({
      ok: true,
      result: { mission: 'raid', outcome: 'partial', effects: m.outcomes[1]!.effects },
    });
    expect(missionResult(m, 'won')).toMatchObject({ ok: false, code: 'unknown_outcome' });
    const narrow = { ...m, playable: ['partial', 'repelled'] };
    expect(missionResult(narrow, 'clean', { outcome: 'clean' }).ok).toBe(false);
    expect(missionResult(narrow, 'clean').ok).toBe(true);
  });

  it('turns a kit report into a result through an adapter', () => {
    const adapter: MissionAdapter<{ engines: number }, { burnt: number }> = {
      input: (_snapshot: JsonObject, def) => ({ engines: Number(def.params?.['engines'] ?? 0) }),
      outcome: (report) => ({
        outcome: report.burnt >= 3 ? 'clean' : report.burnt > 0 ? 'partial' : 'repelled',
        stats: { burnt: report.burnt },
      }),
    };
    const m = mission();
    expect(adapter.input({ tick: 3 }, m)).toEqual({ engines: 3 });
    const played = playedResult(adapter, m, { burnt: 2 });
    expect(played).toEqual({
      ok: true,
      result: {
        mission: 'raid',
        outcome: 'partial',
        effects: m.outcomes[1]!.effects,
        report: { outcome: 'partial', stats: { burnt: 2 } },
      },
    });
  });
});
