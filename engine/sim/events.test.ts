import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { canonicalJson } from '../core/headless';
import { defineComponent } from './component';
import type { Change } from './events';
import { createWorld, type System, type World } from './world';

const Position = defineComponent('Position', z.strictObject({ x: z.int(), y: z.int() }));
const Health = defineComponent('Health', z.int().min(0));

/** Moves every positioned entity one random step right or down. */
const drift: System = {
  name: 'drift',
  run(world) {
    for (const id of world.query(Position)) {
      const step = world.rng.int(2);
      world.update(id, Position, (p) => ({ x: p.x + step, y: p.y + 1 - step }));
    }
  },
};

/** Hurts a random entity; at 0 it is destroyed and a new one spawns. */
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
    world.add(fresh, Health, 2);
  },
};

function village(seed: number): World {
  const world = createWorld(seed, { components: [Position, Health], systems: [drift, strife] });
  world.withCause('scenario', (w) => {
    for (let i = 0; i < 5; i++) {
      const id = w.spawn();
      w.add(id, Position, { x: i, y: 0 });
      w.add(id, Health, 1 + (i % 3));
    }
  });
  return world;
}

/** The log after `ticks` steps, with an order between ticks every 7 ticks. */
function runLog(seed: number, ticks: number): string {
  const world = village(seed);
  for (let t = 0; t < ticks; t++) {
    if (t % 7 === 3) {
      const target = world.query(Position)[0];
      if (target !== undefined) world.withCause(`order:${t}`, (w) => w.add(target, Position, { x: 0, y: 0 }));
    }
    world.step();
  }
  return canonicalJson(world.events());
}

describe('event log', () => {
  it('attributes a change made in a step to the system that made it', () => {
    const world = village(3);
    world.step();
    const changes = world.events(0).filter((c) => c.cause !== 'scenario');
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes) {
      expect(c.tick).toBe(0);
      expect(['drift', 'strife']).toContain(c.cause);
      if (c.component === 'Position' && c.op === 'set') expect(c.cause).toBe('drift');
      if (c.component === 'Health') expect(c.cause).toBe('strife');
    }
    expect(changes.some((c) => c.cause === 'drift')).toBe(true);
  });

  it('records each op with its data: spawn, add, set, remove and destroy', () => {
    const world = createWorld(0, { components: [Position, Health] });
    const id = world.withCause('scenario', (w) => {
      const e = w.spawn();
      w.add(e, Position, { x: 1, y: 2 });
      w.add(e, Health, 3);
      return e;
    });
    world.add(id, Position, { x: 2, y: 2 });
    world.remove(id, Health);
    expect(world.remove(id, Health)).toBe(false); // nothing removed, nothing logged
    world.withCause('order:9', (w) => w.destroy(id));
    expect(world.events()).toEqual([
      { tick: 0, cause: 'scenario', op: 'spawn', entity: id },
      { tick: 0, cause: 'scenario', op: 'add', entity: id, component: 'Position', value: { x: 1, y: 2 } },
      { tick: 0, cause: 'scenario', op: 'add', entity: id, component: 'Health', value: 3 },
      {
        tick: 0,
        cause: 'external',
        op: 'set',
        entity: id,
        component: 'Position',
        before: { x: 1, y: 2 },
        value: { x: 2, y: 2 },
      },
      { tick: 0, cause: 'external', op: 'remove', entity: id, component: 'Health', before: 3 },
      { tick: 0, cause: 'order:9', op: 'remove', entity: id, component: 'Position', before: { x: 2, y: 2 } },
      { tick: 0, cause: 'order:9', op: 'destroy', entity: id },
    ]);
  });

  it('records a change between ticks at once, with its cause and the tick it applies to', () => {
    const world = village(5);
    world.step();
    world.step();
    const before = world.events().length;
    const target = world.query(Position)[0] as number;
    world.withCause('order:42', (w) => w.add(target, Position, { x: 9, y: 9 }));
    const added = world.events().slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      tick: 2,
      cause: 'order:42',
      op: 'set',
      entity: target,
      value: { x: 9, y: 9 },
    });
    expect(world.cause).toBe('external');
    // The order comes before tick 2's own system changes, which carry tick 2 as well.
    world.step();
    const tick2 = world.events(2);
    expect(tick2[0]?.cause).toBe('order:42');
    expect(tick2.slice(1).every((c) => c.cause === 'drift' || c.cause === 'strife')).toBe(true);
  });

  it("keeps a step's changes out of the log until the tick commits", () => {
    const seen: number[] = [];
    const peek: System = {
      name: 'peek',
      run(w) {
        const id = w.spawn();
        w.add(id, Health, 1);
        seen.push(w.events(w.tick).length);
      },
    };
    const world = createWorld(0, { components: [Health], systems: [peek] });
    world.step();
    expect(seen).toEqual([0]);
    expect(world.events(0).map((c) => c.op)).toEqual(['spawn', 'add']);
    expect(world.events(0).every((c) => c.cause === 'peek' && c.tick === 0)).toBe(true);
  });

  it('drops the staged changes of a step that throws', () => {
    const world = createWorld(0, {
      components: [Health],
      systems: [
        { name: 'ok', run: (w) => void w.spawn() },
        {
          name: 'boom',
          run: () => {
            throw new Error('boom');
          },
        },
      ],
    });
    expect(() => world.step()).toThrow('boom');
    expect(world.tick).toBe(0);
    expect(world.events()).toEqual([]);
    expect(world.cause).toBe('external');
  });

  it('is identical across two runs with the same seed, and JSON-safe', () => {
    const a = runLog(11, 300);
    expect(a).toBe(runLog(11, 300));
    expect(a).not.toBe(runLog(12, 300));
    expect(JSON.parse(a)).toEqual(JSON.parse(JSON.stringify(JSON.parse(a))));
    expect(a).toContain('"cause":"order:3"');
  });

  it('filters by tick with events(sinceTick)', () => {
    const world = village(2);
    for (let t = 0; t < 5; t++) world.step();
    const all = world.events();
    expect(world.events(0)).toEqual(all);
    expect(world.events(3)).toEqual(all.filter((c) => c.tick >= 3));
    expect(world.events(99)).toEqual([]);
    expect(() => world.events(1.5)).toThrow(/integer/);
  });

  it('trims to the last log.ticks ticks, or records nothing when disabled', () => {
    const world = createWorld(1, { components: [Position], systems: [drift], log: { ticks: 2 } });
    const id = world.spawn();
    world.add(id, Position, { x: 0, y: 0 });
    for (let t = 0; t < 10; t++) world.step();
    const ticks = [...new Set(world.events().map((c: Change) => c.tick))];
    expect(ticks).toEqual([8, 9]);

    const quiet = createWorld(1, { components: [Position], systems: [drift], log: { enabled: false } });
    quiet.add(quiet.spawn(), Position, { x: 0, y: 0 });
    quiet.step();
    expect(quiet.events()).toEqual([]);
    expect(() => createWorld(0, { log: { ticks: -1 } })).toThrow(/log.ticks/);
  });

  it('stores frozen data, so changes cannot bypass the log', () => {
    const world = createWorld(0, { components: [Position] });
    const id = world.spawn();
    world.add(id, Position, { x: 1, y: 1 });
    const p = world.get(id, Position) as { x: number };
    expect(() => {
      p.x = 5;
    }).toThrow(TypeError);
    expect(world.get(id, Position)).toEqual({ x: 1, y: 1 });
    expect(() => world.update(id, Health, (h) => h)).toThrow(/unknown component/);
  });

  it('keeps causes explicit: withCause only between ticks, and non-empty', () => {
    const world = createWorld(0, {
      systems: [{ name: 'sneaky', run: (w) => w.withCause('order:1', () => w.spawn()) }],
    });
    expect(() => world.step()).toThrow(/inside a step/);
    expect(() => world.withCause('', () => 0)).toThrow(/cause/);
    expect(world.withCause('load', (w) => w.cause)).toBe('load');
    expect(() => world.addSystem({ name: ' padded', run: () => undefined })).toThrow(/cause/);
  });
});
