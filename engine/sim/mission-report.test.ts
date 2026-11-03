import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMission, type MissionDef, type MissionEffect } from '../core/missions';
import { Health, Inventory } from './components';
import { commitMission, delegateMission, missionsOf, openMission, playMission, quitMission } from './mission';
import { scenarioKeys, worldFromScenario } from './scenario';
import type { Entity, World } from './world';

// Report-driven effects (Engine 0.15 T8, lessons D3 and D4; docs/BUILD-LOG.md, Engine 0.15,
// decision 9, item 286), over the captive fixture: the hall's gold (200) and the guard squad's
// captain and sergeant (30 hp each, faction `village`). An effect takes its amount, or the
// entities it acts on, from the played round's report, checked against declared limits: a report
// over a limit is refused (`report_over_limit`), never clamped, and the mission is then delegated
// at its commit with the declared amounts.

const SCENARIO = JSON.parse(
  readFileSync(new URL('./__fixtures__/captive.world.json', import.meta.url), 'utf8'),
) as unknown;

/** A mission of one outcome `done` with `effects`, cost 10. */
function missionWith(effects: MissionEffect[]): MissionDef {
  const parsed = parseMission({
    id: 'walls',
    title: 'Hold the walls',
    worldTimeCost: 10,
    play: 'td-defence',
    onQuit: 'done',
    outcomes: [{ id: 'done', title: 'Done', effects }],
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.mission;
}

function opened(effects: MissionEffect[]): { world: World; keys: Record<string, Entity> } {
  const world = worldFromScenario(SCENARIO);
  const keys = scenarioKeys(SCENARIO);
  const r = openMission(world, missionWith(effects), { refs: keys });
  if (!r.ok) throw new Error(r.error);
  return { world, keys };
}

const gold = (world: World, keys: Record<string, Entity>) =>
  (world.get(keys['hall'] as Entity, Inventory) as Record<string, number> | undefined)?.['gold'] ?? 0;
const hp = (world: World, keys: Record<string, Entity>, key: string) =>
  world.get(keys[key] as Entity, Health)?.hp;
const commit = (world: World) => {
  const done = commitMission(world, 'walls');
  if (!done.ok) throw new Error(done.error);
  return done.record;
};

const SPENT: MissionEffect = {
  type: 'inventory',
  entity: 'hall',
  item: 'gold',
  add: -50,
  fromReport: 'spent',
  negate: true,
  max: 100,
};

describe('an inventory effect from the report (lesson D3)', () => {
  it('takes the gold the round spent, not a fixed amount', () => {
    const { world, keys } = opened([SPENT]);
    expect(playMission(world, 'walls', { outcome: 'done', stats: { spent: 30 } }).ok).toBe(true);
    commit(world);
    expect(gold(world, keys)).toBe(170);
  });

  it('refuses a report over the declared max, changing nothing; the commit delegates', () => {
    const { world, keys } = opened([SPENT]);
    const r = playMission(world, 'walls', { outcome: 'done', stats: { spent: 120 } });
    expect(r).toMatchObject({ ok: false, code: 'report_over_limit' });
    expect(!r.ok && r.error).toContain('"spent" is 120, more than its max 100');
    expect(missionsOf(world).open()[0]?.resolved).toBeNull();
    const record = commit(world);
    expect(record.resolution).toBe('timeout');
    expect(gold(world, keys)).toBe(150);
  });

  it('takes exactly the max, adds without `negate`, and skips a 0', () => {
    const at = (effect: MissionEffect, spent: number) => {
      const { world, keys } = opened([effect]);
      expect(playMission(world, 'walls', { outcome: 'done', stats: { spent } }).ok).toBe(true);
      const record = commit(world);
      return { gold: gold(world, keys), record };
    };
    expect(at(SPENT, 100).gold).toBe(100);
    expect(at({ ...SPENT, negate: false, add: 5 }, 25).gold).toBe(225);
    const zero = at(SPENT, 0);
    expect(zero.gold).toBe(200);
    expect(zero.record.skipped).toEqual([SPENT]);
  });

  it('uses the declared `add` when delegated, quit or without the stat', () => {
    for (const how of [
      (w: World) => delegateMission(w, 'walls'),
      (w: World) => quitMission(w, 'walls'),
      (w: World) => playMission(w, 'walls', { outcome: 'done', stats: {} }),
    ]) {
      const { world, keys } = opened([SPENT]);
      expect(how(world).ok).toBe(true);
      commit(world);
      expect(gold(world, keys)).toBe(150);
    }
  });
});

describe('a damage effect from the report, with a max (lesson D3)', () => {
  const HURT: MissionEffect = { type: 'damage', entity: 'captain', amount: 5, fromReport: 'hpLost', max: 20 };

  it('takes the stat up to its max and refuses one over it', () => {
    const ok = opened([HURT]);
    expect(playMission(ok.world, 'walls', { outcome: 'done', stats: { hpLost: 20 } }).ok).toBe(true);
    commit(ok.world);
    expect(hp(ok.world, ok.keys, 'captain')).toBe(10);
    const over = opened([HURT]);
    expect(playMission(over.world, 'walls', { outcome: 'done', stats: { hpLost: 21 } })).toMatchObject({
      ok: false,
      code: 'report_over_limit',
    });
    commit(over.world);
    expect(hp(over.world, over.keys, 'captain')).toBe(25);
  });
});

describe('`each`: every entity a report stat lists (lesson D4)', () => {
  const FALLEN: MissionEffect = {
    type: 'damage',
    each: 'fallen',
    entities: ['sergeant'],
    amount: 7,
    owner: 'village',
    max: 2,
  };

  it('hits every entity the played report names, by key or by id', () => {
    const { world, keys } = opened([FALLEN]);
    const captain = String(keys['captain']);
    expect(
      playMission(world, 'walls', { outcome: 'done', stats: { fallen: [captain, 'sergeant'] } }).ok,
    ).toBe(true);
    commit(world);
    expect([hp(world, keys, 'captain'), hp(world, keys, 'sergeant')]).toEqual([23, 23]);
  });

  it('applies to the declared `entities` when not played', () => {
    const { world, keys } = opened([FALLEN]);
    expect(delegateMission(world, 'walls').ok).toBe(true);
    commit(world);
    expect([hp(world, keys, 'captain'), hp(world, keys, 'sergeant')]).toEqual([30, 23]);
  });

  it('refuses a list longer than its max, or naming an entity of another faction', () => {
    const long = opened([FALLEN]);
    expect(
      playMission(long.world, 'walls', {
        outcome: 'done',
        stats: { fallen: ['captain', 'sergeant', 'hall'] },
      }),
    ).toMatchObject({ ok: false, code: 'report_over_limit' });
    const raiders = opened([{ ...FALLEN, owner: 'raiders' }]);
    const r = playMission(raiders.world, 'walls', { outcome: 'done', stats: { fallen: ['captain'] } });
    expect(r).toMatchObject({ ok: false, code: 'report_over_limit' });
    expect(!r.ok && r.error).toContain('"captain", which is not a living entity of "raiders"');
    // Nothing was resolved: the commit delegates, with the declared list.
    expect(commit(raiders.world).resolution).toBe('timeout');
    expect(hp(raiders.world, raiders.keys, 'sergeant')).toBe(23);
  });

  it('destroys every entity named, and skips the effect when the list is empty', () => {
    const DESTROY: MissionEffect = { type: 'destroy', each: 'killed', entities: ['captain'], max: 2 };
    const { world, keys } = opened([DESTROY]);
    expect(playMission(world, 'walls', { outcome: 'done', stats: { killed: ['sergeant'] } }).ok).toBe(true);
    commit(world);
    expect([world.alive(keys['captain'] as Entity), world.alive(keys['sergeant'] as Entity)]).toEqual([
      true,
      false,
    ]);
    const none = opened([DESTROY]);
    expect(playMission(none.world, 'walls', { outcome: 'done', stats: { killed: [] } }).ok).toBe(true);
    expect(commit(none.world).skipped).toEqual([DESTROY]);
  });

  it('opens only with every declared entity a known key', () => {
    const world = worldFromScenario(SCENARIO);
    const r = openMission(world, missionWith([{ ...FALLEN, entities: ['nobody'] }]), {
      refs: scenarioKeys(SCENARIO),
    });
    expect(r).toMatchObject({ ok: false, code: 'unknown_ref' });
  });
});

describe('the effect schemas (Engine 0.15 T8)', () => {
  const bad = (effect: unknown) => {
    const r = parseMission({
      id: 'm',
      title: 'M',
      worldTimeCost: 1,
      onQuit: 'o',
      outcomes: [{ id: 'o', title: 'O', effects: [effect] }],
    });
    return r.ok ? '' : r.error;
  };

  it('refuses each shape that cannot be meant', () => {
    expect(bad({ type: 'destroy' })).toContain('give exactly one of "entity" and "each"');
    expect(bad({ type: 'destroy', entity: 'a', each: 'killed' })).toContain('exactly one');
    expect(bad({ type: 'destroy', entity: 'a', owner: 'x' })).toContain('"owner" goes with "each" only');
    expect(bad({ type: 'destroy', each: 'k', entities: ['a', 'b'], max: 1 })).toContain('more than "max"');
    expect(bad({ type: 'damage', entity: 'a', amount: 1, max: 3 })).toContain('"max" limits a report stat');
    expect(bad({ type: 'damage', each: 'k', amount: 1, fromReport: 's' })).toContain('not both');
    expect(bad({ type: 'inventory', entity: 'a', item: 'gold', add: 1, negate: true })).toContain(
      '"negate" goes with "fromReport" only',
    );
    expect(bad({ type: 'destroy', each: 'killed', entities: ['a'], owner: 'raiders', max: 4 })).toBe('');
  });
});
