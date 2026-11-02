import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { canonicalJson } from '../core/headless';
import { defineComponent } from './component';
import { createWorld, type System, type World } from './world';

const Position = defineComponent('Position', z.strictObject({ x: z.int(), y: z.int() }));
const Health = defineComponent('Health', z.int().min(0));
const Tag = defineComponent('Tag', z.string());

/** Moves every positioned entity one random step. */
const wander: System = {
  name: 'wander',
  run(world) {
    for (const id of world.query(Position)) {
      const p = world.get(id, Position);
      if (!p) continue;
      p.x += world.rng.int(3) - 1;
      p.y += world.rng.int(3) - 1;
    }
  },
};

/** Hurts a random entity; at 0 health it is destroyed and a new one spawns. */
const strife: System = {
  name: 'strife',
  run(world) {
    const hurt = world.query(Health);
    if (hurt.length === 0) return;
    const id = world.rng.pick(hurt);
    const hp = (world.get(id, Health) ?? 0) - 1;
    if (hp > 0) {
      world.add(id, Health, hp);
      return;
    }
    world.destroy(id);
    const fresh = world.spawn();
    world.add(fresh, Position, { x: world.rng.int(10), y: world.rng.int(10) });
    world.add(fresh, Health, 3);
  },
};

function village(seed: number): World {
  const world = createWorld(seed, { components: [Position, Health, Tag], systems: [wander, strife] });
  for (let i = 0; i < 8; i++) {
    const id = world.spawn();
    world.add(id, Position, { x: i, y: 0 });
    world.add(id, Health, 2 + (i % 3));
    if (i % 2 === 0) world.add(id, Tag, `worker${i}`);
  }
  return world;
}

function run(seed: number, ticks: number): string[] {
  const world = village(seed);
  const out = [world.canonical()];
  for (let t = 0; t < ticks; t++) {
    world.step();
    out.push(world.canonical());
  }
  return out;
}

describe('createWorld', () => {
  it('gives identical snapshots for the same seed and systems', () => {
    expect(run(42, 200)).toEqual(run(42, 200));
  });

  it('diverges for a different seed', () => {
    expect(run(1, 50).at(-1)).not.toBe(run(2, 50).at(-1));
  });

  it('draws different RNG numbers for different seeds, and keeps the state in the snapshot', () => {
    const a = createWorld(1);
    const b = createWorld(2);
    expect([a.rng.next(), a.rng.next()]).not.toEqual([b.rng.next(), b.rng.next()]);
    expect(a.snapshot().rng).toBe(a.rng.state());
  });

  it('counts ticks as integers and runs systems in the declared order', () => {
    const order: string[] = [];
    const sys = (name: string): System => ({ name, run: (w) => order.push(`${name}@${w.tick}`) });
    const world = createWorld(0, { systems: [sys('b'), sys('a')] });
    world.addSystem(sys('c'));
    expect(world.tick).toBe(0);
    world.step();
    world.step();
    expect(world.tick).toBe(2);
    expect(world.systems()).toEqual(['b', 'a', 'c']);
    expect(order).toEqual(['b@0', 'a@0', 'c@0', 'b@1', 'a@1', 'c@1']);
  });

  it('hands out increasing ids, never reused, and iterates in ascending id order', () => {
    const world = createWorld(5, { components: [Position] });
    const ids = Array.from({ length: 6 }, () => world.spawn());
    expect(ids).toEqual([1, 2, 3, 4, 5, 6]);
    // Add components out of id order: queries must not follow insertion order.
    for (const id of [5, 2, 6, 1, 4, 3]) world.add(id, Position, { x: id, y: 0 });
    world.destroy(2);
    world.destroy(5);
    const seven = world.spawn();
    world.add(seven, Position, { x: 7, y: 0 });
    world.remove(1, Position);
    world.add(1, Position, { x: 1, y: 1 });
    expect(seven).toBe(7);
    expect(world.nextId).toBe(8);
    expect(world.entities()).toEqual([1, 3, 4, 6, 7]);
    expect(world.query(Position)).toEqual([1, 3, 4, 6, 7]);
    expect(world.snapshot().components['Position']?.map(([id]) => id)).toEqual([1, 3, 4, 6, 7]);
  });

  it('adds, gets, checks and removes components by definition or by name', () => {
    const world = createWorld(0, { components: [Position, Health] });
    const id = world.spawn();
    const data = { x: 1, y: 2 };
    world.add(id, Position, data);
    data.x = 99;
    expect(world.get(id, Position)).toEqual({ x: 1, y: 2 });
    expect(world.get(id, 'Position')).toEqual({ x: 1, y: 2 });
    expect(world.has(id, 'Position')).toBe(true);
    expect(world.has(id, Health)).toBe(false);
    world.add(id, 'Health', 4);
    expect(world.query(Position, 'Health')).toEqual([id]);
    expect(world.remove(id, Position)).toBe(true);
    expect(world.remove(id, Position)).toBe(false);
    expect(world.get(id, Position)).toBeUndefined();
    world.destroy(id);
    expect(world.alive(id)).toBe(false);
    expect(world.query(Health)).toEqual([]);
  });

  it('rejects data that fails the schema, unknown components and dead entities', () => {
    const world = createWorld(0, { components: [Position] });
    const id = world.spawn();
    expect(() => world.add(id, Position, { x: 1.5, y: 0 })).toThrow(/Position/);
    expect(() => world.add(id, 'Nope', 1)).toThrow(/unknown component "Nope"/);
    expect(() => world.add(99, Position, { x: 0, y: 0 })).toThrow(/no entity 99/);
    expect(() => world.registerComponent(Position)).toThrow(/already registered/);
    const Other = defineComponent('Position', z.int());
    expect(() => world.get(id, Other)).toThrow(/different definition/);
    expect(() => defineComponent('bad name', z.int())).toThrow(/component name/);
    expect(() => createWorld(1.5)).toThrow(/integer/);
  });

  it('snapshots the whole world as JSON-safe data, copied from the live state', () => {
    const world = village(9);
    world.step();
    const snap = world.snapshot();
    expect(() => canonicalJson(snap)).not.toThrow();
    expect(snap.tick).toBe(1);
    expect(snap.seed).toBe(9);
    expect(Object.keys(snap.components)).toEqual(['Health', 'Position', 'Tag']);
    const first = snap.components['Position']?.[0];
    if (first) (first[1] as { x: number }).x = 1000;
    expect(world.canonical()).toBe(canonicalJson(world.snapshot()));
    expect(world.canonical()).not.toContain('1000');
  });

  it('refuses a step started from inside a system', () => {
    const world = createWorld(0, {
      systems: [{ name: 'bad', run: (w) => w.step() }],
    });
    expect(() => world.step()).toThrow(/inside a system/);
    expect(world.tick).toBe(0);
  });
});
