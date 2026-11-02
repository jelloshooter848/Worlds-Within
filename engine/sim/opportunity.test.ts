import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../core/headless';
import { Inventory, Patrol, Position, STANDARD_COMPONENTS } from './components';
import {
  MISSION_COMPONENTS,
  commitMission,
  missionsOf,
  openMission,
  playMission,
  settleMissions,
} from './mission';
import {
  OPPORTUNITY_COMPONENTS,
  Opportunities,
  addOpportunities,
  opportunitiesOf,
  settleOpportunities,
} from './opportunity';
import { loadWorld, saveWorld } from './save';
import { ScenarioError, worldFromScenario } from './scenario';
import { SYSTEM_COMPONENTS, patrolSystem } from './systems';
import { Terrain, flatTerrain } from './terrain';
import { TIME_COMPONENTS } from './time';
import { createWorld, type World } from './world';

const COMPONENTS = [
  ...STANDARD_COMPONENTS,
  Terrain,
  ...SYSTEM_COMPONENTS,
  ...TIME_COMPONENTS,
  ...MISSION_COMPONENTS,
  ...OPPORTUNITY_COMPONENTS,
];
const SYSTEMS = [patrolSystem];

const hash = (world: World): string =>
  createHash('sha256').update(world.canonical()).digest('hex').slice(0, 16);

/** A mission with one or more outcomes, each with the given effects. */
function mission(id: string, worldTimeCost: number, outcomes: Record<string, unknown[]> = { done: [] }) {
  const ids = Object.keys(outcomes);
  return {
    id,
    title: `Mission ${id}`,
    worldTimeCost,
    play: 'round',
    onQuit: ids[ids.length - 1],
    outcomes: ids.map((o) => ({ id: o, title: o, effects: outcomes[o] })),
  };
}

const AMBUSH = mission('ambush', 10);
const FREE = mission('free-them', 10);
const RAID = mission('raid', 30, {
  burnt: [{ type: 'inventory', entity: 'camp', item: 'oil', add: -1 }],
  failed: [{ type: 'opportunity', open: 'rescue' }],
});
const RESCUE = mission('rescue', 5);

/**
 * A small world with a patrolling scout (so ticks change the hash), a camp, and four
 * opportunities: the convoy or the transfer (one `road` group), a raid, and a dormant rescue.
 */
function world(seed = 11): { world: World; camp: number } {
  const w = createWorld(seed, { components: COMPONENTS, systems: SYSTEMS });
  w.add(w.spawn(), Terrain, flatTerrain(8, 2));
  const scout = w.spawn();
  w.add(scout, Position, { x: 0, y: 0, z: 0 });
  w.add(scout, Patrol, {
    waypoints: [
      { x: 0, y: 0, z: 0 },
      { x: 7, y: 0, z: 0 },
    ],
    index: 1,
  });
  const camp = w.spawn();
  w.add(camp, Inventory, { oil: 3 });
  const added = addOpportunities(
    w,
    [
      { id: 'convoy', mission: 'ambush', opens: 5, closes: 20, exclusive: 'road' },
      { id: 'transfer', mission: 'free-them', opens: 8, closes: 40, exclusive: 'road' },
      { id: 'raid-camp', mission: 'raid', opens: 0, closes: 100 },
      { id: 'rescue', mission: 'rescue', opens: 2, closes: 12, relative: true },
    ],
    'scenario',
  );
  if (!added.ok) throw new Error(added.error);
  return { world: w, camp };
}

function stepTo(w: World, tick: number): void {
  while (w.tick < tick) {
    w.step();
    settleMissions(w);
  }
}

const opportunityLog = (w: World) =>
  w
    .events()
    .filter((e) => e.component === 'Opportunities')
    .map((e) => e.cause);

describe('opportunity windows', () => {
  it('open and close as world time passes, each logged with the cause time', () => {
    const { world: w } = world();
    const o = opportunitiesOf(w);
    expect(o.status('convoy')).toBe('waiting');
    expect(o.status('raid-camp')).toBe('offered');
    expect(o.status('rescue')).toBe('dormant');
    stepTo(w, 5);
    expect(o.status('convoy')).toBe('offered');
    expect(o.offered().map((e) => e.def.id)).toEqual(['convoy', 'raid-camp']);
    stepTo(w, 19);
    expect(o.status('convoy')).toBe('offered');
    stepTo(w, 20);
    expect(o.get('convoy')).toMatchObject({ status: 'closed', by: 'time', at: 20 });
    const log = w.events().filter((e) => e.component === 'Opportunities' && e.cause === 'time');
    expect(log.map((e) => e.tick)).toEqual([0, 5, 8, 20]);
    stepTo(w, 40);
    expect(o.get('transfer')).toMatchObject({ status: 'closed', by: 'time', at: 40 });
  });

  it('a late settle closes a window at its own tick', () => {
    const { world: w } = world();
    for (let i = 0; i < 25; i++) w.step();
    const changes = settleOpportunities(w);
    expect(changes).toEqual([
      { id: 'convoy', status: 'closed', by: 'time', at: 20 },
      { id: 'transfer', status: 'offered', by: 'time', at: 8 },
    ]);
  });

  it('a world without opportunities snapshots as before', () => {
    const w = createWorld(3, { components: COMPONENTS, systems: SYSTEMS });
    w.add(w.spawn(), Terrain, flatTerrain(2, 2));
    expect(settleOpportunities(w)).toEqual([]);
    w.step();
    settleMissions(w);
    expect(Object.keys(w.snapshot().components)).not.toContain('Opportunities');
    expect(w.registered(Opportunities)).toBe(true);
  });
});

describe('taking an opportunity', () => {
  it('opens its mission and closes its rival in the exclusive group, logged with the mission', () => {
    const { world: w } = world();
    stepTo(w, 9);
    const r = openMission(w, AMBUSH);
    expect(r.ok).toBe(true);
    const o = opportunitiesOf(w);
    expect(o.get('convoy')).toMatchObject({ status: 'taken', by: 'mission:ambush', at: 9 });
    expect(o.get('transfer')).toMatchObject({ status: 'closed', by: 'mission:ambush', at: 9 });
    expect(o.status('raid-camp')).toBe('offered');
    expect(opportunityLog(w).slice(-2)).toEqual(['mission:ambush', 'mission:ambush']);
    // The rival's mission can no longer be opened, even inside its old window.
    const before = hash(w);
    const free = openMission(w, FREE);
    expect(free).toMatchObject({ ok: false, code: 'opportunity_closed' });
    expect(!free.ok && free.error).toContain('"transfer" is closed by mission:ambush');
    expect(hash(w)).toBe(before);
  });

  it('closes every id in closesOthers, one way', () => {
    const w = createWorld(1, { components: COMPONENTS });
    addOpportunities(
      w,
      [
        { id: 'a', mission: 'ambush', opens: 0, closes: 50, closesOthers: ['b'] },
        { id: 'b', mission: 'free-them', opens: 0, closes: 50 },
        { id: 'c', mission: 'rescue', opens: 0, closes: 50, closesOthers: ['a'] },
      ],
      'scenario',
    );
    expect(openMission(w, FREE).ok).toBe(true);
    expect(opportunitiesOf(w).status('a')).toBe('offered');
    expect(openMission(w, AMBUSH).ok).toBe(true);
    expect(opportunitiesOf(w).status('b')).toBe('taken');
    expect(opportunitiesOf(w).status('c')).toBe('offered');
  });

  it('refuses, changing nothing, a mission whose opportunity has closed or not opened yet', () => {
    const { world: w } = world();
    let before = hash(w);
    expect(openMission(w, AMBUSH)).toMatchObject({ ok: false, code: 'opportunity_closed' });
    expect(openMission(w, RESCUE)).toMatchObject({ ok: false, code: 'opportunity_closed' });
    expect(hash(w)).toBe(before);
    stepTo(w, 20);
    before = hash(w);
    const late = openMission(w, AMBUSH);
    expect(late).toMatchObject({ ok: false, code: 'opportunity_closed' });
    expect(!late.ok && late.error).toContain('"convoy" is closed at tick 20');
    expect(hash(w)).toBe(before);
    expect(missionsOf(w).status('ambush')).toBe(null);
  });

  it('leaves a mission no opportunity names ungated', () => {
    const { world: w } = world();
    expect(openMission(w, mission('patrol', 3)).ok).toBe(true);
  });

  it('refuses a mission whose effect names an opportunity the world does not know', () => {
    const { world: w } = world();
    const bad = mission('odd', 3, { done: [{ type: 'opportunity', close: 'nowhere' }] });
    expect(openMission(w, bad)).toMatchObject({ ok: false, code: 'unknown_opportunity' });
  });
});

describe("a mission's world-time cost", () => {
  it('carries the world past another window, which closes by time on the way', () => {
    const { world: w, camp } = world();
    stepTo(w, 4);
    expect(openMission(w, RAID, { refs: { camp } }).ok).toBe(true);
    expect(opportunitiesOf(w).status('convoy')).toBe('waiting');
    const done = commitMission(w, 'raid');
    expect(done.ok).toBe(true);
    expect(w.tick).toBe(34);
    const o = opportunitiesOf(w);
    expect(o.get('convoy')).toMatchObject({ status: 'closed', by: 'time', at: 20 });
    expect(o.get('transfer')).toMatchObject({ status: 'offered', by: 'time', at: 8 });
    expect(openMission(w, AMBUSH)).toMatchObject({ ok: false, code: 'opportunity_closed' });
  });
});

describe('mission effects', () => {
  it('a failure opens a follow-up opportunity, its window counted from the commit', () => {
    const { world: w, camp } = world();
    expect(openMission(w, RAID, { refs: { camp } }).ok).toBe(true);
    expect(playMission(w, 'raid', 'failed').ok).toBe(true);
    expect(commitMission(w, 'raid').ok).toBe(true);
    const o = opportunitiesOf(w);
    expect(o.get('rescue')).toMatchObject({
      status: 'waiting',
      opens: 32,
      closes: 42,
      by: 'mission:raid',
      at: 30,
    });
    expect(openMission(w, RESCUE)).toMatchObject({ ok: false, code: 'opportunity_closed' });
    stepTo(w, 32);
    expect(o.status('rescue')).toBe('offered');
    expect(openMission(w, RESCUE).ok).toBe(true);
    expect(o.get('rescue')).toMatchObject({ status: 'taken', by: 'mission:rescue', at: 32 });
  });

  it('a success leaves the follow-up dormant, so the rescue can never be taken', () => {
    const { world: w, camp } = world();
    openMission(w, RAID, { refs: { camp } });
    playMission(w, 'raid', 'burnt');
    commitMission(w, 'raid');
    stepTo(w, 60);
    expect(opportunitiesOf(w).status('rescue')).toBe('dormant');
    expect(openMission(w, RESCUE)).toMatchObject({ ok: false, code: 'opportunity_closed' });
  });

  it('a close effect closes a live one; one already closed is skipped', () => {
    const { world: w } = world();
    const shut = mission('shut', 2, {
      done: [
        { type: 'opportunity', close: 'transfer' },
        { type: 'opportunity', close: 'convoy' },
      ],
    });
    stepTo(w, 20);
    openMission(w, shut);
    const r = commitMission(w, 'shut');
    expect(r.ok && r.record.skipped).toEqual([{ type: 'opportunity', close: 'convoy' }]);
    expect(opportunitiesOf(w).get('transfer')).toMatchObject({
      status: 'closed',
      by: 'mission:shut',
      at: 22,
    });
  });
});

describe('adding opportunities', () => {
  it('refuses, changing nothing, bad data, a repeated id or an unknown closesOthers id', () => {
    const { world: w } = world();
    const before = hash(w);
    expect(addOpportunities(w, [{ id: 'x', mission: 'm', opens: 5, closes: 5 }], 'scenario')).toMatchObject({
      ok: false,
      code: 'bad_opportunity',
    });
    expect(
      addOpportunities(w, [{ id: 'convoy', mission: 'm', opens: 0, closes: 5 }], 'scenario'),
    ).toMatchObject({ ok: false, code: 'opportunity_exists' });
    expect(
      addOpportunities(
        w,
        [{ id: 'y', mission: 'm', opens: 0, closes: 5, closesOthers: ['zed'] }],
        'scenario',
      ),
    ).toMatchObject({ ok: false, code: 'unknown_opportunity' });
    expect(hash(w)).toBe(before);
  });
});

/** The whole story: windows passing, a take closing its rival, a failure opening the rescue. */
function story(seed: number, saveAt?: number): string[] {
  const made = world(seed);
  const camp = made.camp;
  let w = made.world;
  const hashes: string[] = [];
  const reload = () => {
    w = loadWorld(JSON.parse(canonicalJson(saveWorld(w))), { components: COMPONENTS, systems: SYSTEMS });
  };
  for (let t = 0; t <= 80; t++) {
    if (t === saveAt) reload();
    if (t === 6) openMission(w, RAID, { refs: { camp } });
    if (t === 7) playMission(w, 'raid', 'failed');
    if (t === 10) openMission(w, FREE);
    if (t === 40) openMission(w, RESCUE);
    hashes.push(hash(w));
    w.step();
    settleMissions(w);
  }
  expect(
    missionsOf(w)
      .committed()
      .map((r) => r.mission),
  ).toEqual(['free-them', 'raid', 'rescue']);
  expect(
    opportunitiesOf(w)
      .all()
      .map((e) => [e.def.id, e.status]),
  ).toEqual([
    ['convoy', 'closed'],
    ['raid-camp', 'taken'],
    ['rescue', 'taken'],
    ['transfer', 'taken'],
  ]);
  return hashes;
}

describe('determinism and save', () => {
  it('gives the same hashes on every run', () => {
    expect(story(11)).toEqual(story(11));
  });

  it('save and load keeps open, taken and closed opportunities with equal hashes', () => {
    const straight = story(11);
    for (const at of [3, 9, 20, 37, 41]) expect(story(11, at)).toEqual(straight);
    const { world: w } = world();
    stepTo(w, 21);
    const save = canonicalJson(saveWorld(w));
    const back = loadWorld(JSON.parse(save), { components: COMPONENTS, systems: SYSTEMS });
    expect(hash(back)).toBe(hash(w));
    expect(canonicalJson(saveWorld(back))).toBe(save);
    expect(opportunitiesOf(back).all()).toEqual(opportunitiesOf(w).all());
  });
});

describe('scenario opportunities', () => {
  const base = {
    format: 'worlds-within/scenario',
    version: 1,
    seed: 5,
    terrain: { legend: { '.': { name: 'grass', cost: 1, passable: true } }, rows: ['..'], elevation: ['00'] },
  };

  it('are added after the squads, the ones open at tick 0 offered at once', () => {
    const w = worldFromScenario({
      ...base,
      opportunities: [
        { id: 'now', mission: 'a', opens: 0, closes: 9 },
        { id: 'later', mission: 'b', opens: 4, closes: 9, closesOthers: ['now'] },
      ],
    });
    expect(
      opportunitiesOf(w)
        .all()
        .map((e) => [e.def.id, e.status]),
    ).toEqual([
      ['later', 'waiting'],
      ['now', 'offered'],
    ]);
    expect(opportunityLog(w)).toEqual(['scenario', 'time']);
  });

  it('report a repeated id or an unknown closesOthers id by path', () => {
    let err: unknown;
    try {
      worldFromScenario({
        ...base,
        opportunities: [
          { id: 'a', mission: 'a', opens: 0, closes: 9, closesOthers: ['zed'] },
          { id: 'a', mission: 'b', opens: 0, closes: 9 },
        ],
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ScenarioError);
    expect((err as ScenarioError).issues.map((i) => i.path)).toEqual([
      'opportunities.1.id',
      'opportunities.0.closesOthers.0',
    ]);
  });

  it('leave a scenario without them unchanged', () => {
    const w = worldFromScenario(base);
    expect(Object.keys(w.snapshot().components)).not.toContain('Opportunities');
    expect(w.nextId).toBe(2);
  });
});
