import { describe, expect, it } from 'vitest';
import { Construction, Health, Inventory, Patrol, Position, STANDARD_COMPONENTS, Worker } from './components';
import { Hauler, SYSTEM_COMPONENTS, Walk, buildSystem, haulSystem, patrolSystem } from './systems';
import { Terrain, flatTerrain } from './terrain';
import { createWorld, type World } from './world';

const COMPONENTS = [...STANDARD_COMPONENTS, Terrain, ...SYSTEM_COMPONENTS];

/** A 6x1 strip: grass, except a cost-3 cell at x 2 with elevation 4. */
function strip(): World {
  const world = createWorld(1, { components: COMPONENTS, systems: [haulSystem, buildSystem, patrolSystem] });
  const t = flatTerrain(6, 1);
  world.add(world.spawn(), Terrain, {
    ...t,
    types: [...t.types, { name: 'mud', cost: 3, passable: true }],
    cells: [0, 0, 1, 0, 0, 0],
    elevation: [0, 0, 4, 0, 0, 0],
  });
  return world;
}

describe('patrolSystem and walking', () => {
  it("walks the waypoints in a loop, paying each cell's cost and standing at its elevation", () => {
    const world = strip();
    const id = world.spawn();
    world.add(id, Position, { x: 0, y: 0, z: 0 });
    world.add(id, Walk, { wait: 0 });
    world.add(id, Patrol, {
      waypoints: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
      index: 1,
    });
    const xs: number[] = [];
    for (let i = 0; i < 8; i++) {
      world.step();
      xs.push((world.get(id, Position) as { x: number }).x);
    }
    // x 1, then the mud cell (step + 2 waits), then x 3, x 4 (arrived), then back.
    expect(xs).toEqual([1, 2, 2, 2, 3, 4, 4, 3]);
    expect(world.get(id, Patrol)?.index).toBe(0);
    world.step();
    world.step();
    expect(world.get(id, Position)).toEqual({ x: 2, y: 0, z: 4 });
  });
});

describe('haulSystem and buildSystem', () => {
  function site(world: World, work: number) {
    const pile = world.spawn();
    world.add(pile, Position, { x: 0, y: 0, z: 0 });
    world.add(pile, Inventory, { wood: 4 });
    const hall = world.spawn();
    world.add(hall, Position, { x: 5, y: 0, z: 0 });
    world.add(hall, Construction, { kind: 'hall', progress: 0, work, done: false });
    world.add(hall, Health, { hp: 1, max: 10 });
    const worker = world.spawn();
    world.add(worker, Position, { x: 1, y: 0, z: 0 });
    world.add(worker, Worker, { job: null, rate: 2 });
    world.add(worker, Hauler, {
      item: 'wood',
      source: pile,
      capacity: 3,
      carry: 0,
      rest: 0,
      restOdds: 0,
      restTicks: 1,
    });
    return { pile, hall, worker };
  }

  it('takes the nearest unfinished building, fetches, carries and adds work', () => {
    const world = strip();
    const { pile, hall, worker } = site(world, 8);
    world.step();
    expect(world.get(worker, Worker)?.job).toBe(hall);
    expect(world.get(worker, Hauler)?.carry).toBe(3);
    expect(world.get(pile, Inventory)).toEqual({ wood: 1 });
    while (world.get(hall, Construction)?.progress === 0) world.step();
    expect(world.get(hall, Construction)).toEqual({ kind: 'hall', progress: 6, work: 8, done: false });
    expect(world.get(hall, Health)?.hp).toBe(7); // 10 * 6 / 8, rounded down
    for (let i = 0; i < 40; i++) world.step();
    expect(world.get(hall, Construction)).toEqual({ kind: 'hall', progress: 8, work: 8, done: true });
    expect(world.get(hall, Health)?.hp).toBe(10);
    expect(world.get(pile, Inventory)).toEqual({});
    // With no building left, the worker idles with no job.
    expect(world.get(worker, Worker)?.job).toBeNull();
  });

  it('rests at random through the world RNG, the same way every run', () => {
    const run = () => {
      const world = strip();
      const { worker } = site(world, 100);
      world.update(worker, Hauler, (h) => ({ ...h, restOdds: 3, restTicks: 4 }));
      const rests: number[] = [];
      for (let i = 0; i < 30; i++) {
        world.step();
        rests.push(world.get(worker, Hauler)?.rest as number);
      }
      return rests;
    };
    const rests = run();
    expect(rests.some((r) => r > 0)).toBe(true);
    expect(run()).toEqual(rests);
  });
});
