import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../core/headless';
import type { RtsTypes as RtsTypesData } from '../core/rts-types';
import { rtsTypesSchema } from '../core/rts-types';
import { Construction, Health, Inventory, Owner, Position, STANDARD_COMPONENTS, Worker } from './components';
import {
  Gatherer,
  Producer,
  Resource,
  RtsTypes,
  Stockpile,
  placeBuilding,
  spawnUnit,
  stockpileOf,
} from './economy';
import { Building } from './footprint';
import { Task, Unit } from './rts';
import { RTS_COMPONENTS, RTS_SYSTEMS, applyOrder } from './rts-orders';
import { loadWorld, saveWorld } from './save';
import { worldFromScenario } from './scenario';
import { Terrain, type TerrainData } from './terrain';
import { createWorld, type Entity, type World } from './world';

const COMPONENTS = [...STANDARD_COMPONENTS, Terrain, ...RTS_COMPONENTS];
const hash = (world: World): string =>
  createHash('sha256').update(world.canonical()).digest('hex').slice(0, 16);

/** The type table the tests play with: game data, passed in, never code in the sim. */
const TYPES: RtsTypesData = rtsTypesSchema.parse({
  units: {
    worker: {
      health: 20,
      speed: 1,
      attack: 1,
      range: 1,
      cooldown: 2,
      sight: 4,
      cost: { gold: 50 },
      trainTicks: 6,
      work: 2,
      gather: { capacity: 3, ticks: 2 },
    },
    soldier: {
      health: 30,
      speed: 1,
      attack: 4,
      range: 1,
      cooldown: 2,
      sight: 5,
      cost: { gold: 60 },
      trainTicks: 8,
    },
  },
  buildings: {
    hall: { health: 400, size: { w: 2, h: 2 }, work: 100, dropoff: true, trains: ['worker'] },
    barracks: { health: 200, size: { w: 2, h: 2 }, work: 20, cost: { gold: 100 }, trains: ['soldier'] },
  },
});

/** Terrain from rows: `.` ground, `#` rock (impassable). */
function terrain(rows: string[]): TerrainData {
  return {
    width: (rows[0] as string).length,
    height: rows.length,
    types: [
      { name: 'ground', cost: 1, passable: true },
      { name: 'rock', cost: 1, passable: false },
    ],
    elevation: rows.flatMap((r) => [...r].map(() => 0)),
    cells: rows.flatMap((r) => [...r].map((c) => (c === '#' ? 1 : 0))),
  };
}

const FIELD = [
  '............',
  '............',
  '............',
  '.........#..',
  '............',
  '............',
];

/** A world with the type table and red's finished hall at (0, 0), its stockpile holding `gold`. */
function setup(gold: number, rows = FIELD): { w: World; hall: Entity } {
  const w = createWorld(1, { components: COMPONENTS, systems: RTS_SYSTEMS });
  w.add(w.spawn(), Terrain, terrain(rows));
  w.add(w.spawn(), RtsTypes, TYPES);
  const hall = placeBuilding(w, 'red', 'hall', { x: 0, y: 0 }, true);
  w.add(hall, Stockpile, { faction: 'red' });
  if (gold > 0) w.add(hall, Inventory, { gold });
  return { w, hall };
}

const gold = (w: World, faction = 'red'): number =>
  w.get(stockpileOf(w, faction) as Entity, Inventory)?.gold ?? 0;

/** Assert the order is refused with `message` in its error and that nothing changed. */
function refused(w: World, order: unknown, message: string): void {
  const before = w.canonical();
  const events = w.events().length;
  const result = applyOrder(w, order);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain(message);
  expect(w.canonical()).toBe(before);
  expect(w.events().length).toBe(events);
}

describe('build orders', () => {
  it('pay the cost, place the site and finish it after its work ticks', () => {
    const { w } = setup(150);
    const worker = spawnUnit(w, 'red', 'worker', { x: 5, y: 3 });
    const result = applyOrder(w, {
      id: 1,
      faction: 'red',
      type: 'build',
      units: [worker],
      target: { x: 5, y: 4 },
      building: 'barracks',
    });
    expect(result.ok).toBe(true);
    expect(gold(w)).toBe(50);
    const site = w.query(Building).find((id) => w.get(id, Building)?.kind === 'barracks') as Entity;
    expect(w.get(site, Position)).toEqual({ x: 5, y: 4, z: 0 });
    expect(w.get(site, Owner)).toEqual({ faction: 'red' });
    expect(w.get(site, Building)).toEqual({ kind: 'barracks', w: 2, h: 2, dropoff: false });
    expect(w.get(site, Construction)).toEqual({ kind: 'barracks', progress: 0, work: 20, done: false });
    expect(w.get(site, Health)).toEqual({ hp: 1, max: 200 });
    expect(w.get(site, Producer)).toEqual({ trains: ['soldier'], queue: [], progress: 0 });
    expect(w.get(worker, Worker)?.job).toBe(site);
    expect(w.get(worker, Task)?.kind).toBe('build');
    expect(
      w
        .events()
        .filter((e) => e.entity === site)
        .every((e) => e.cause === 'order:1'),
    ).toBe(true);

    // Work 20 at rate 2, the worker already next to it: done on the 10th step, not before.
    for (let i = 1; i <= 9; i++) {
      w.step();
      expect(w.get(site, Construction)?.progress).toBe(2 * i);
    }
    expect(w.get(site, Health)?.hp).toBe(181); // 1 to start, + 200 * 18 / 20
    w.step();
    expect(w.get(site, Construction)?.done).toBe(true);
    expect(w.get(site, Health)).toEqual({ hp: 200, max: 200 });
    expect(w.has(worker, Task)).toBe(false);
    expect(w.get(worker, Worker)?.job).toBeNull();
  });

  it('walk the workers up to a site first, and several add their work', () => {
    const { w } = setup(100);
    const a = spawnUnit(w, 'red', 'worker', { x: 11, y: 5 });
    const b = spawnUnit(w, 'red', 'worker', { x: 0, y: 5 });
    expect(
      applyOrder(w, {
        id: 1,
        faction: 'red',
        type: 'build',
        units: [a, b],
        target: { x: 5, y: 1 },
        building: 'barracks',
      }).ok,
    ).toBe(true);
    const site = w.query(Construction)[0] as Entity;
    for (let i = 0; i < 40 && !w.get(site, Construction)?.done; i++) w.step();
    expect(w.get(site, Construction)?.done).toBe(true);
    w.step(); // the worker that did not finish it drops its task on the next tick
    // Both took part: each stands next to the footprint (5..6, 1..2).
    for (const id of [a, b]) {
      const p = w.get(id, Position) as { x: number; y: number };
      expect(p.x >= 4 && p.x <= 7 && p.y >= 0 && p.y <= 3).toBe(true);
      expect(w.has(id, Task)).toBe(false);
    }
    const workers = new Set(
      w
        .events()
        .filter((e) => e.cause === 'construct' && e.component === 'Construction')
        .map((e) => e.tick),
    );
    expect(workers.size).toBeLessThan(10); // two workers, so fewer than 10 working ticks
  });

  it('end when another order takes the worker away, which leaves its job', () => {
    const { w } = setup(100);
    const worker = spawnUnit(w, 'red', 'worker', { x: 9, y: 5 });
    applyOrder(w, {
      id: 1,
      faction: 'red',
      type: 'build',
      units: [worker],
      target: { x: 3, y: 3 },
      building: 'barracks',
    });
    w.step();
    expect(
      applyOrder(w, { id: 2, faction: 'red', type: 'move', units: [worker], target: { x: 11, y: 5 } }).ok,
    ).toBe(true);
    expect(w.get(worker, Worker)?.job).toBeNull();
    expect(w.get(worker, Task)?.kind).toBe('move');
  });

  it('are refused, changing nothing, without enough resource or with blocked placement', () => {
    const { w } = setup(40);
    const worker = spawnUnit(w, 'red', 'worker', { x: 5, y: 3 });
    const soldier = spawnUnit(w, 'red', 'soldier', { x: 6, y: 3 });
    const node = w.spawn();
    w.add(node, Position, { x: 8, y: 0, z: 0 });
    w.add(node, Resource, { item: 'gold' });
    w.add(node, Inventory, { gold: 10 });
    const build = (target: { x: number; y: number }, extra: Record<string, unknown> = {}) => ({
      id: 3,
      faction: 'red',
      type: 'build',
      units: [worker],
      target,
      building: 'barracks',
      ...extra,
    });
    refused(
      w,
      build({ x: 5, y: 4 }),
      'order 3: faction "red" cannot afford barracks: needs 100 gold, has 40',
    );
    w.add(stockpileOf(w, 'red') as Entity, Inventory, { gold: 500 });
    refused(w, build({ x: 11, y: 0 }), 'a 2x2 building at (11, 0) does not fit on the 12x6 map');
    refused(w, build({ x: 8, y: 2 }), 'cell (9, 3) cannot be built on (impassable)');
    refused(w, build({ x: 1, y: 1 }), 'the footprint overlaps building 3');
    refused(w, build({ x: 7, y: 0 }), `the footprint overlaps resource node ${node}`);
    refused(
      w,
      build({ x: 5, y: 4 }, { building: 'tower' }),
      'building type "tower" is not in the world\'s RtsTypes',
    );
    refused(w, build({ x: 5, y: 4 }, { units: [soldier] }), `unit ${soldier} cannot build (no Worker)`);
    refused(w, build({ x: 5, y: 4 }, { faction: 'blue' }), `unit ${worker} belongs to "red", not "blue"`);
    refused(w, build({ x: 5, y: 4 }, { building: 7 }), 'order 3: building: ');
    expect(applyOrder(w, build({ x: 5, y: 4 })).ok).toBe(true);
  });
});

describe('train orders', () => {
  function withBarracks(goldLeft: number) {
    const { w, hall } = setup(goldLeft);
    const barracks = placeBuilding(w, 'red', 'barracks', { x: 6, y: 1 }, true);
    return { w, hall, barracks };
  }

  it('charge the cost and spawn the unit next to the building after its training ticks', () => {
    const { w, barracks } = withBarracks(150);
    const order = { faction: 'red', type: 'train', units: [barracks], target: 'soldier' };
    expect(applyOrder(w, { id: 1, ...order }).ok).toBe(true);
    expect(gold(w)).toBe(90);
    expect(w.get(barracks, Producer)?.queue).toEqual([{ unit: 'soldier', ticks: 8 }]);
    const units = () => w.query(Unit);
    for (let i = 0; i < 7; i++) w.step();
    expect(units()).toEqual([]);
    w.step();
    expect(units()).toHaveLength(1);
    const soldier = units()[0] as Entity;
    // South side first, west corner: the footprint is (6..7, 1..2), so (5, 3).
    expect(w.get(soldier, Position)).toEqual({ x: 5, y: 3, z: 0 });
    expect(w.get(soldier, Owner)).toEqual({ faction: 'red' });
    expect(w.get(soldier, Health)).toEqual({ hp: 30, max: 30 });
    expect(w.get(soldier, Unit)).toEqual({
      type: 'soldier',
      speed: 1,
      attack: 4,
      range: 1,
      cooldown: 2,
      sight: 5,
    });
    expect(w.has(soldier, Worker)).toBe(false);
    expect(
      w
        .events()
        .filter((e) => e.entity === soldier)
        .every((e) => e.cause === 'train'),
    ).toBe(true);
    expect(w.get(barracks, Producer)).toEqual({ trains: ['soldier'], queue: [], progress: 0 });
  });

  it('queue units one after another, and a hall trains workers that can build and gather', () => {
    const { w, hall, barracks } = withBarracks(1000);
    expect(
      applyOrder(w, { id: 1, faction: 'red', type: 'train', units: [barracks], target: 'soldier' }).ok,
    ).toBe(true);
    expect(
      applyOrder(w, { id: 2, faction: 'red', type: 'train', units: [barracks], target: 'soldier' }).ok,
    ).toBe(true);
    expect(applyOrder(w, { id: 3, faction: 'red', type: 'train', units: [hall], target: 'worker' }).ok).toBe(
      true,
    );
    expect(gold(w)).toBe(1000 - 120 - 50);
    const made: Record<number, string[]> = {};
    for (let i = 1; i <= 16; i++) {
      const before = new Set(w.query(Unit));
      w.step();
      const fresh = w.query(Unit).filter((id) => !before.has(id));
      if (fresh.length > 0) made[i] = fresh.map((id) => w.get(id, Unit)?.type as string);
    }
    expect(made).toEqual({ 6: ['worker'], 8: ['soldier'], 16: ['soldier'] });
    const worker = w.query(Worker)[0] as Entity;
    expect(w.get(worker, Worker)).toEqual({ job: null, rate: 2 });
    expect(w.get(worker, Gatherer)).toEqual({
      capacity: 3,
      ticks: 2,
      node: null,
      item: null,
      carry: 0,
      progress: 0,
    });
  });

  it('are refused, changing nothing, for unfinished, unable or unaffordable buildings', () => {
    const { w, hall, barracks } = withBarracks(100);
    const site = placeBuilding(w, 'red', 'barracks', { x: 6, y: 4 });
    const theirs = placeBuilding(w, 'blue', 'barracks', { x: 9, y: 0 }, true);
    const worker = spawnUnit(w, 'red', 'worker', { x: 4, y: 4 });
    const train = (units: number[], target = 'soldier') => ({
      id: 9,
      faction: 'red',
      type: 'train',
      units,
      target,
    });
    refused(w, train([barracks, barracks]), 'units must not repeat');
    refused(w, train([site]), `building ${site} is not finished or not standing`);
    refused(w, train([barracks], 'worker'), `building ${barracks} cannot train "worker"`);
    refused(w, train([hall], 'soldier'), `building ${hall} cannot train "soldier"`);
    refused(w, train([barracks], 'knight'), 'unit type "knight" is not in the world\'s RtsTypes');
    refused(w, train([theirs]), `building ${theirs} belongs to "blue", not "red"`);
    refused(w, train([worker]), `entity ${worker} cannot train (no Producer)`);
    refused(w, train([999]), 'building 999 does not exist');
    const second = placeBuilding(w, 'red', 'barracks', { x: 2, y: 3 }, true);
    refused(w, train([barracks, second]), 'faction "red" cannot afford 2 soldier: needs 120 gold, has 100');
    expect(applyOrder(w, train([barracks])).ok).toBe(true);
  });
});

describe('gathering', () => {
  function node(w: World, x: number, y: number, amount: number): Entity {
    const id = w.spawn();
    w.add(id, Position, { x, y, z: 0 });
    w.add(id, Resource, { item: 'gold' });
    w.add(id, Inventory, { gold: amount });
    return id;
  }

  it('raises the stockpile: carry loads to the drop-off, empty nodes go and the next is taken', () => {
    const { w } = setup(0);
    const a = node(w, 6, 0, 4);
    const b = node(w, 8, 4, 3);
    const worker = spawnUnit(w, 'red', 'worker', { x: 3, y: 2 });
    expect(applyOrder(w, { id: 1, faction: 'red', type: 'gather', units: [worker], target: a }).ok).toBe(
      true,
    );
    expect(w.get(worker, Gatherer)?.node).toBe(a);
    const seen: number[] = [];
    for (let i = 0; i < 200 && w.has(worker, Task); i++) {
      w.step();
      if (seen[seen.length - 1] !== gold(w)) seen.push(gold(w));
    }
    expect(w.has(worker, Task)).toBe(false);
    expect(w.alive(a)).toBe(false);
    expect(w.alive(b)).toBe(false);
    // Loads of 3, 1 (node a ran dry), then 3 from node b.
    expect(seen).toEqual([0, 3, 4, 7]);
    expect(w.get(worker, Gatherer)).toMatchObject({ carry: 0, item: 'gold' });
  });

  it('takes one item every gather ticks next to the node', () => {
    const { w } = setup(0);
    const n = node(w, 3, 2, 10);
    const worker = spawnUnit(w, 'red', 'worker', { x: 3, y: 3 });
    applyOrder(w, { id: 1, faction: 'red', type: 'gather', units: [worker], target: n });
    const carried: number[] = [];
    for (let i = 0; i < 6; i++) {
      w.step();
      carried.push(w.get(worker, Gatherer)?.carry as number);
    }
    expect(carried).toEqual([0, 1, 1, 2, 2, 3]);
    expect(w.get(n, Inventory)).toEqual({ gold: 7 });
    expect(w.get(worker, Task)?.target).toBe(3); // full: back to the hall (entity 3)
  });

  it('is refused, changing nothing, for non-nodes, non-gatherers and factions with no stockpile', () => {
    const { w, hall } = setup(0);
    const n = node(w, 6, 0, 4);
    const worker = spawnUnit(w, 'red', 'worker', { x: 3, y: 2 });
    const soldier = spawnUnit(w, 'red', 'soldier', { x: 4, y: 2 });
    const blue = spawnUnit(w, 'blue', 'worker', { x: 4, y: 4 });
    const gather = (units: number[], target: number, faction = 'red') => ({
      id: 4,
      faction,
      type: 'gather',
      units,
      target,
    });
    refused(w, gather([worker], hall), `gather target ${hall} is not a resource node`);
    refused(w, gather([soldier], n), `unit ${soldier} cannot gather (no Gatherer)`);
    refused(w, gather([blue], n, 'blue'), 'faction "blue" has no stockpile');
  });
});

describe('an economy run', () => {
  const unit = (type: string, faction: string, x: number, y: number) => {
    const t = TYPES.units[type] as RtsTypesData['units'][string];
    return {
      components: {
        Position: { x, y },
        Owner: { faction },
        Health: { hp: t.health, max: t.health },
        Unit: {
          type,
          speed: t.speed,
          attack: t.attack,
          range: t.range,
          cooldown: t.cooldown,
          sight: t.sight,
        },
        ...(t.work === null ? {} : { Worker: { job: null, rate: t.work } }),
        ...(t.gather === null
          ? {}
          : { Gatherer: { ...t.gather, node: null, item: null, carry: 0, progress: 0 } }),
      },
    };
  };
  /** The whole start as data: the types, red's hall and stockpile, two gold nodes, two workers, a blue soldier. */
  const SCENARIO = {
    format: 'worlds-within/scenario',
    version: 1,
    seed: 9,
    terrain: {
      legend: {
        '.': { name: 'ground', cost: 1, passable: true },
        '#': { name: 'rock', cost: 1, passable: false },
      },
      rows: ['............', '......#.....', '......#.....', '............', '............', '............'],
      elevation: [
        '000000000000',
        '000000000000',
        '000000000000',
        '000000000000',
        '000000000000',
        '000000000000',
      ],
    },
    entities: [
      { key: 'types', components: { RtsTypes: TYPES } },
      {
        key: 'hall',
        components: {
          Position: { x: 0, y: 0 },
          Owner: { faction: 'red' },
          Building: { kind: 'hall', w: 2, h: 2, dropoff: true },
          Health: { hp: 400, max: 400 },
          Producer: { trains: ['worker'], queue: [], progress: 0 },
          Stockpile: { faction: 'red' },
          Inventory: { gold: 300 },
        },
      },
      {
        key: 'a',
        components: { Position: { x: 8, y: 0 }, Resource: { item: 'gold' }, Inventory: { gold: 12 } },
      },
      {
        key: 'b',
        components: { Position: { x: 10, y: 4 }, Resource: { item: 'gold' }, Inventory: { gold: 9 } },
      },
      unit('worker', 'red', 2, 2),
      unit('worker', 'red', 3, 3),
      { components: { ...unit('soldier', 'blue', 11, 5).components, Health: { hp: 12, max: 30 } } },
    ],
  };
  // Ids: 1 terrain, 2 types, 3 hall, 4 and 5 nodes, 6 and 7 workers, 8 the blue soldier; then the
  // barracks site (9, order 2), the trained worker (10) and soldier (11).
  const ORDERS: Record<number, unknown[]> = {
    0: [
      { id: 1, faction: 'red', type: 'gather', units: [6], target: 4 },
      { id: 2, faction: 'red', type: 'build', units: [7], target: { x: 4, y: 3 }, building: 'barracks' },
    ],
    3: [{ id: 3, faction: 'red', type: 'train', units: [3], target: 'worker' }],
    12: [{ id: 4, faction: 'red', type: 'train', units: [9], target: 'soldier' }],
    15: [{ id: 5, faction: 'red', type: 'gather', units: [10, 7], target: 5 }],
    22: [{ id: 6, faction: 'red', type: 'attack', units: [11], target: 8 }],
  };
  const TICKS = 150;
  const start = () => worldFromScenario(SCENARIO, { components: COMPONENTS, systems: RTS_SYSTEMS });
  const stepWithOrders = (w: World): void => {
    for (const order of ORDERS[w.tick] ?? []) expect(applyOrder(w, order)).toMatchObject({ ok: true });
    w.step();
  };
  function run(): { hashes: string[]; w: World } {
    const w = start();
    const hashes: string[] = [];
    for (let i = 0; i < TICKS; i++) {
      stepWithOrders(w);
      hashes.push(hash(w));
    }
    return { hashes, w };
  }

  it('builds, trains, gathers and fights, with the same hashes and log on two runs', () => {
    const one = run();
    const two = run();
    expect(two.hashes).toEqual(one.hashes);
    expect(canonicalJson(two.w.events())).toBe(canonicalJson(one.w.events()));
    const w = one.w;
    expect(w.get(9, Construction)?.done).toBe(true);
    expect(w.get(10, Unit)?.type).toBe('worker');
    expect(w.alive(8)).toBe(false); // the trained soldier killed the blue one
    expect(w.alive(4)).toBe(false); // node a was gathered dry
    expect(w.alive(5)).toBe(false); // and node b
    // 300 - 100 (barracks) - 50 (worker) - 60 (soldier), plus all of nodes a and b.
    expect(gold(w)).toBe(90 + 12 + 9);
    for (const e of w.events())
      expect(e.cause).toMatch(/^(scenario|order:\d+|gather|construct|train|move|attack|death)$/);
  });

  it('saves and loads mid-construction and mid-training and steps on with the same hashes', () => {
    const whole = run().hashes;
    for (const saveAt of [0, 5, 14, 40, 77]) {
      const w = start();
      for (let i = 0; i < saveAt; i++) stepWithOrders(w);
      if (saveAt === 5) expect(w.get(9, Construction)?.done).toBe(false);
      if (saveAt === 14) {
        expect(w.get(9, Producer)?.queue).toHaveLength(1);
        expect(w.get(9, Producer)?.progress).toBeGreaterThan(0);
      }
      const text = canonicalJson(saveWorld(w));
      const loaded = loadWorld(JSON.parse(text) as unknown, { components: COMPONENTS, systems: RTS_SYSTEMS });
      expect(canonicalJson(saveWorld(loaded))).toBe(text);
      for (let i = saveAt; i < TICKS; i++) {
        stepWithOrders(loaded);
        expect(hash(loaded), `tick ${loaded.tick} after a load at ${saveAt}`).toBe(whole[i]);
      }
    }
  });
});
