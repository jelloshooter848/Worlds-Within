import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../core/headless';
import { Health, Member, Owner, Position, STANDARD_COMPONENTS, Squad } from './components';
import { loadWorld, saveWorld } from './save';
import {
  Cooldown,
  Facing8,
  RTS_COMPONENTS,
  RTS_SYSTEMS,
  Target,
  Task,
  Unit,
  applyOrder,
  facingOf,
  inRange,
  type UnitData,
} from './rts';
import { Terrain, moveCost, type TerrainData } from './terrain';
import { createWorld, type Entity, type World } from './world';

const COMPONENTS = [...STANDARD_COMPONENTS, Terrain, ...RTS_COMPONENTS];
const hash = (world: World): string =>
  createHash('sha256').update(world.canonical()).digest('hex').slice(0, 16);

/** Terrain from rows: `.` ground (cost 1), `,` mud (cost 2), `#` rock (impassable). */
function terrain(rows: string[]): TerrainData {
  const chars = ['.', ',', '#'];
  return {
    width: (rows[0] as string).length,
    height: rows.length,
    types: [
      { name: 'ground', cost: 1, passable: true },
      { name: 'mud', cost: 2, passable: true },
      { name: 'rock', cost: 1, passable: false },
    ],
    elevation: rows.flatMap((r) => [...r].map(() => 0)),
    cells: rows.flatMap((r) => [...r].map((c) => chars.indexOf(c))),
  };
}

function world(rows: string[], seed = 1): World {
  const w = createWorld(seed, { components: COMPONENTS, systems: RTS_SYSTEMS });
  w.add(w.spawn(), Terrain, terrain(rows));
  return w;
}

const STATS: UnitData = { speed: 1, attack: 2, range: 1, cooldown: 1, sight: 5 };

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

const at = (w: World, id: Entity) => {
  const p = w.get(id, Position) as { x: number; y: number };
  return { x: p.x, y: p.y };
};

/** Step until `done` (at most `max` ticks), recording each unit position of `id`. */
function stepUntil(w: World, done: () => boolean, max = 200, track?: Entity): { x: number; y: number }[] {
  const trail: { x: number; y: number }[] = [];
  for (let i = 0; i < max && !done(); i++) {
    w.step();
    if (track !== undefined && w.alive(track)) trail.push(at(w, track));
  }
  expect(done()).toBe(true);
  return trail;
}

// A wall down x 3 with one gap at the bottom.
const WALLED = ['...#...', '...#...', '...#...', '...#...', '.......'];

describe('move orders', () => {
  it('walk a unit to the goal around obstacles, then drop the task', () => {
    const w = world(WALLED);
    const id = unit(w, 'red', 1, 1);
    const result = applyOrder(w, {
      id: 1,
      faction: 'red',
      type: 'move',
      units: [id],
      target: { x: 5, y: 1 },
    });
    expect(result.ok).toBe(true);
    expect(w.get(id, Task)?.kind).toBe('move');
    const t = w.get(1, Terrain) as TerrainData;
    const trail = stepUntil(w, () => !w.has(id, Task), 50, id);
    expect(at(w, id)).toEqual({ x: 5, y: 1 });
    for (const cell of trail) expect(moveCost(t, cell.x, cell.y)).not.toBeNull();
    // Through the gap: it must pass row 4 at x 3.
    expect(trail).toContainEqual({ x: 3, y: 4 });
    // It faces the way of its last step.
    const moved = trail.filter((c, i) => i === 0 || c.x !== trail[i - 1]?.x || c.y !== trail[i - 1]?.y);
    const from = moved[moved.length - 2] as { x: number; y: number };
    const to = moved[moved.length - 1] as { x: number; y: number };
    expect(w.get(id, Facing8)).toEqual({ dir: facingOf(to.x - from.x, to.y - from.y) });
  });

  it('takes speed ticks per straight cell, scaled by the cell cost and for diagonals', () => {
    const w = world(['..,..']);
    const id = unit(w, 'red', 0, 0, { speed: 2 });
    applyOrder(w, { id: 1, faction: 'red', type: 'move', units: [id], target: { x: 4, y: 0 } });
    const trail = stepUntil(w, () => !w.has(id, Task), 50, id);
    // x 1 (2 ticks), the mud cell x 2 (4 ticks), x 3 (2 ticks), x 4 (2 ticks), then the arrival tick.
    expect(trail.map((c) => c.x)).toEqual([1, 1, 2, 2, 2, 2, 3, 3, 4, 4, 4]);
    expect(w.has(id, Cooldown)).toBe(false);
  });

  it('moves a group of four or more on one shared flow field', () => {
    const w = world(WALLED);
    const ids = [unit(w, 'red', 0, 0), unit(w, 'red', 0, 1), unit(w, 'red', 1, 0), unit(w, 'red', 1, 1)];
    applyOrder(w, { id: 1, faction: 'red', type: 'move', units: ids, target: { x: 6, y: 0 } });
    expect(w.get(ids[0] as Entity, Task)?.flow).toBe(true);
    stepUntil(w, () => ids.every((id) => !w.has(id, Task)), 60);
    for (const id of ids) expect(at(w, id)).toEqual({ x: 6, y: 0 });
  });

  it('drops the task when no way leads to the goal', () => {
    const w = world(['..#..']);
    const id = unit(w, 'red', 0, 0);
    expect(
      applyOrder(w, { id: 1, faction: 'red', type: 'move', units: [id], target: { x: 4, y: 0 } }).ok,
    ).toBe(true);
    w.step();
    expect(w.has(id, Task)).toBe(false);
    expect(at(w, id)).toEqual({ x: 0, y: 0 });
  });

  it('stop drops the task and the target', () => {
    const w = world(['.......']);
    const id = unit(w, 'red', 0, 0);
    applyOrder(w, { id: 1, faction: 'red', type: 'move', units: [id], target: { x: 6, y: 0 } });
    w.step();
    expect(applyOrder(w, { id: 2, faction: 'red', type: 'stop', units: [id] }).ok).toBe(true);
    expect(w.has(id, Task)).toBe(false);
    w.step();
    expect(at(w, id)).toEqual({ x: 1, y: 0 });
  });
});

describe('attack orders and combat', () => {
  it('close to range and kill the target, which is removed and logged', () => {
    const w = world(['........', '........', '........']);
    const red = unit(w, 'red', 0, 1, { attack: 3, range: 2, cooldown: 3 });
    const blue = unit(w, 'blue', 7, 1, { attack: 0 }, 7);
    expect(applyOrder(w, { id: 1, faction: 'red', type: 'attack', units: [red], target: blue }).ok).toBe(
      true,
    );
    expect(w.get(red, Target)).toEqual({ entity: blue });
    const hpAt: number[] = [];
    let firstHitX = -1;
    stepUntil(
      w,
      () => {
        if (w.alive(blue)) {
          const hp = (w.get(blue, Health) as { hp: number }).hp;
          if (hp < 7 && firstHitX < 0) firstHitX = at(w, red).x;
          hpAt.push(hp);
        }
        return !w.alive(blue);
      },
      60,
    );
    // It stopped two cells short (range 2) and hit three times (7 hp, 3 a hit), every 3 ticks.
    expect(firstHitX).toBe(5);
    expect(hpAt.filter((hp, i) => i > 0 && hp !== hpAt[i - 1])).toEqual([4, 1]);
    const deaths = w.events().filter((e) => e.entity === blue && e.op === 'destroy');
    expect(deaths).toHaveLength(1);
    expect(deaths[0]?.cause).toBe('death');
    // The tick after, the attacker drops its finished task.
    w.step();
    expect(w.has(red, Task)).toBe(false);
    expect(w.has(red, Target)).toBe(false);
    expect(w.get(red, Facing8)).toEqual({ dir: 2 });
  });

  it('chases a moving target', () => {
    const w = world(['..........']);
    const red = unit(w, 'red', 0, 0, { speed: 1 });
    const blue = unit(w, 'blue', 3, 0, { speed: 3, attack: 0 }, 20);
    applyOrder(w, { id: 1, faction: 'blue', type: 'move', units: [blue], target: { x: 9, y: 0 } });
    applyOrder(w, { id: 2, faction: 'red', type: 'attack', units: [red], target: blue });
    stepUntil(w, () => !w.alive(blue), 80);
  });

  it('an idle unit fights back within range, picking the nearest enemy (ties to the lowest id)', () => {
    const w = world(['.....', '.....', '.....']);
    const far = unit(w, 'blue', 0, 0, { attack: 0 });
    const near1 = unit(w, 'blue', 1, 2, { attack: 0 });
    const near2 = unit(w, 'blue', 3, 2, { attack: 0 });
    const guard = unit(w, 'red', 2, 2, { attack: 1, range: 2 });
    w.step();
    expect(w.get(guard, Target)).toEqual({ entity: near1 });
    expect(w.get(near1, Health)?.hp).toBe(9);
    expect(w.get(near2, Health)?.hp).toBe(10);
    expect(w.get(far, Health)?.hp).toBe(10);
    expect(at(w, guard)).toEqual({ x: 2, y: 2 });
  });

  it('a unit on a move order does not fight', () => {
    const w = world(['.....']);
    const red = unit(w, 'red', 0, 0);
    const blue = unit(w, 'blue', 1, 0, { attack: 0 });
    applyOrder(w, { id: 1, faction: 'red', type: 'move', units: [red], target: { x: 4, y: 0 } });
    w.step();
    expect(w.get(blue, Health)?.hp).toBe(10);
  });
});

describe('heroes', () => {
  function squadWorld() {
    const w = world(['........', '........']);
    const squad = w.spawn();
    const regular = unit(w, 'red', 0, 0);
    const hero = unit(w, 'red', 1, 0);
    w.add(squad, Squad, { strength: 5, captain: null, members: [regular, hero] });
    w.add(regular, Member, { name: 'Ada', squad, role: 'regular' });
    w.add(hero, Member, { name: 'Bram', squad, role: 'hero' });
    return { w, squad, regular, hero };
  }

  it('can be ordered alone', () => {
    const { w, regular, hero } = squadWorld();
    expect(
      applyOrder(w, { id: 1, faction: 'red', type: 'move', units: [hero], target: { x: 6, y: 1 } }).ok,
    ).toBe(true);
    stepUntil(w, () => !w.has(hero, Task), 20);
    expect(at(w, hero)).toEqual({ x: 6, y: 1 });
    expect(at(w, regular)).toEqual({ x: 0, y: 0 });
  });

  it('leaves its squad when it dies', () => {
    const { w, squad, regular, hero } = squadWorld();
    const blue = unit(w, 'blue', 2, 0, { attack: 5 });
    applyOrder(w, { id: 1, faction: 'blue', type: 'attack', units: [blue], target: hero });
    stepUntil(w, () => !w.alive(hero), 5);
    expect(w.get(squad, Squad)).toEqual({ strength: 4, captain: null, members: [regular] });
  });
});

describe('bad orders', () => {
  const w = world(['....#', '.....']);
  const red = unit(w, 'red', 0, 0);
  const red2 = unit(w, 'red', 1, 0);
  const blue = unit(w, 'blue', 3, 1);
  const rock = w.spawn();
  w.add(rock, Position, { x: 2, y: 1, z: 0 });
  const cases: [string, unknown, string][] = [
    ['not an object', 'go', 'order: '],
    [
      'no units',
      { id: 3, faction: 'red', type: 'move', units: [], target: { x: 1, y: 1 } },
      'order 3: units: ',
    ],
    ['repeated units', { id: 3, faction: 'red', type: 'stop', units: [red, red] }, 'units must not repeat'],
    ['unknown type', { id: 3, faction: 'red', type: 'dance', units: [red] }, 'order 3: type: '],
    ['extra field', { id: 3, faction: 'red', type: 'stop', units: [red], target: 1 }, 'order 3: '],
    [
      'missing unit',
      { id: 4, faction: 'red', type: 'stop', units: [red, 99] },
      'order 4: unit 99 does not exist',
    ],
    ['not a unit', { id: 4, faction: 'red', type: 'stop', units: [rock] }, `entity ${rock} is not a unit`],
    [
      "another faction's unit",
      { id: 5, faction: 'red', type: 'move', units: [red, blue], target: { x: 1, y: 1 } },
      `order 5: unit ${blue} belongs to "blue", not "red"`,
    ],
    [
      'off the map',
      { id: 6, faction: 'red', type: 'move', units: [red], target: { x: 9, y: 0 } },
      'order 6: move target (9, 0) is off the 5x2 map',
    ],
    [
      'into rock',
      { id: 7, faction: 'red', type: 'move', units: [red], target: { x: 4, y: 0 } },
      'order 7: move target (4, 0) cannot be entered',
    ],
    [
      'own faction',
      { id: 8, faction: 'red', type: 'attack', units: [red], target: red2 },
      `order 8: attack target ${red2} belongs to "red", the order's own faction`,
    ],
    [
      'self',
      { id: 8, faction: 'blue', type: 'attack', units: [blue], target: blue },
      'is one of the ordered units',
    ],
    [
      'no target',
      { id: 9, faction: 'red', type: 'attack', units: [red], target: 99 },
      'attack target 99 does not exist',
    ],
    [
      'no health',
      { id: 9, faction: 'red', type: 'attack', units: [red], target: rock },
      'has no Health left',
    ],
  ];
  for (const [name, order, message] of cases) {
    it(`refuses ${name} with a clear error and changes nothing`, () => {
      const before = w.canonical();
      const logged = w.events().length;
      const result = applyOrder(w, order);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain(message);
      expect(w.canonical()).toBe(before);
      expect(w.events().length).toBe(logged);
    });
  }
});

describe('a battle', () => {
  const MAP = [
    '....................',
    '....................',
    '.......##...........',
    '.......##....,,.....',
    '.......##....,,.....',
    '....................',
    '....................',
  ];
  function battle(seed: number) {
    const w = world(MAP, seed);
    const reds = [0, 1, 2, 3, 4].map((i) =>
      unit(w, 'red', 0, 1 + i, { attack: 2 + (i % 2), cooldown: 2 }, 12),
    );
    const blues = [0, 1, 2, 3].map((i) =>
      unit(w, 'blue', 19, 1 + i, { attack: 3, range: 2, cooldown: 3, speed: 2 }, 10),
    );
    expect([...reds, ...blues]).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const applyAt = (tick: number) => {
      for (const order of battleOrdersAt(tick)) expect(applyOrder(w, order).ok).toBe(true);
    };
    return { w, reds, blues, applyAt };
  }
  const TICKS = 120;

  function run(seed: number) {
    const { w, reds, blues, applyAt } = battle(seed);
    const hashes: string[] = [];
    for (let i = 0; i < TICKS; i++) {
      applyAt(w.tick);
      w.step();
      hashes.push(hash(w));
    }
    return { w, reds, blues, hashes };
  }

  it('gives the same snapshots and log across two runs, with someone dead', () => {
    const a = run(7);
    const b = run(7);
    expect(a.hashes).toEqual(b.hashes);
    expect(canonicalJson(a.w.events())).toBe(canonicalJson(b.w.events()));
    const dead = [...a.reds, ...a.blues].filter((id) => !a.w.alive(id));
    expect(dead.length).toBeGreaterThan(0);
  });

  it('logs every change with an order or a system as its cause', () => {
    const { w } = run(7);
    const causes = new Set(w.events().map((e) => e.cause));
    for (const cause of causes) expect(cause).toMatch(/^(order:[1-5]|move|attack|death|external)$/);
    expect(causes).toEqual(
      new Set(['external', 'order:1', 'order:2', 'order:3', 'order:4', 'order:5', 'move', 'attack', 'death']),
    );
    // `external` is only the set-up before tick 0.
    expect(w.events().filter((e) => e.cause === 'external' && e.tick > 0)).toEqual([]);
  });

  it('saves and loads mid-battle and steps on with the same hashes', () => {
    const whole = run(7).hashes;
    for (const saveAt of [0, 6, 13, 22, 37, 60, 90]) {
      const { w, applyAt } = battle(7);
      for (let i = 0; i < saveAt; i++) {
        applyAt(w.tick);
        w.step();
      }
      const text = canonicalJson(saveWorld(w));
      const loaded = loadWorld(JSON.parse(text) as unknown, { components: COMPONENTS, systems: RTS_SYSTEMS });
      expect(canonicalJson(saveWorld(loaded))).toBe(text);
      for (let i = saveAt; i < TICKS; i++) {
        for (const order of battleOrdersAt(loaded.tick)) expect(applyOrder(loaded, order).ok).toBe(true);
        loaded.step();
        expect(hash(loaded), `tick ${loaded.tick} after a load at ${saveAt}`).toBe(whole[i]);
      }
    }
  });

  /** The battle's orders at a tick: red moves as a group, then both sides attack (units 2-6 red, 7-10 blue). */
  function battleOrdersAt(tick: number): unknown[] {
    const reds = [2, 3, 4, 5, 6];
    const blues = [7, 8, 9, 10];
    const all: Record<number, unknown[]> = {
      0: [{ id: 1, faction: 'red', type: 'move', units: reds, target: { x: 10, y: 3 } }],
      6: [
        { id: 2, faction: 'blue', type: 'attack', units: blues.slice(0, 2), target: reds[2] },
        { id: 3, faction: 'blue', type: 'move', units: blues.slice(2), target: { x: 12, y: 5 } },
      ],
      20: [{ id: 4, faction: 'red', type: 'attack', units: reds.slice(0, 3), target: blues[0] }],
      24: [{ id: 5, faction: 'red', type: 'attack', units: reds.slice(3), target: blues[2] }],
    };
    return all[tick] ?? [];
  }
});

describe('helpers', () => {
  it('inRange uses the floor of the straight-line distance', () => {
    expect(inRange({ x: 0, y: 0 }, { x: 1, y: 1 }, 1)).toBe(true);
    expect(inRange({ x: 0, y: 0 }, { x: 2, y: 0 }, 1)).toBe(false);
    expect(inRange({ x: 0, y: 0 }, { x: 2, y: 1 }, 2)).toBe(true);
    expect(inRange({ x: 0, y: 0 }, { x: 2, y: 2 }, 2)).toBe(true);
    expect(inRange({ x: 0, y: 0 }, { x: 3, y: 0 }, 2)).toBe(false);
  });

  it('facingOf gives the nearest of the eight directions', () => {
    expect(facingOf(0, 0)).toBeNull();
    expect([facingOf(0, -1), facingOf(1, -1), facingOf(1, 0), facingOf(1, 1)]).toEqual([0, 1, 2, 3]);
    expect([facingOf(0, 1), facingOf(-1, 1), facingOf(-1, 0), facingOf(-1, -1)]).toEqual([4, 5, 6, 7]);
    expect(facingOf(5, 1)).toBe(2);
    expect(facingOf(-1, -5)).toBe(0);
  });
});
