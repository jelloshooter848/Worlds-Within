import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MissionDef } from '../core/missions';
import { CARRIED_FATES, CARRIED_FORMAT, carriedRecord, type CarriedRecord } from './carry';
import { Health, Inventory, Position, Squad } from './components';
import { FATE_STATES, Fate, fateOf } from './fate';
import { commitMission, delegateMission, openMission, playMission } from './mission';
import { Opportunities, opportunitiesOf } from './opportunity';
import { Unit } from './rts';
import { loadWorld, saveWorld } from './save';
import { ScenarioError, scenarioKeys, worldFromScenario } from './scenario';
import { SYSTEM_SETS } from './system-sets';
import type { Entity, World } from './world';

// Carry-over (Engine 0.13 T5; docs/BUILD-LOG.md, Engine 0.13, decision 5, item 224): the captive
// fixture's end world carried into its follow-up `captive-after.world.json`, which carries the
// captain and the sergeant (Health and fate) and the village's gold, and opens the rescue, the
// exchange and the leave-behind when the captain comes in captured.

const DIR = new URL('./__fixtures__/', import.meta.url);
const read = (name: string): unknown => JSON.parse(readFileSync(new URL(name, DIR), 'utf8')) as unknown;
const FIRST = read('captive.world.json');
const SECOND = read('captive-after.world.json') as { from: unknown } & Record<string, unknown>;
const FIRST_KEYS = scenarioKeys(FIRST);
const KEYS = scenarioKeys(SECOND);
const FOLLOW_UPS = ['rescue-window', 'exchange-window', 'leave-window'];

const hash = (world: World): string =>
  createHash('sha256').update(world.canonical()).digest('hex').slice(0, 16);

/** The captive world at tick 12 after `ambush` resolved with `outcome` (delegated: `taken`). */
function firstEnd(outcome: 'taken' | 'held' | 'delegated'): World {
  const world = worldFromScenario(FIRST);
  world.step();
  world.step();
  const ambush = read('ambush.mission.json') as MissionDef;
  const opened = openMission(world, ambush, { refs: FIRST_KEYS });
  if (!opened.ok) throw new Error(opened.error);
  const r =
    outcome === 'delegated' ? delegateMission(world, 'ambush') : playMission(world, 'ambush', outcome);
  if (!r.ok) throw new Error(r.error);
  const done = commitMission(world, 'ambush');
  if (!done.ok) throw new Error(done.error);
  return world;
}

const recordOf = (world: World): CarriedRecord => carriedRecord(world, SECOND.from, FIRST_KEYS);
const follow = (carried?: unknown): World =>
  worldFromScenario(SECOND, carried === undefined ? {} : { carried });
const id = (key: string): Entity => KEYS[key] as Entity;

function issues(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof ScenarioError) return error.issues.map((i) => `${i.path}: ${i.message}`);
    throw error;
  }
  return [];
}

/**
 * The ids of entities whose components differ between two worlds (seed, tick, RNG and ids are
 * checked equal first).
 */
function differing(a: World, b: World): Entity[] {
  const byId = (w: World): Map<number, string> => {
    const snap = w.snapshot();
    const out = new Map<number, Record<string, unknown>>(snap.entities.map((e) => [e, {}]));
    for (const name of Object.keys(snap.components).sort())
      for (const [e, value] of snap.components[name] ?? [])
        (out.get(e) as Record<string, unknown>)[name] = value;
    return new Map([...out].map(([e, c]) => [e, JSON.stringify(c)]));
  };
  const head = (w: World) => ({ seed: w.seed, tick: w.tick, nextId: w.nextId, rng: w.snapshot().rng });
  expect(head(a)).toEqual(head(b));
  const x = byId(a);
  const y = byId(b);
  return [...new Set([...x.keys(), ...y.keys()])].filter((k) => x.get(k) !== y.get(k)).sort((p, q) => p - q);
}

describe('carriedRecord', () => {
  it("reads the same fates as engine/core's carried record schema (Engine 0.13 T6)", () => {
    expect(CARRIED_FATES).toEqual(['active', ...FATE_STATES]);
  });

  it('holds only what the spec names, from the end world, keys sorted', () => {
    const record = recordOf(firstEnd('delegated'));
    expect(record).toEqual({
      format: CARRIED_FORMAT,
      version: 1,
      from: 'captive',
      tick: 12,
      people: {
        captain: { fate: 'captured', by: 'raiders', at: 12, hp: 20, max: 30 },
        sergeant: { fate: 'active', by: null, at: null, hp: 30, max: 30 },
      },
      stockpiles: { village: { gold: 200 } },
    });
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });

  it('two endings that differ only in the captain give records that differ only in his entry', () => {
    const taken = recordOf(firstEnd('taken'));
    const held = recordOf(firstEnd('held'));
    expect(held.people['captain']).toEqual({ fate: 'active', by: null, at: null, hp: 30, max: 30 });
    expect({ ...taken, people: { ...taken.people, captain: null } }).toEqual({
      ...held,
      people: { ...held.people, captain: null },
    });
  });

  it('names a bad carry spec by its field', () => {
    const world = firstEnd('held');
    const from = (carry: unknown) => ({ scenario: 'captive', carry });
    expect(issues(() => carriedRecord(world, from({ people: ['nobody', 'hall'] }), FIRST_KEYS))).toEqual([
      'from.carry.people.0: "nobody" is not a key of the first scenario',
      'from.carry.people.1: "hall" (entity 2) is not a named person in the first world (no Member)',
    ]);
    expect(
      issues(() =>
        carriedRecord(
          world,
          from({ people: ['captain', 'captain'], stockpiles: [{ faction: 'raiders', items: ['gold'] }] }),
          FIRST_KEYS,
        ),
      ),
    ).toEqual(['from.carry.people.1: person "captain" is given twice']);
    expect(issues(() => carriedRecord(world, { scenario: 'captive' }, FIRST_KEYS))).toEqual([
      'from.carry: Invalid input: expected object, received undefined',
    ]);
  });
});

describe('a lost stockpile (Engine 0.15 T8, gap M31)', () => {
  it('carries as zeros of every item the spec names, not as an error', () => {
    const world = firstEnd('held');
    const from = {
      scenario: 'captive',
      carry: { people: ['captain'], stockpiles: [{ faction: 'raiders', items: ['gold', 'wood'] }] },
    };
    expect(carriedRecord(world, from, FIRST_KEYS).stockpiles).toEqual({ raiders: { gold: 0, wood: 0 } });
  });

  it('carries zeros once the stockpile entity is destroyed', () => {
    const world = firstEnd('held');
    world.withCause('test', () => world.destroy(FIRST_KEYS['hall'] as number));
    const from = {
      scenario: 'captive',
      carry: { people: ['captain'], stockpiles: [{ faction: 'village', items: ['gold'] }] },
    };
    expect(carriedRecord(world, from, FIRST_KEYS).stockpiles).toEqual({ village: { gold: 0 } });
  });
});

describe('a follow-up scenario built from a carried record', () => {
  it('starts as written without one', () => {
    const world = follow();
    expect(fateOf(world, id('captain'))?.state).toBe('active');
    expect(world.get(id('hall'), Inventory)).toEqual({ gold: 50, wood: 7 });
    for (const w of FOLLOW_UPS) expect(opportunitiesOf(world).status(w)).toBe('dormant');
  });

  it('carries a captured captain in off the map, with his hp, the gold and the follow-ups open', () => {
    const world = follow(recordOf(firstEnd('delegated')));
    const captain = id('captain');
    expect(world.tick).toBe(0);
    expect(world.get(captain, Fate)).toEqual({
      state: 'captured',
      by: 'raiders',
      at: 12,
      held: {
        unit: { type: 'soldier', speed: 2, attack: 4, range: 1, cooldown: 3, sight: 5 },
        owner: { faction: 'village' },
      },
      history: [{ state: 'captured', by: 'raiders', at: 12, cause: 'carry' }],
    });
    expect(world.get(captain, Health)).toEqual({ hp: 20, max: 30 });
    expect(world.has(captain, Position)).toBe(false);
    expect(world.has(captain, Unit)).toBe(false);
    expect(world.get(id('guard'), Squad)).toMatchObject({
      strength: 3,
      captain: null,
      members: [id('sergeant')],
    });
    expect(world.get(id('hall'), Inventory)).toEqual({ gold: 200, wood: 7 });
    for (const w of FOLLOW_UPS) {
      expect(opportunitiesOf(world).status(w)).toBe('offered');
      expect(opportunitiesOf(world).get(w)).toMatchObject({ opens: 0, closes: 40, by: 'carry' });
    }
    const causes = new Set(
      world
        .events()
        .filter((c) => c.entity === captain)
        .map((c) => c.cause),
    );
    expect(causes).toEqual(new Set(['scenario', 'carry']));
  });

  it('carries an active captain in on the map at his carried hp, opening nothing', () => {
    const world = follow(recordOf(firstEnd('held')));
    expect(fateOf(world, id('captain'))?.state).toBe('active');
    expect(world.get(id('captain'), Position)).toMatchObject({ x: 1, y: 3 });
    for (const w of FOLLOW_UPS) expect(opportunitiesOf(world).status(w)).toBe('dormant');
  });

  it('caps a carried hp at the follow-up scenario max, and starts a dead person as a record', () => {
    const base = recordOf(firstEnd('held'));
    const world = follow({
      ...base,
      people: {
        captain: { fate: 'dead', by: null, at: 9, hp: 0, max: 30 },
        sergeant: { fate: 'injured', by: 'raiders', at: 5, hp: 60, max: 60 },
      },
    });
    expect(world.get(id('sergeant'), Health)).toEqual({ hp: 30, max: 30 });
    expect(fateOf(world, id('sergeant'))).toMatchObject({ state: 'injured', by: 'raiders', at: 5 });
    expect(world.has(id('sergeant'), Position)).toBe(true);
    expect(fateOf(world, id('captain'))?.state).toBe('dead');
    expect(world.get(id('captain'), Health)).toEqual({ hp: 0, max: 30 });
    expect(world.has(id('captain'), Position)).toBe(false);
    for (const w of FOLLOW_UPS) expect(opportunitiesOf(world).status(w)).toBe('dormant');
  });

  it('gives equal hashes every run, at the start, after 30 ticks and through a save and load', () => {
    const record = recordOf(firstEnd('delegated'));
    const run = (): string[] => {
      const world = follow(JSON.parse(JSON.stringify(record)));
      const hashes = [hash(world)];
      for (let t = 0; t < 30; t++) {
        world.step();
        if (t % 10 === 9) hashes.push(hash(world));
      }
      return hashes;
    };
    const first = run();
    expect(run()).toEqual(first);
    expect(recordOf(firstEnd('delegated'))).toEqual(record);

    const world = follow(record);
    const loaded = loadWorld(JSON.parse(JSON.stringify(saveWorld(world))), SYSTEM_SETS.rts);
    expect(hash(loaded)).toBe(first[0]);
  });

  it('two records differing only in the fate of one person give start worlds differing only in that person', () => {
    const base = recordOf(firstEnd('held'));
    const sergeant = base.people['sergeant'];
    const injured = {
      ...base,
      people: { ...base.people, sergeant: { ...sergeant, fate: 'injured', by: 'raiders', at: 4 } },
    };
    const a = follow(base);
    const b = follow(injured);
    expect(hash(a)).not.toBe(hash(b));
    expect(differing(a, b)).toEqual([id('sergeant')]);

    // A capture also takes him out of his squad and, by the `when` rule, opens the follow-ups:
    // the squad and the opportunities' holder change with him, and nothing else does.
    const captured = recordOf(firstEnd('taken'));
    const c = follow(captured);
    const holder = c.query(Opportunities)[0] as Entity;
    expect(differing(follow(base), c)).toEqual([id('captain'), id('guard'), holder].sort((p, q) => p - q));
  });
});

describe('carry errors', () => {
  const good = () => recordOf(firstEnd('held'));

  it('names each bad field of a carried record under `carried`', () => {
    const r = good();
    expect(
      issues(() =>
        follow({
          ...r,
          from: 'village',
          people: { ...r.people, mayor: r.people['captain'] },
          stockpiles: { village: { gold: 1, wood: 2 }, raiders: { gold: 1 } },
        }),
      ),
    ).toEqual([
      'carried.from: is "village", but the scenario starts from "captive"',
      'carried.people.mayor: "mayor" is not carried by this scenario (from.carry.people)',
      'carried.stockpiles.village.wood: item "wood" is not carried by this scenario',
      'carried.stockpiles.raiders: faction "raiders" is not carried by this scenario',
    ]);
    const { sergeant: _gone, ...onlyCaptain } = r.people;
    expect(issues(() => follow({ ...r, people: onlyCaptain, stockpiles: {} }))).toEqual([
      'carried.people: has no entry for "sergeant"',
      'carried.stockpiles: has no entry for "village"',
    ]);
    expect(
      issues(() =>
        follow({
          ...r,
          version: 2,
          people: { ...r.people, captain: { fate: 'dead', by: null, at: null, hp: 3, max: 30 } },
        }),
      ),
    ).toEqual([
      'carried.version: Invalid input: expected 1',
      'carried.people.captain.at: a dead person needs the tick it was reached',
      'carried.people.captain.hp: a dead person has 0 hp',
    ]);
    expect(issues(() => worldFromScenario(FIRST, { carried: r }))).toEqual([
      'carried: the scenario has no `from`, so nothing can be carried into it',
    ]);
  });

  it('names each bad field of a scenario `from`', () => {
    const scenario = SECOND as unknown as Record<string, unknown> & {
      squads: { members: { components: object }[] }[];
    };
    const withFrom = (from: unknown, patch: Record<string, unknown> = {}) => ({
      ...scenario,
      from,
      ...patch,
    });
    expect(
      issues(() =>
        worldFromScenario(
          withFrom({
            scenario: 'captive',
            carry: {
              people: ['hall', 'ghost', 'captain'],
              stockpiles: [{ faction: 'raiders', items: ['gold'] }],
            },
            when: [
              { key: 'sergeant', fate: 'dead', open: ['rescue-window'] },
              { key: 'captain', fate: 'captured', open: ['nowhere'] },
            ],
          }),
        ),
      ),
    ).toEqual([
      'from.carry.people.0: "hall" is not the key of a named person (squad member) of this scenario',
      'from.carry.people.1: "ghost" is not the key of a named person (squad member) of this scenario',
      'from.carry.stockpiles.0.faction: faction "raiders" has no Stockpile in this scenario',
      'from.when.0.key: "sergeant" is not in from.carry.people',
      'from.when.1.open.0: "nowhere" is not an opportunity of this scenario',
    ]);
    expect(
      issues(() =>
        worldFromScenario(
          withFrom({ scenario: 'captive', carry: {}, when: [{ key: 'x', fate: 'lost', open: [] }] }),
        ),
      ),
    ).toEqual([
      'from.when.0.fate: Invalid option: expected one of "active"|"injured"|"captured"|"freed"|"dead"',
      'from.when.0.open: Too small: expected array to have >=1 items',
    ]);
    const fated = structuredClone(scenario);
    (fated.squads[0]?.members[0]?.components as Record<string, unknown>)['Fate'] = {
      state: 'injured',
      by: null,
      at: 0,
      held: null,
      history: [{ state: 'injured', by: null, at: 0, cause: 'scenario' }],
    };
    expect(issues(() => worldFromScenario(fated))).toEqual([
      'squads.0.members.0.components.Fate: "captain" is carried: their fate comes from the carried record',
    ]);
  });
});
