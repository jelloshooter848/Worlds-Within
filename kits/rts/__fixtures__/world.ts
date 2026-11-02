/**
 * Test fixtures: tiny world snapshots in the shape `World.snapshot()` gives (tests only). A field
 * battle 8 x 6 cells: red (the player) at the west with a hall, a worker and two soldiers (one a
 * hero), blue at the east with a barracks being built and two soldiers, a gold node in between.
 */

type Rows = [number, unknown][];

export interface FixtureOptions {
  tick?: number;
  extra?: Record<string, Rows>;
}

export const TYPES = {
  units: {
    worker: {
      health: 20,
      speed: 2,
      attack: 1,
      range: 1,
      cooldown: 3,
      sight: 4,
      cost: { gold: 50 },
      trainTicks: 12,
      work: 2,
      gather: { capacity: 3, ticks: 2 },
    },
    soldier: {
      health: 30,
      speed: 2,
      attack: 4,
      range: 1,
      cooldown: 3,
      sight: 5,
      cost: { gold: 60 },
      trainTicks: 16,
      work: null,
      gather: null,
    },
  },
  buildings: {
    hall: { health: 400, size: { w: 2, h: 2 }, work: 100, cost: {}, trains: ['worker'], dropoff: true },
    barracks: {
      health: 200,
      size: { w: 2, h: 2 },
      work: 30,
      cost: { gold: 100 },
      trains: ['soldier'],
      dropoff: false,
    },
  },
};

const unit = (type: string) => ({ type, speed: 2, attack: 4, range: 1, cooldown: 3, sight: 5 });

/** Entity ids: 1 terrain, 2 types, 3 hall (red), 4 gold, 5 worker, 6 soldier, 7 hero, 8 barracks (blue site), 9-10 blue soldiers. */
export function battleSnapshot(opts: FixtureOptions = {}) {
  const components: Record<string, Rows> = {
    Terrain: [
      [
        1,
        {
          width: 8,
          height: 6,
          types: [
            { name: 'rock', cost: 1, passable: false },
            { name: 'ground', cost: 1, passable: true },
          ],
          elevation: new Array(48).fill(0),
          cells: Array.from({ length: 48 }, (_, i) => (i === 19 || i === 27 ? 0 : 1)),
        },
      ],
    ],
    RtsTypes: [[2, TYPES]],
    Position: [
      [3, { x: 0, y: 0, z: 0 }],
      [4, { x: 4, y: 0, z: 0 }],
      [5, { x: 2, y: 1, z: 0 }],
      [6, { x: 1, y: 3, z: 0 }],
      [7, { x: 2, y: 3, z: 0 }],
      [8, { x: 6, y: 0, z: 0 }],
      [9, { x: 6, y: 4, z: 0 }],
      [10, { x: 7, y: 4, z: 0 }],
    ],
    Owner: [
      [3, { faction: 'red' }],
      [5, { faction: 'red' }],
      [6, { faction: 'red' }],
      [7, { faction: 'red' }],
      [8, { faction: 'blue' }],
      [9, { faction: 'blue' }],
      [10, { faction: 'blue' }],
    ],
    Health: [
      [3, { hp: 400, max: 400 }],
      [5, { hp: 20, max: 20 }],
      [6, { hp: 30, max: 30 }],
      [7, { hp: 15, max: 30 }],
      [8, { hp: 1, max: 200 }],
      [9, { hp: 30, max: 30 }],
      [10, { hp: 30, max: 30 }],
    ],
    Unit: [
      [5, unit('worker')],
      [6, unit('soldier')],
      [7, unit('soldier')],
      [9, unit('soldier')],
      [10, unit('soldier')],
    ],
    Facing8: [
      [6, { dir: 1 }],
      [9, { dir: 6 }],
    ],
    Task: [[9, { order: 3, kind: 'move', goal: { x: 3, y: 4 }, target: null, path: [], flow: false }]],
    Target: [[6, { entity: 9 }]],
    Cooldown: [[9, { move: 2, attack: 0 }]],
    Worker: [[5, { job: null, rate: 2 }]],
    Gatherer: [[5, { capacity: 3, ticks: 2, node: 4, item: 'gold', carry: 2, progress: 0 }]],
    Member: [[7, { name: 'Ada', squad: null, role: 'hero' }]],
    Building: [
      [3, { kind: 'hall', w: 2, h: 2, dropoff: true }],
      [8, { kind: 'barracks', w: 2, h: 2, dropoff: false }],
    ],
    Construction: [[8, { kind: 'barracks', progress: 15, work: 30, done: false }]],
    Producer: [
      [3, { trains: ['worker'], queue: [{ unit: 'worker', ticks: 12 }], progress: 3 }],
      [8, { trains: ['soldier'], queue: [], progress: 0 }],
    ],
    Resource: [[4, { item: 'gold' }]],
    Inventory: [
      [3, { gold: 120 }],
      [4, { gold: 30 }],
    ],
    Stockpile: [[3, { faction: 'red' }]],
    ...(opts.extra ?? {}),
  };
  return {
    seed: 1,
    tick: opts.tick ?? 0,
    nextId: 11,
    rng: 1,
    entities: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    components,
  };
}
