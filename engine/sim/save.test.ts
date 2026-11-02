import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../core/headless';
import { Health, Inventory, Owner, Position, STANDARD_COMPONENTS, inventoryAdd } from './components';
import type { LogOptions } from './events';
import { SAVE_FORMAT, SaveError, loadWorld, saveWorld } from './save';
import { Terrain, flatTerrain } from './terrain';
import { createWorld, type System, type World } from './world';

/** Moves every positioned entity one random step and gathers wood now and then. */
const wander: System = {
  name: 'wander',
  run(world) {
    for (const id of world.query(Position)) {
      const dir = world.rng.int(4);
      world.update(id, Position, (p) => ({
        x: p.x + (dir === 0 ? 1 : dir === 1 ? -1 : 0),
        y: p.y + (dir === 2 ? 1 : dir === 3 ? -1 : 0),
        z: p.z,
      }));
      if (world.rng.int(3) === 0) inventoryAdd(world, id, 'wood', 1);
    }
  },
};

/** Hurts a random entity; at 0 hp it is destroyed and a new one spawns. */
const strife: System = {
  name: 'strife',
  run(world) {
    const hurt = world.query(Health);
    if (hurt.length === 0) return;
    const id = world.rng.pick(hurt);
    const h = world.get(id, Health) as { hp: number; max: number };
    if (h.hp > 1) {
      world.add(id, Health, { hp: h.hp - 1, max: h.max });
      return;
    }
    world.destroy(id);
    const fresh = world.spawn();
    world.add(fresh, Position, { x: world.rng.int(10), y: world.rng.int(10), z: 0 });
    world.add(fresh, Health, { hp: 3, max: 3 });
    world.add(fresh, Inventory, {});
  },
};

const SYSTEMS = [wander, strife];
const COMPONENTS = [...STANDARD_COMPONENTS, Terrain];

function village(seed: number, log?: LogOptions): World {
  const world = createWorld(seed, {
    components: COMPONENTS,
    systems: SYSTEMS,
    ...(log ? { log } : {}),
  });
  world.withCause('scenario', (w) => {
    const ground = w.spawn();
    const t = flatTerrain(4, 3);
    w.add(ground, Terrain, { ...t, elevation: t.elevation.map((_, i) => i % 3) });
    for (let i = 0; i < 4; i++) {
      const id = w.spawn();
      w.add(id, Position, { x: i, y: 0, z: 0 });
      w.add(id, Health, { hp: 2 + i, max: 5 });
      w.add(id, Owner, { faction: 'village' });
      w.add(id, Inventory, { stone: i + 1 });
    }
  });
  return world;
}

const load = (json: unknown) => loadWorld(json, { components: COMPONENTS, systems: SYSTEMS });
/** The save as it would go through a file: canonical text, parsed back. */
const viaText = (world: World) => JSON.parse(canonicalJson(saveWorld(world))) as unknown;

describe('saveWorld / loadWorld', () => {
  it('round-trips to byte-identical canonical JSON', () => {
    const world = village(11);
    for (let i = 0; i < 25; i++) world.step();
    const text = canonicalJson(saveWorld(world));
    const back = load(JSON.parse(text));
    expect(canonicalJson(saveWorld(back))).toBe(text);
    expect(back.canonical()).toBe(world.canonical());
  });

  it('writes entities in id order with their components, and the header fields', () => {
    const world = village(3);
    world.step();
    const save = saveWorld(world) as Record<string, unknown>;
    expect(save.format).toBe(SAVE_FORMAT);
    expect(save.version).toBe(1);
    const ids = (save.entities as { id: number }[]).map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(save.components).toEqual(COMPONENTS.map((c) => c.name).sort());
    expect(save.systems).toEqual(['wander', 'strife']);
    const first = (save.entities as { components: Record<string, unknown> }[])[0];
    expect(Object.keys(first?.components ?? {})).toEqual(['Terrain']);
  });

  it('keeps RNG state, nextId, tick and the event log', () => {
    const world = village(5);
    for (let i = 0; i < 40; i++) world.step();
    const back = load(viaText(world));
    expect(back.tick).toBe(world.tick);
    expect(back.nextId).toBe(world.nextId);
    expect(back.rng.state()).toBe(world.rng.state());
    expect(back.seed).toBe(world.seed);
    expect(canonicalJson(back.events())).toBe(canonicalJson(world.events()));
    expect(back.events().length).toBeGreaterThan(0);
  });

  it('continues with the same snapshots as the uninterrupted world', () => {
    for (const n of [0, 1, 17, 60]) {
      const original = village(42);
      for (let i = 0; i < n; i++) original.step();
      const loaded = load(viaText(original));
      for (let i = 0; i < 80; i++) {
        original.step();
        loaded.step();
        expect(loaded.canonical()).toBe(original.canonical());
      }
      expect(canonicalJson(loaded.events())).toBe(canonicalJson(original.events()));
    }
  });

  it('never reuses an id after load, even when the newest entities were destroyed', () => {
    const world = village(1);
    const a = world.spawn();
    const b = world.spawn();
    world.destroy(b);
    world.destroy(a);
    const back = load(viaText(world));
    expect(back.nextId).toBe(b + 1);
    expect(back.spawn()).toBe(b + 1);
  });

  it('keeps the log retention, and a disabled log stays disabled', () => {
    const trimmed = village(9, { ticks: 2 });
    for (let i = 0; i < 10; i++) trimmed.step();
    const back = load(viaText(trimmed));
    for (let i = 0; i < 10; i++) {
      trimmed.step();
      back.step();
    }
    expect(canonicalJson(back.events())).toBe(canonicalJson(trimmed.events()));
    expect(back.events().every((c) => c.tick >= back.tick - 2)).toBe(true);

    const off = village(9, { enabled: false });
    off.step();
    const save = viaText(off) as { log: unknown };
    expect(save.log).toEqual({ enabled: false, ticks: null, events: [] });
    const offBack = load(save);
    offBack.step();
    expect(offBack.events()).toEqual([]);
  });

  it('loads data that is frozen like any stored data', () => {
    const back = load(viaText(village(2)));
    const pos = back.get(2, Position) as { x: number };
    expect(() => {
      pos.x = 9;
    }).toThrow();
  });

  it('refuses to save during a step', () => {
    const world = createWorld(1, { systems: [{ name: 'saver', run: (w) => saveWorld(w) }] });
    expect(() => world.step()).toThrow('during a step');
  });
});

describe('loadWorld rejects bad saves, naming the field', () => {
  const good = () => viaText(village(4)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  const rejects = (save: unknown, path: string, words?: string) => {
    let error: unknown;
    try {
      load(save);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SaveError);
    const issues = (error as SaveError).issues;
    expect(issues.map((i) => i.path)).toContain(path);
    expect((error as Error).message).toContain(path === '' ? '(file)' : `${path}:`);
    if (words) expect(issues.find((i) => i.path === path)?.message).toContain(words);
  };

  it('a file that is not a save', () => {
    rejects('nope', '');
    rejects({ ...good(), format: 'other' }, 'format');
    rejects({ ...good(), version: 2 }, 'version');
  });

  it('bad header fields', () => {
    rejects({ ...good(), tick: -1 }, 'tick');
    rejects({ ...good(), rng: 0 }, 'rng');
    rejects({ ...good(), seed: 1.5 }, 'seed');
    const { nextId: _drop, ...noNext } = good();
    rejects(noNext, 'nextId');
    rejects({ ...good(), extra: 1 }, '');
  });

  it('entity ids out of order or not below nextId', () => {
    const s = good();
    s.entities[1].id = s.entities[0].id;
    rejects(s, 'entities.1.id', 'above the previous id');
    const t = good();
    t.nextId = 2;
    rejects(t, 'entities.1.id', 'below nextId');
  });

  it('component data that breaks its schema', () => {
    const s = good();
    s.entities[1].components.Health.hp = -1;
    rejects(s, 'entities.1.components.Health.hp');
    const t = good();
    t.entities[1].components.Position.x = 'left';
    rejects(t, 'entities.1.components.Position.x');
  });

  it('unknown components', () => {
    const s = good();
    s.entities[1].components.Magic = 1;
    rejects(s, 'entities.1.components.Magic', 'components list');
    const loader = () =>
      loadWorld(good(), {
        components: COMPONENTS.filter((c) => c.name !== 'Owner'),
        systems: SYSTEMS,
      });
    expect(loader).toThrow(/components\.\d+: component "Owner" is not in the components given/);
  });

  it('systems that differ from the saved ones', () => {
    expect(() => loadWorld(good(), { components: COMPONENTS, systems: [strife, wander] })).toThrow(
      /systems: the save ran \["wander","strife"\]/,
    );
  });

  it('a malformed event log', () => {
    const s = good();
    s.log.events[0].op = 'teleport';
    rejects(s, 'log.events.0.op');
    const t = good();
    delete t.log.events[1].component;
    rejects(t, 'log.events.1.component', 'needs component');
    const u = good();
    u.log.events[0].tick = 1000;
    rejects(u, 'log.events.0.tick', "after the world's tick");
    const v = good();
    v.log.enabled = false;
    rejects(v, 'log.events', 'must be empty');
  });
});
