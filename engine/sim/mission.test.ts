import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../core/headless';
import { Health, Inventory, Patrol, Position, STANDARD_COMPONENTS } from './components';
import {
  MISSION_COMPONENTS,
  Missions,
  commitMission,
  delegateMission,
  missionsOf,
  openMission,
  playMission,
  quitMission,
  settleMissions,
} from './mission';
import { OPPORTUNITY_COMPONENTS, addOpportunities } from './opportunity';
import { loadWorld, saveWorld } from './save';
import { SYSTEM_COMPONENTS, patrolSystem } from './systems';
import { Terrain, flatTerrain } from './terrain';
import { TIME_COMPONENTS, addExperience, joinEvent, timeOf } from './time';
import { createWorld, type Entity, type World } from './world';

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

/** Three siege engines (keys ram, tower, sling) in event "siege", a supply cart and a patrol outside it. */
function siegeWorld(seed = 7): { world: World; refs: Record<string, Entity> } {
  const world = createWorld(seed, { components: COMPONENTS, systems: SYSTEMS });
  world.add(world.spawn(), Terrain, flatTerrain(12, 4));
  const refs: Record<string, Entity> = {};
  for (const [i, key] of ['ram', 'tower', 'sling'].entries()) {
    const id = world.spawn();
    world.add(id, Position, { x: i, y: 0, z: 0 });
    world.add(id, Health, { hp: 10, max: 10 });
    world.add(id, Patrol, {
      waypoints: [
        { x: i, y: 0, z: 0 },
        { x: i, y: 3, z: 0 },
      ],
      index: 1,
    });
    joinEvent(world, id, 'siege', 'scenario');
    refs[key] = id;
  }
  const cart = world.spawn();
  world.add(cart, Inventory, { food: 5 });
  refs['cart'] = cart;
  const scout = world.spawn();
  world.add(scout, Position, { x: 6, y: 0, z: 0 });
  world.add(scout, Patrol, {
    waypoints: [
      { x: 6, y: 0, z: 0 },
      { x: 11, y: 0, z: 0 },
    ],
    index: 1,
  });
  refs['scout'] = scout;
  // The rescue a repelled raid opens (opportunity.test.ts covers opportunities themselves).
  addOpportunities(
    world,
    [{ id: 'rescue', mission: 'rescue', opens: 0, closes: 60, relative: true }],
    'scenario',
  );
  return { world, refs };
}

const RAID = {
  id: 'raid',
  title: 'Burn the siege engines',
  event: 'siege',
  worldTimeCost: 30,
  play: 'sabotage',
  onQuit: 'repelled',
  outcomes: [
    {
      id: 'clean',
      title: 'All three burnt',
      weight: 1,
      effects: [
        { type: 'destroy', entity: 'ram' },
        { type: 'destroy', entity: 'tower' },
        { type: 'destroy', entity: 'sling' },
      ],
    },
    {
      id: 'partial',
      title: 'Two of three burnt',
      weight: 2,
      effects: [
        { type: 'destroy', entity: 'ram' },
        { type: 'damage', entity: 'tower', amount: 4 },
        { type: 'inventory', entity: 'cart', item: 'food', add: -2 },
      ],
    },
    {
      id: 'repelled',
      title: 'Driven off',
      weight: 1,
      effects: [
        { type: 'set', entity: 'tower', component: 'Health', values: { hp: 10 } },
        { type: 'opportunity', open: 'rescue' },
      ],
    },
  ],
};

function opened(seed = 7): { world: World; refs: Record<string, Entity> } {
  const made = siegeWorld(seed);
  const r = openMission(made.world, RAID, { refs: made.refs });
  if (!r.ok) throw new Error(r.error);
  return made;
}

describe('opening a mission', () => {
  it('records it, freezes its event and returns a plain snapshot', () => {
    const { world, refs } = siegeWorld();
    world.step();
    const r = openMission(world, RAID, { refs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.openTick, r.commitTick]).toEqual([1, 31]);
    expect(JSON.parse(canonicalJson(r.snapshot))).toEqual(r.snapshot);
    expect(
      timeOf(world)
        .frozen()
        .map((f) => f.event),
    ).toEqual(['siege']);
    expect(missionsOf(world).status('raid')).toBe('open');
    expect(
      missionsOf(world)
        .open()[0]
        ?.def.outcomes.map((o) => o.id),
    ).toEqual(['clean', 'partial', 'repelled']);
    expect(world.events().at(-1)?.cause).toBe('mission:raid');
  });

  it('is refused, changing nothing, for a bad def, a missing ref, a frozen event or a second open', () => {
    const { world, refs } = siegeWorld();
    const before = world.canonical();
    const cases = [
      [openMission(world, { ...RAID, worldTimeCost: 0 }, { refs }), 'bad_mission'],
      [openMission(world, { ...RAID, onQuit: 'win' }, { refs }), 'bad_mission'],
      [openMission(world, RAID), 'unknown_ref'],
      [
        openMission(world, {
          ...RAID,
          outcomes: [
            { id: 'x', title: 'X', effects: [{ type: 'set', entity: 1, component: 'Nope', values: {} }] },
          ],
          onQuit: 'x',
        }),
        'unknown_component',
      ],
    ] as const;
    for (const [r, code] of cases) expect(r).toMatchObject({ ok: false, code });
    expect(world.canonical()).toBe(before);
    expect(openMission(world, RAID, { refs }).ok).toBe(true);
    expect(openMission(world, RAID, { refs })).toMatchObject({ ok: false, code: 'mission_open' });
    expect(openMission(world, { ...RAID, id: 'raid-two' }, { refs })).toMatchObject({
      ok: false,
      code: 'event_frozen',
    });
  });

  it('leaves worlds that never open a mission as they were', () => {
    const a = siegeWorld();
    const b = createWorld(7, {
      components: [...STANDARD_COMPONENTS, Terrain, ...SYSTEM_COMPONENTS, ...TIME_COMPONENTS],
      systems: SYSTEMS,
    });
    b.add(b.spawn(), Terrain, flatTerrain(12, 4));
    expect(a.world.registered(Missions)).toBe(true);
    expect(Object.keys(a.world.snapshot().components)).not.toContain('Missions');
    a.world.step();
    expect(Object.keys(a.world.snapshot().components)).not.toContain('Missions');
  });
});

describe('committing a mission', () => {
  it("applies only a partial success's effects, at the commit tick, under mission:<id>", () => {
    const { world, refs } = opened();
    expect(playMission(world, 'raid', 'partial')).toMatchObject({ ok: true, result: { outcome: 'partial' } });
    const done = commitMission(world, 'raid');
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(world.tick).toBe(30);
    expect(world.alive(refs['ram'] as Entity)).toBe(false);
    expect(world.get(refs['tower'] as Entity, Health)).toEqual({ hp: 6, max: 10 });
    expect(world.alive(refs['sling'] as Entity)).toBe(true);
    expect(world.get(refs['cart'] as Entity, Inventory)).toEqual({ food: 3 });
    expect(done.record).toMatchObject({
      mission: 'raid',
      outcome: 'partial',
      resolution: 'played',
      openTick: 0,
      commitTick: 30,
      skipped: [],
    });
    expect(timeOf(world).frozen()).toEqual([]);
    expect(timeOf(world).commitment('raid')).toMatchObject({ opened: 0, tick: 30 });
    const changes = world.events(30).filter((c) => c.cause === 'mission:raid');
    expect(changes.some((c) => c.op === 'destroy' && c.entity === refs['ram'])).toBe(true);
  });

  it('holds the event still and lets everything else run while open', () => {
    const { world, refs } = opened();
    const ram = world.get(refs['ram'] as Entity, Position);
    delegateMission(world, 'raid');
    for (let i = 0; i < 10; i++) world.step();
    expect(world.get(refs['ram'] as Entity, Position)).toEqual(ram);
    expect(world.get(refs['scout'] as Entity, Position)?.x).toBeGreaterThan(6);
  });

  it('commits a failure and refuses any retry, replay or recommit', () => {
    const { world, refs } = opened();
    expect(quitMission(world, 'raid')).toMatchObject({ ok: true, result: { outcome: 'repelled' } });
    expect(playMission(world, 'raid', 'clean')).toMatchObject({ ok: false, code: 'mission_resolved' });
    expect(delegateMission(world, 'raid')).toMatchObject({ ok: false, code: 'mission_resolved' });
    const done = commitMission(world, 'raid');
    expect(done).toMatchObject({ ok: true, record: { outcome: 'repelled', resolution: 'quit' } });
    const after = world.canonical();
    const logged = world.events().length;
    for (const r of [
      commitMission(world, 'raid'),
      openMission(world, RAID, { refs }),
      playMission(world, 'raid', 'clean'),
      delegateMission(world, 'raid'),
      quitMission(world, 'raid'),
    ]) {
      expect(r).toMatchObject({ ok: false, code: 'mission_committed' });
      if (!r.ok) expect(r.error).not.toContain('\n');
    }
    expect(world.canonical()).toBe(after);
    expect(world.events().length).toBe(logged);
  });

  it('refuses a played result outside the declared or playable space and stays open', () => {
    const { world } = opened();
    const before = world.canonical();
    expect(playMission(world, 'raid', 'triumph')).toMatchObject({ ok: false, code: 'unknown_outcome' });
    expect(playMission(world, 'raid', { outcome: 'triumph', stats: { burnt: 9 } })).toMatchObject({
      ok: false,
      code: 'unknown_outcome',
    });
    expect(commitMission(world, 'raid', { mission: 'raid', outcome: 'triumph', effects: [] })).toMatchObject({
      ok: false,
      code: 'unknown_outcome',
    });
    expect(world.canonical()).toBe(before);
    expect(missionsOf(world).open()[0]?.resolved).toBeNull();

    const { world: w2, refs } = siegeWorld();
    openMission(w2, { ...RAID, playable: ['partial', 'repelled'] }, { refs });
    expect(playMission(w2, 'raid', 'clean')).toMatchObject({ ok: false, code: 'unknown_outcome' });
    expect(delegateMission(w2, 'raid').ok).toBe(true);
  });

  it('lets a played choice pick any declared outcome', () => {
    for (const outcome of ['clean', 'partial', 'repelled']) {
      const { world } = opened();
      expect(playMission(world, 'raid', { outcome, stats: { seconds: 12 } }).ok).toBe(true);
      const done = commitMission(world, 'raid');
      expect(done).toMatchObject({
        ok: true,
        record: { outcome, report: { outcome, stats: { seconds: 12 } } },
      });
    }
  });

  it('commits a result handed in, and refuses one that disagrees with the resolution', () => {
    const { world } = opened();
    const r = delegateMission(world, 'raid');
    if (!r.ok) throw new Error(r.error);
    const other = r.result.outcome === 'clean' ? 'partial' : 'clean';
    expect(commitMission(world, 'raid', { ...r.result, outcome: other })).toMatchObject({
      ok: false,
      code: 'result_mismatch',
    });
    expect(commitMission(world, 'raid', r.result)).toMatchObject({
      ok: true,
      record: { outcome: r.result.outcome },
    });
  });

  it('delegates an unresolved mission when its cost runs out (timeout)', () => {
    const { world } = opened();
    for (let i = 0; i < 30; i++) world.step();
    const records = settleMissions(world);
    expect(records.map((r) => [r.mission, r.resolution, r.commitTick])).toEqual([['raid', 'timeout', 30]]);
  });

  it('refuses a commit once the world has stepped past it unsettled', () => {
    const { world } = opened();
    for (let i = 0; i < 31; i++) world.step();
    expect(commitMission(world, 'raid')).toMatchObject({ ok: false, code: 'mission_overdue' });
  });

  it('lists effects whose entity is gone as skipped', () => {
    const { world, refs } = opened();
    world.withCause('test', () => world.destroy(refs['ram'] as Entity));
    playMission(world, 'raid', 'clean');
    const done = commitMission(world, 'raid');
    expect(done.ok && done.record.skipped).toEqual([{ type: 'destroy', entity: 'ram' }]);
  });

  it('commits another mission that comes due on the way', () => {
    const { world, refs } = opened();
    const scoutRun = {
      id: 'scout',
      title: 'Scout',
      worldTimeCost: 5,
      play: 'run',
      onQuit: 'back',
      outcomes: [{ id: 'back', title: 'Back', effects: [{ type: 'damage', entity: 'scout', amount: 1 }] }],
    };
    expect(openMission(world, scoutRun, { refs })).toMatchObject({ ok: true, commitTick: 5 });
    expect(commitMission(world, 'raid').ok).toBe(true);
    expect(
      missionsOf(world)
        .committed()
        .map((r) => [r.mission, r.commitTick, r.resolution, r.skipped.length]),
    ).toEqual([
      ['scout', 5, 'timeout', 1],
      ['raid', 30, 'timeout', 0],
    ]);
  });
});

describe('delegation', () => {
  it('is repeatable from the seed and picks only declared outcomes', () => {
    const run = (seed: number): [string, string] => {
      const { world } = opened(seed);
      const r = delegateMission(world, 'raid');
      if (!r.ok) throw new Error(r.error);
      commitMission(world, 'raid');
      return [r.result.outcome, hash(world)];
    };
    for (const seed of [1, 2, 3, 99]) {
      const [outcome, h] = run(seed);
      expect(['clean', 'partial', 'repelled']).toContain(outcome);
      expect(run(seed)).toEqual([outcome, h]);
    }
  });

  it('draws outcomes in proportion to their weights over many seeds', () => {
    const counts: Record<string, number> = { clean: 0, partial: 0, repelled: 0 };
    const n = 4000;
    for (let seed = 1; seed <= n; seed++) {
      const world = createWorld(seed, { components: COMPONENTS });
      const { event: _event, ...rest } = RAID;
      const def = { ...rest, outcomes: RAID.outcomes.map((o) => ({ ...o, effects: [] })) };
      openMission(world, def);
      const r = delegateMission(world, 'raid');
      if (r.ok) counts[r.result.outcome] = (counts[r.result.outcome] ?? 0) + 1;
    }
    // Weights 1:2:1 -> 25%, 50%, 25%; allow 3 percentage points.
    expect(Math.abs((counts['clean'] as number) / n - 0.25)).toBeLessThan(0.03);
    expect(Math.abs((counts['partial'] as number) / n - 0.5)).toBeLessThan(0.03);
    expect(Math.abs((counts['repelled'] as number) / n - 0.25)).toBeLessThan(0.03);
  });

  it('does not depend on the tick it happens at, and never moves world.rng (item 154)', () => {
    // A system that draws from world.rng every tick, as the hauler does.
    const roller = { name: 'roller', run: (w: World) => void w.rng.int(1000) };
    const run = (resolveAt: number, how: 'delegate' | 'play' | 'none'): [string, string] => {
      const world = createWorld(5, { components: COMPONENTS, systems: [roller] });
      const { event: _event, ...rest } = RAID;
      const def = { ...rest, outcomes: RAID.outcomes.map((o) => ({ ...o, effects: [] })) };
      expect(openMission(world, def).ok).toBe(true);
      for (let i = 0; i < resolveAt; i++) world.step();
      const rngBefore = world.rng.state();
      if (how === 'delegate') expect(delegateMission(world, 'raid').ok).toBe(true);
      if (how === 'play') expect(playMission(world, 'raid', 'partial').ok).toBe(true);
      expect(world.rng.state()).toBe(rngBefore);
      while (world.tick < 30) {
        world.step();
        settleMissions(world);
      }
      const record = missionsOf(world).committed()[0];
      for (let i = 0; i < 5; i++) world.step();
      // Everything but the record's outcome, resolution and report: the unrelated world state.
      const unrelated = world
        .canonical()
        .replace(/("outcome":"[a-z]+"|"resolution":"[a-z]+"|"report":\{[^}]*\}),?/g, '');
      return [record?.outcome ?? '', unrelated];
    };
    const [outcome, state] = run(0, 'delegate');
    for (const at of [1, 12, 29]) expect(run(at, 'delegate')).toEqual([outcome, state]);
    // Left unresolved, the timeout draw at the commit tick gives the same outcome and world.
    expect(run(0, 'none')).toEqual([outcome, state]);
    // Played, only the outcome (and its effects, none here) differs.
    expect(run(7, 'play')[1]).toBe(state);
  });
});

describe('the fixed world-time cost', () => {
  /** A stand-in kit round: its own ticks, none of them the world's. */
  function playRound(ticks: number): string {
    let burnt = 0;
    for (let t = 0; t < ticks; t++) if (t % 97 === 0) burnt = (burnt + 1) % 3;
    return ['repelled', 'partial', 'clean'][Math.min(burnt, 1)] as string;
  }

  it('gives the same hash after commit whether 0, 1 or 10,000 experience ticks pass inside', () => {
    const hashes = [0, 1, 10_000].map((ticks) => {
      const { world } = opened();
      const before = world.tick;
      playRound(ticks);
      expect(world.tick).toBe(before);
      expect(playMission(world, 'raid', 'partial').ok).toBe(true);
      expect(commitMission(world, 'raid')).toMatchObject({ ok: true, record: { commitTick: 30 } });
      return hash(world);
    });
    expect(new Set(hashes).size).toBe(1);
  });

  it('records experience ticks on the record without moving the world or anything else', () => {
    const states = [0, 1, 10_000].map((ticks) => {
      const { world } = opened();
      expect(addExperience(world, 'raid', ticks, 'mission:raid').ok).toBe(true);
      expect(world.tick).toBe(0);
      playMission(world, 'raid', 'partial');
      const done = commitMission(world, 'raid');
      expect(done.ok && [done.record.commitTick, done.record.experienceTicks]).toEqual([30, ticks]);
      expect(world.tick).toBe(30);
      // Only the recorded count differs: with it left out, the states are equal.
      return world.canonical().replace(/"experience(Ticks)?":\d+/g, '"experience$1":0');
    });
    expect(new Set(states).size).toBe(1);
  });

  it('is the same played at once or in a run that steps the world tick by tick', () => {
    const a = opened().world;
    playMission(a, 'raid', 'partial');
    commitMission(a, 'raid');
    const b = opened().world;
    for (let i = 0; i < 12; i++) b.step();
    playMission(b, 'raid', 'partial');
    for (let i = 0; i < 18; i++) b.step();
    expect(settleMissions(b).length).toBe(1);
    expect(hash(b)).toBe(hash(a));
  });
});

describe('committed records', () => {
  it('never change across later ticks and save and load', () => {
    const { world } = opened();
    delegateMission(world, 'raid');
    const done = commitMission(world, 'raid');
    if (!done.ok) throw new Error(done.error);
    const record = canonicalJson(done.record as never);
    expect(Object.isFrozen(missionsOf(world).record('raid'))).toBe(true);
    for (let i = 0; i < 50; i++) world.step();
    expect(canonicalJson(missionsOf(world).record('raid') as never)).toBe(record);

    const save = canonicalJson(saveWorld(world));
    const back = loadWorld(JSON.parse(save), { components: COMPONENTS, systems: SYSTEMS });
    expect(back.canonical()).toBe(world.canonical());
    expect(canonicalJson(missionsOf(back).record('raid') as never)).toBe(record);
    for (let i = 0; i < 50; i++) {
      back.step();
      world.step();
    }
    expect(hash(back)).toBe(hash(world));
    expect(canonicalJson(missionsOf(back).record('raid') as never)).toBe(record);
    expect(commitMission(back, 'raid')).toMatchObject({ ok: false, code: 'mission_committed' });
  });

  it('a save and load while open commits the same as an uninterrupted run', () => {
    const a = opened().world;
    for (let i = 0; i < 9; i++) a.step();
    const back = loadWorld(JSON.parse(canonicalJson(saveWorld(a))), {
      components: COMPONENTS,
      systems: SYSTEMS,
    });
    for (const w of [a, back]) {
      delegateMission(w, 'raid');
      commitMission(w, 'raid');
    }
    expect(hash(back)).toBe(hash(a));
  });
});
