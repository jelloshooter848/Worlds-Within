import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../core/headless';
import { Health, Member, Owner, Position, STANDARD_COMPONENTS, Squad, Worker } from './components';
import {
  Fate,
  MAP_COMPONENTS,
  capturePerson,
  fateOf,
  freePerson,
  injurePerson,
  killPerson,
  namedPeople,
  setFate,
  type FateResult,
} from './fate';
import { loadWorld, saveWorld } from './save';
import { Cooldown, Facing8, Target, Task, Unit, type UnitData } from './rts';
import { RTS_COMPONENTS, RTS_SYSTEMS, applyOrder } from './rts-orders';
import { worldFromScenario } from './scenario';
import { SYSTEM_SETS } from './system-sets';
import { Terrain, type TerrainData } from './terrain';
import { EventMember, TIME_COMPONENTS } from './time';
import { createWorld, type Entity, type System, type World } from './world';

const COMPONENTS = [...STANDARD_COMPONENTS, Terrain, ...RTS_COMPONENTS, ...TIME_COMPONENTS];
const hash = (world: World): string =>
  createHash('sha256').update(world.canonical()).digest('hex').slice(0, 16);

/** Flat ground, with `#` rock. */
function terrain(rows: string[]): TerrainData {
  return {
    width: (rows[0] as string).length,
    height: rows.length,
    types: [
      { name: 'ground', cost: 1, passable: true },
      { name: 'rock', cost: 1, passable: false },
    ],
    elevation: rows.flatMap((r) => [...r].map((c) => (c === '^' ? 2 : 0))),
    cells: rows.flatMap((r) => [...r].map((c) => (c === '#' ? 1 : 0))),
  };
}

const STATS: UnitData = { type: 'soldier', speed: 1, attack: 2, range: 1, cooldown: 1, sight: 5 };

function unit(
  w: World,
  faction: string,
  x: number,
  y: number,
  stats: Partial<UnitData> = {},
  hp = 10,
): Entity {
  const id = w.spawn();
  w.add(id, Position, { x, y, z: 0 });
  w.add(id, Owner, { faction });
  w.add(id, Health, { hp, max: hp });
  w.add(id, Unit, { ...STATS, ...stats });
  return id;
}

/** A red squad of 6 with a captain (Hale) and a hero (Mara) on the map, and a blue raider. */
function squadWorld(seed = 1) {
  const w = createWorld(seed, { components: COMPONENTS, systems: RTS_SYSTEMS });
  w.add(w.spawn(), Terrain, terrain(['......^.', '....#...', '........']));
  const squad = w.spawn();
  const captain = unit(w, 'red', 1, 1, { attack: 3 }, 12);
  const hero = unit(w, 'red', 2, 1);
  w.add(squad, Squad, { strength: 6, captain, members: [captain, hero] });
  w.add(captain, Member, { name: 'Hale', squad, role: 'captain' });
  w.add(hero, Member, { name: 'Mara', squad, role: 'hero' });
  w.add(hero, Task, { order: 1, kind: 'move', goal: { x: 7, y: 2 }, target: null, path: [], flow: false });
  w.add(hero, Cooldown, { move: 1, attack: 0 });
  w.add(hero, Facing8, { dir: 2 });
  w.add(hero, Worker, { job: null, rate: 1 });
  w.add(hero, EventMember, { event: 'siege' });
  const raider = unit(w, 'blue', 7, 0);
  return { w, squad, captain, hero, raider };
}

/** The result, which must be ok. */
function ok(result: FateResult) {
  if (!result.ok) throw new Error(`refused: ${result.code}: ${result.error}`);
  return result.fate;
}

describe('fates of named individuals', () => {
  it('reads active (no Fate) for a named person and null for anyone else', () => {
    const { w, hero, raider } = squadWorld();
    expect(fateOf(w, hero)).toEqual({ state: 'active', by: null, at: null, history: [] });
    expect(fateOf(w, raider)).toBeNull();
    expect(fateOf(w, 99)).toBeNull();
    expect(namedPeople(w).map((p) => [p.name, p.role, p.fate])).toEqual([
      ['Hale', 'captain', 'active'],
      ['Mara', 'hero', 'active'],
    ]);
  });

  it('injures: a label only, on the map, in the squad, hp untouched, logged under the cause', () => {
    const { w, squad, hero } = squadWorld();
    w.step();
    const fate = ok(injurePerson(w, hero, { cause: 'mission:raid', by: 'blue' }));
    expect(fate).toEqual({
      state: 'injured',
      by: 'blue',
      at: 1,
      held: null,
      history: [{ state: 'injured', by: 'blue', at: 1, cause: 'mission:raid' }],
    });
    expect(w.has(hero, Position)).toBe(true);
    expect(w.get(hero, Health)).toEqual({ hp: 10, max: 10 });
    expect(w.get(squad, Squad)?.members).toContain(hero);
    const logged = w.events(1).filter((e) => e.entity === hero && e.component === 'Fate');
    expect(logged.map((e) => [e.op, e.cause])).toEqual([['add', 'mission:raid']]);
  });

  it('captures: off the map and out of the squad, kept in the world with what frees them', () => {
    const { w, squad, captain, hero, raider } = squadWorld();
    ok(capturePerson(w, captain, { cause: 'mission:raid', by: 'blue' }));
    ok(capturePerson(w, hero, { cause: 'mission:raid', by: 'blue' }));
    for (const def of MAP_COMPONENTS) expect(w.has(hero, def), def.name).toBe(false);
    expect(w.alive(hero)).toBe(true);
    expect(w.get(hero, Member)).toEqual({ name: 'Mara', squad: null, role: 'hero' });
    expect(w.get(hero, Owner)).toEqual({ faction: 'red' });
    expect(w.get(hero, Health)).toEqual({ hp: 10, max: 10 });
    expect(w.get(squad, Squad)).toEqual({ strength: 4, captain: null, members: [] });
    expect(w.get(hero, Fate)?.held).toEqual({ unit: STATS, owner: { faction: 'red' } });
    expect(fateOf(w, captain)?.state).toBe('captured');
    // The raider finds no one to fight: the captured are not on the map.
    for (let i = 0; i < 20; i++) w.step();
    expect(w.has(raider, Target)).toBe(false);
    expect(w.get(hero, Health)?.hp).toBe(10);
  });

  it('frees a captured person onto an enterable cell with the Unit they had, in no squad', () => {
    const { w, squad, hero } = squadWorld();
    ok(capturePerson(w, hero, { cause: 'mission:raid', by: 'blue' }));
    w.step();
    const fate = ok(freePerson(w, hero, { x: 6, y: 0 }, 'mission:rescue', 'red'));
    expect(w.get(hero, Position)).toEqual({ x: 6, y: 0, z: 2 });
    expect(w.get(hero, Unit)).toEqual(STATS);
    expect(w.get(hero, Member)?.squad).toBeNull();
    expect(w.get(squad, Squad)?.members).not.toContain(hero);
    expect(fate.held).toBeNull();
    expect(fate.history.map((h) => [h.state, h.by, h.at, h.cause])).toEqual([
      ['captured', 'blue', 0, 'mission:raid'],
      ['freed', 'red', 1, 'mission:rescue'],
    ]);
    // A freed person can be orderable again and captured a second time (a new entry, not undone).
    expect(
      applyOrder(w, { id: 2, faction: 'red', type: 'move', units: [hero], target: { x: 7, y: 2 } }).ok,
    ).toBe(true);
    ok(capturePerson(w, hero, { cause: 'mission:raid2', by: 'blue' }));
    expect(w.get(hero, Fate)?.history.map((h) => h.state)).toEqual(['captured', 'freed', 'captured']);
  });

  it('kills: off the map and out of the squad, hp 0, kept as a dead record', () => {
    const { w, squad, captain, hero } = squadWorld();
    ok(injurePerson(w, captain, { cause: 'mission:raid' }));
    ok(killPerson(w, captain, { cause: 'mission:duel', by: 'blue' }));
    expect(w.alive(captain)).toBe(true);
    expect(w.get(captain, Health)).toEqual({ hp: 0, max: 12 });
    expect(w.has(captain, Position)).toBe(false);
    expect(w.get(squad, Squad)).toEqual({ strength: 5, captain: null, members: [hero] });
    expect(fateOf(w, captain)).toEqual({
      state: 'dead',
      by: 'blue',
      at: 0,
      history: [
        { state: 'injured', by: null, at: 0, cause: 'mission:raid' },
        { state: 'dead', by: 'blue', at: 0, cause: 'mission:duel' },
      ],
    });
    // The death system leaves the record as it is.
    const before = w.get(captain, Fate);
    w.step();
    expect(w.get(captain, Fate)).toBe(before);
  });

  it('kills a captured person (held cleared) and takes a carried tick when given one', () => {
    const { w, hero } = squadWorld();
    ok(setFate(w, hero, 'captured', { cause: 'carry', by: 'blue', at: 120 }));
    const fate = ok(setFate(w, hero, 'dead', { cause: 'mission:leave' }));
    expect(fate.held).toBeNull();
    expect(fate.history.map((h) => [h.state, h.at])).toEqual([
      ['captured', 120],
      ['dead', 0],
    ]);
  });

  describe('refusals change nothing', () => {
    const cases: [string, (s: ReturnType<typeof squadWorld>) => FateResult, string][] = [
      ['a missing entity', ({ w }) => injurePerson(w, 99, { cause: 'x' }), 'bad_id'],
      ['an unnamed unit', ({ w, raider }) => capturePerson(w, raider, { cause: 'x' }), 'not_named'],
      ['a bad faction id', ({ w, hero }) => capturePerson(w, hero, { cause: 'x', by: '9 lives' }), 'bad_id'],
      ['a bad tick', ({ w, hero }) => setFate(w, hero, 'injured', { cause: 'x', at: -1 }), 'bad_id'],
      ['freeing someone active', ({ w, hero }) => freePerson(w, hero, { x: 0, y: 0 }, 'x'), 'fate_final'],
      [
        'injuring someone captured',
        ({ w, hero }) => {
          ok(capturePerson(w, hero, { cause: 'setup' }));
          return injurePerson(w, hero, { cause: 'x' });
        },
        'fate_final',
      ],
      [
        'injuring someone injured',
        ({ w, hero }) => {
          ok(injurePerson(w, hero, { cause: 'setup' }));
          return injurePerson(w, hero, { cause: 'x' });
        },
        'fate_final',
      ],
      [
        'anything after death',
        ({ w, hero }) => {
          ok(killPerson(w, hero, { cause: 'setup' }));
          return freePerson(w, hero, { x: 0, y: 0 }, 'x');
        },
        'fate_final',
      ],
      [
        'freeing onto rock',
        ({ w, hero }) => {
          ok(capturePerson(w, hero, { cause: 'setup' }));
          return freePerson(w, hero, { x: 4, y: 1 }, 'x');
        },
        'bad_cell',
      ],
      [
        'freeing off the map',
        ({ w, hero }) => {
          ok(capturePerson(w, hero, { cause: 'setup' }));
          return freePerson(w, hero, { x: 8, y: 0 }, 'x');
        },
        'bad_cell',
      ],
      [
        'freeing with no cell',
        ({ w, hero }) => {
          ok(capturePerson(w, hero, { cause: 'setup' }));
          return setFate(w, hero, 'freed', { cause: 'x' });
        },
        'bad_cell',
      ],
    ];
    for (const [name, write, code] of cases) {
      it(`refuses ${name} (${code})`, () => {
        const s = squadWorld();
        // Any set-up write happens inside `write` before the refused one, so compare with a world
        // given the same writes: the refused one must leave no trace.
        const probe = squadWorld();
        write(probe);
        const result = write(s);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe(code);
          expect(result.error.length).toBeGreaterThan(0);
        }
        expect(s.w.canonical()).toBe(probe.w.canonical());
        expect(s.w.events().length).toBe(probe.w.events().length);
      });
    }

    it('refuses a write during a step (stepping) and throws on a bad cause', () => {
      const { w, hero } = squadWorld();
      let inside: FateResult | null = null;
      const probe: System = {
        name: 'probe',
        run: (world) => (inside = injurePerson(world, hero, { cause: 'x' })),
      };
      w.addSystem(probe);
      w.step();
      expect(inside).toMatchObject({ ok: false, code: 'stepping' });
      expect(fateOf(w, hero)?.state).toBe('active');
      expect(() => injurePerson(w, hero, { cause: ' x' })).toThrow(/cause/);
    });
  });

  it('registers Fate on first use in a world built without it, and loads it back', () => {
    const w = createWorld(2, { components: STANDARD_COMPONENTS });
    const id = w.spawn();
    w.add(id, Member, { name: 'Ada', squad: null, role: 'regular' });
    expect(Object.keys(w.snapshot().components)).not.toContain('Fate');
    ok(killPerson(w, id, { cause: 'scenario' }));
    expect(w.registered(Fate)).toBe(true);
    const back = loadWorld(saveWorld(w), { components: [...STANDARD_COMPONENTS, Fate] });
    expect(back.canonical()).toBe(w.canonical());
  });

  it('keeps worlds without fates hashing as before (Fate is left out until used)', () => {
    const plain = createWorld(4, { components: [...STANDARD_COMPONENTS, Terrain] });
    const withSet = createWorld(4, { components: SYSTEM_SETS.village.components });
    expect(Object.keys(withSet.snapshot().components)).not.toContain('Fate');
    expect(
      Object.keys(createWorld(4, { components: SYSTEM_SETS.rts.components }).snapshot().components),
    ).not.toContain('Fate');
    expect(plain.registered(Fate)).toBe(false);
    expect(withSet.registered(Fate)).toBe(true);
  });

  it('is registered by both system sets, so scenarios of either set can hold fates', () => {
    for (const systems of ['village', 'rts'] as const) {
      const w = worldFromScenario({
        format: 'worlds-within/scenario',
        version: 1,
        seed: 3,
        systems,
        terrain: {
          legend: { '.': { name: 'ground', cost: 1, passable: true } },
          rows: ['...'],
          elevation: ['000'],
        },
        entities: [],
      });
      expect(w.registered(Fate), systems).toBe(true);
    }
  });
});

describe('fates in a battle', () => {
  /** Red (a squad with a named captain and hero) against blue; at tick 5 blue captures the hero. */
  function battle(seed: number) {
    const w = createWorld(seed, { components: COMPONENTS, systems: RTS_SYSTEMS });
    w.add(w.spawn(), Terrain, terrain(['............', '............', '............']));
    const squad = w.spawn();
    const captain = unit(w, 'red', 1, 1, { attack: 1, cooldown: 3 }, 8);
    const hero = unit(w, 'red', 1, 0, { attack: 1, cooldown: 3 }, 8);
    const grunt = unit(w, 'red', 1, 2, { attack: 1, cooldown: 3 }, 6);
    w.add(squad, Squad, { strength: 5, captain, members: [captain, hero] });
    w.add(captain, Member, { name: 'Hale', squad, role: 'captain' });
    w.add(hero, Member, { name: 'Mara', squad, role: 'hero' });
    const blues = [0, 1, 2].map((y) => unit(w, 'blue', 10, y, { attack: 3, cooldown: 2 }, 12));
    const between = (world: World = w) => {
      if (world.tick === 0) {
        const order = { id: 1, faction: 'blue', type: 'attack', units: blues, target: captain };
        expect(applyOrder(world, order).ok).toBe(true);
      }
      if (world.tick === 5) ok(capturePerson(world, hero, { cause: 'mission:ambush', by: 'blue' }));
      if (world.tick === 30) ok(freePerson(world, hero, { x: 0, y: 0 }, 'mission:rescue', 'red'));
    };
    return { w, squad, captain, hero, grunt, between };
  }
  const TICKS = 60;

  function run(seed: number) {
    const b = battle(seed);
    const hashes: string[] = [];
    for (let i = 0; i < TICKS; i++) {
      b.between();
      b.w.step();
      hashes.push(hash(b.w));
    }
    return { ...b, hashes };
  }

  it('keeps a named captain killed in battle as dead, the captured hero out of the squad, then freed', () => {
    const { w, squad, captain, hero, grunt } = run(5);
    expect(fateOf(w, captain)?.state).toBe('dead');
    expect(w.get(captain, Fate)?.history).toEqual([
      { state: 'dead', by: null, at: expect.any(Number) as number, cause: 'death' },
    ]);
    expect(w.has(captain, Position)).toBe(false);
    expect(w.alive(grunt)).toBe(false);
    expect(fateOf(w, hero)?.history.map((h) => h.state)).toEqual(['captured', 'freed']);
    const s = w.get(squad, Squad);
    expect(s?.members).toEqual([]);
    expect(s?.captain).toBeNull();
    expect(s?.strength).toBe(3);
  });

  it('gives the same hashes on every run', () => {
    expect(run(5).hashes).toEqual(run(5).hashes);
    expect(canonicalJson(run(5).w.events())).toBe(canonicalJson(run(5).w.events()));
  });

  it('round-trips fates through save and load mid-way with equal hashes', () => {
    const whole = run(5).hashes;
    for (const saveAt of [0, 5, 6, 17, 31, 45]) {
      const b = battle(5);
      for (let i = 0; i < saveAt; i++) {
        b.between();
        b.w.step();
      }
      const text = canonicalJson(saveWorld(b.w));
      const loaded = loadWorld(JSON.parse(text) as unknown, { components: COMPONENTS, systems: RTS_SYSTEMS });
      expect(canonicalJson(saveWorld(loaded))).toBe(text);
      for (let i = saveAt; i < TICKS; i++) {
        b.between(loaded);
        loaded.step();
        expect(hash(loaded), `tick ${loaded.tick} after a load at ${saveAt}`).toBe(whole[i]);
      }
    }
  });

  it('a save holding a bad Fate is refused on load', () => {
    const { w, hero } = run(5);
    const save = JSON.parse(canonicalJson(saveWorld(w))) as {
      entities: { id: number; components: Record<string, { state: string }> }[];
    };
    const entry = save.entities.find((e) => e.id === hero)?.components['Fate'] as { state: string };
    entry.state = 'captured'; // held is null, and history ends in freed
    expect(() => loadWorld(save, { components: COMPONENTS, systems: RTS_SYSTEMS })).toThrow();
  });
});

describe('MAP_COMPONENTS', () => {
  it('lists every component that puts a person on the map or in play', () => {
    expect(MAP_COMPONENTS.map((c) => c.name)).toEqual([
      'Position',
      'Unit',
      'Task',
      'Target',
      'Cooldown',
      'Facing8',
      'Worker',
      'Gatherer',
      'EventMember',
    ]);
  });
});
