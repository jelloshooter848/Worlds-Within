import { describe, expect, it } from 'vitest';
import { parseOrder } from '@engine/core/orders';
import { Rng } from '@engine/core/rng';
import { RuleSwitch } from '@engine/core/rules';
import { battleSnapshot, siegeSnapshot } from './__fixtures__/world';
import { enemyPlanSchema, ScriptedEnemy, type EnemyPlan } from './enemy';
import { isVisible, seesBox, visibility } from './fog';
import { RTS_RULES } from './rules';
import { readWorld } from './snapshot';

const plan = (json: unknown): EnemyPlan => enemyPlanSchema.parse(json);

const PLAN = plan({
  faction: 'blue',
  steps: [
    { id: 'wander', order: { type: 'move', units: { max: 1 }, area: { x: 0, y: 0, w: 8, h: 6 } } },
    {
      id: 'patrol',
      at: 2,
      repeat: { every: 3, times: 2 },
      order: { type: 'move', units: { type: 'soldier' }, area: { x: 3, y: 3, w: 4, h: 3 } },
    },
    {
      id: 'attack',
      when: { count: 'units', side: 'enemy', op: 'lte', value: 2 },
      order: { type: 'attack', units: {}, target: 'nearest-enemy' },
    },
    { id: 'raid', at: 4, order: { type: 'attack', units: { max: 1 }, target: 'random-enemy' } },
    { id: 'hall', at: 5, order: { type: 'attack', units: {}, target: 'nearest-building' } },
  ],
});

/** Every tick's orders over `ticks` ticks of the same fixture snapshot (with its tick set). */
function run(p: EnemyPlan, seed: number, ticks = 10, rules: RuleSwitch | null = null, extra = {}) {
  const enemy = new ScriptedEnemy(p, new Rng(seed), rules);
  const out: unknown[] = [];
  for (let t = 0; t < ticks; t++)
    out.push({ t, orders: enemy.think(readWorld(battleSnapshot({ tick: t, extra }))) });
  return { out, state: enemy.snapshot() };
}

describe('ScriptedEnemy', () => {
  it('issues the same orders for the same seed and snapshots, and valid orders', () => {
    const a = run(PLAN, 42);
    const b = run(PLAN, 42);
    expect(a).toEqual(b);
    for (const tick of a.out as { orders: object[] }[]) {
      for (const o of tick.orders) expect(parseOrder({ id: 1, ...o }).ok).toBe(true);
    }
    // the RNG matters: another seed draws other cells somewhere
    expect(run(PLAN, 7).out).not.toEqual(a.out);
  });

  it('fires each step on its tick, repeats, and waits for its trigger', () => {
    const { out, state } = run(PLAN, 1);
    const ids = (out as { t: number; orders: { type: string; target?: unknown }[] }[]).map((x) => [
      x.t,
      x.orders.map((o) => o.type),
    ]);
    expect(ids).toEqual([
      [0, ['move']],
      [1, []],
      [2, ['move']],
      [3, []],
      [4, ['attack']],
      [5, ['move', 'attack']],
      [6, []],
      [7, []],
      [8, []],
      [9, []],
    ]);
    expect(state).toEqual({
      wander: { fired: 1, last: 0 },
      patrol: { fired: 2, last: 5 },
      attack: { fired: 0, last: null },
      raid: { fired: 1, last: 4 },
      hall: { fired: 1, last: 5 },
    });
  });

  it('a trigger on the enemy count fires once it holds; nearest picks are by distance then id', () => {
    const p = plan({
      faction: 'blue',
      steps: [
        {
          id: 'attack',
          when: { count: 'units', side: 'enemy', op: 'gte', value: 3 },
          order: { type: 'attack', units: { type: 'soldier' }, target: 'nearest-enemy' },
        },
      ],
    });
    const enemy = new ScriptedEnemy(p, new Rng(1));
    expect(enemy.think(readWorld(battleSnapshot()))).toEqual([
      { faction: 'blue', type: 'attack', units: [9, 10], target: 7 },
    ]);
    const p2 = plan({
      ...p,
      steps: [{ ...p.steps[0], when: { count: 'units', side: 'enemy', op: 'gte', value: 4 } }],
    });
    expect(new ScriptedEnemy(p2, new Rng(1)).think(readWorld(battleSnapshot()))).toEqual([]);
  });

  it('trains at finished buildings with room in the queue, gathers the nearest node, builds', () => {
    const p = plan({
      faction: 'red',
      steps: [
        { id: 't', order: { type: 'train', building: 'hall', unit: 'worker', queueMax: 2 } },
        { id: 'g', order: { type: 'gather', units: { type: 'worker' }, resource: 'gold' } },
        {
          id: 'b',
          order: { type: 'build', units: { type: 'worker' }, building: 'barracks', cell: { x: 4, y: 3 } },
        },
        { id: 'h', order: { type: 'stop', units: { heroes: true } } },
        {
          id: 'i',
          when: { count: 'stock', item: 'gold', op: 'gte', value: 500 },
          order: { type: 'stop', units: {} },
        },
      ],
    });
    expect(new ScriptedEnemy(p, new Rng(1)).think(readWorld(battleSnapshot()))).toEqual([
      { faction: 'red', type: 'train', units: [3], target: 'worker' },
      { faction: 'red', type: 'gather', units: [5], target: 4 },
      { faction: 'red', type: 'build', units: [5], target: { x: 4, y: 3 }, building: 'barracks' },
      { faction: 'red', type: 'stop', units: [7] },
    ]);
  });

  it('switched-off rules: no plan at all, or triggers ignored (the mutants)', () => {
    const off = (id: string) => new RuleSwitch(RTS_RULES, [id]);
    const silent = run(PLAN, 1, 10, off('enemy-follows-plan'));
    expect((silent.out as { orders: unknown[] }[]).every((x) => x.orders.length === 0)).toBe(true);
    const eager = run(PLAN, 1, 1, off('enemy-waits-for-trigger'));
    expect((eager.out as { orders: { type: string }[] }[])[0]!.orders.map((o) => o.type)).toEqual([
      'move',
      'attack',
    ]);
  });

  it('orders no frozen unit and trains at no frozen building while a mission holds the event (M20)', () => {
    const charge = (faction: string) =>
      plan({
        faction,
        steps: [
          {
            id: 'charge',
            repeat: { every: 1, times: null },
            order: { type: 'attack', units: {}, target: 'nearest-enemy' },
          },
        ],
      });
    const orders = (p: EnemyPlan, snap: Parameters<typeof readWorld>[0]) =>
      new ScriptedEnemy(p, new Rng(1)).think(readWorld(snap));
    // offered, nothing frozen: blue's siege units 9 and 10 are ordered
    expect(orders(charge('blue'), siegeSnapshot()).map((o) => o.units)).toEqual([[9, 10]]);
    // the raid open, `siege` frozen: blue has no unit left to order, so no order at all
    const open = siegeSnapshot({ open: true, tick: 10 });
    const frozen = new Set(
      readWorld(open)
        .units.filter((u) => u.frozen)
        .map((u) => u.id),
    );
    expect([...frozen]).toEqual([6, 9, 10]);
    expect(orders(charge('blue'), open)).toEqual([]);
    // red's frozen unit 6 is left out; 5 and 7 stand outside the event and are still ordered
    const red = orders(charge('red'), open);
    expect(red.map((o) => o.units)).toEqual([[5, 7]]);
    expect(red.flatMap((o) => o.units ?? []).some((id) => frozen.has(id))).toBe(false);
    // the step does not fire while frozen, so its state does not grow either
    const enemy = new ScriptedEnemy(charge('blue'), new Rng(1));
    for (let t = 10; t < 15; t++) enemy.think(readWorld(siegeSnapshot({ open: true, tick: t })));
    expect(enemy.snapshot()).toEqual({ charge: { fired: 0, last: null } });

    // a frozen building trains nothing: red's hall (3) made a member of a frozen event
    const train = plan({
      faction: 'red',
      steps: [{ id: 'train', order: { type: 'train', building: 'hall', unit: 'worker', queueMax: 2 } }],
    });
    const hallFrozen = battleSnapshot({
      extra: {
        EventMember: [[3, { event: 'siege' }]],
        WorldTime: [
          [11, { frozen: [{ event: 'siege', by: 'mission:raid', since: 0 }], experience: [], committed: [] }],
        ],
      },
    });
    expect(orders(train, battleSnapshot())).toHaveLength(1);
    expect(orders(train, hallFrozen)).toEqual([]);
  });

  it('rejects a plan with a step id twice or a move without one target', () => {
    const bad = enemyPlanSchema.safeParse({
      faction: 'blue',
      steps: [
        { id: 'a', order: { type: 'stop' } },
        { id: 'a', order: { type: 'move', cell: { x: 1, y: 1 }, area: { x: 0, y: 0, w: 1, h: 1 } } },
      ],
    });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.map((i) => i.path.join('.'))).toEqual(['steps.1.order', 'steps.1.id']);
  });
});

// Engine 0.16 part D, D6: a skirmish opponent under fog. A wide field (24 x 6, all ground): red's
// hall, gold and units at the west as in the battle fixture, blue's barracks site at (20, 0) and
// its soldiers 9 and 10 at the east; every unit sees 2 cells, so blue's side sees only x >= 16.

type Snap = ReturnType<typeof battleSnapshot>;

/** The wide field at `tick`, with units moved (`at`), entities dropped and extra rows added. */
function field(
  opts: {
    tick?: number;
    at?: Record<number, [number, number]>;
    drop?: number[];
    add?: Record<string, [number, unknown][]>;
  } = {},
): Snap {
  const snap = battleSnapshot({ tick: opts.tick ?? 0 });
  const c = snap.components;
  c['Terrain'] = [
    [
      1,
      {
        width: 24,
        height: 6,
        types: [{ name: 'ground', cost: 1, passable: true }],
        elevation: new Array(144).fill(0),
        cells: new Array(144).fill(0),
      },
    ],
  ];
  const at: Record<number, [number, number]> = { 8: [20, 0], 9: [20, 4], 10: [21, 4], ...opts.at };
  c['Position'] = c['Position']!.map(([id, p]) => [id, at[id] ? { x: at[id][0], y: at[id][1], z: 0 } : p]);
  c['Unit'] = c['Unit']!.map(([id, u]) => [id, { ...(u as object), sight: 2 }]);
  c['Task'] = [];
  c['Cooldown'] = [];
  c['Target'] = [];
  for (const [name, rows] of Object.entries(opts.add ?? {})) c[name] = [...(c[name] ?? []), ...rows];
  const drop = new Set(opts.drop ?? []);
  for (const name of Object.keys(c)) c[name] = c[name]!.filter(([id]) => !drop.has(id));
  snap.entities = snap.entities.filter((id) => !drop.has(id));
  return snap;
}

/** A red barracks (id 11) at (x, y), finished. */
const redBarracks = (x: number, y: number) => ({
  Position: [[11, { x, y, z: 0 }]] as [number, unknown][],
  Owner: [[11, { faction: 'red' }]] as [number, unknown][],
  Health: [[11, { hp: 200, max: 200 }]] as [number, unknown][],
  Building: [[11, { kind: 'barracks', w: 2, h: 2, dropoff: false }]] as [number, unknown][],
});

const TARGETS = ['nearest-enemy', 'nearest-building', 'random-enemy', 'enemy-base', 'last-seen-building'];

/** One attack step per target kind, all repeating every tick. */
function attacks(knowledge: 'all' | 'fog', units: object = {}): EnemyPlan {
  return plan({
    faction: 'blue',
    knowledge,
    steps: TARGETS.map((target) => ({
      id: target,
      repeat: { every: 1, times: null },
      order: { type: 'attack', units, target },
    })),
  });
}

describe('ScriptedEnemy as a skirmish opponent (D6)', () => {
  it('with knowledge "fog" never targets an enemy its side has not seen', () => {
    const view = readWorld(field());
    expect(visibility(view, 'blue').cells.some((v, i) => v === 1 && i % 24 < 16)).toBe(false);
    // knowing all, every target kind finds red; under fog there is nothing to target
    expect(new ScriptedEnemy(attacks('all'), new Rng(1)).think(view)).toHaveLength(5);
    expect(new ScriptedEnemy(attacks('fog'), new Rng(1)).think(view)).toEqual([]);
    // a trigger on the enemy count reads only what it sees, too
    const counted = plan({
      faction: 'blue',
      knowledge: 'fog',
      steps: [
        {
          id: 'go',
          when: { count: 'units', side: 'enemy', op: 'gte', value: 1 },
          order: { type: 'stop', units: {} },
        },
      ],
    });
    expect(new ScriptedEnemy(counted, new Rng(1)).think(view)).toEqual([]);
    expect(new ScriptedEnemy({ ...counted, knowledge: 'all' }, new Rng(1)).think(view)).toHaveLength(1);

    // red's soldier 6 walks east across the field: every unit or building blue attacks is one its
    // side sees on that tick or remembers
    const enemy = new ScriptedEnemy(attacks('fog'), new Rng(3));
    const remembered = new Set<number>();
    for (let x = 0; x < 24; x++) {
      const v = readWorld(field({ tick: x, at: { 6: [x, 4] } }));
      const vis = visibility(v, 'blue');
      for (const b of v.buildings)
        if (b.faction === 'red' && seesBox(vis, b.x, b.y, b.w, b.h)) remembered.add(b.id);
      for (const o of enemy.think(v)) {
        if (o.type !== 'attack') continue;
        const t = o.target as number;
        const unit = v.units.find((u) => u.id === t);
        if (unit !== undefined) expect(isVisible(vis, unit.x, unit.y), `tick ${x}`).toBe(true);
        else expect(remembered.has(t), `tick ${x}`).toBe(true);
      }
    }
    // it saw soldier 6 once it came within sight, and attacked it
    const seen = new ScriptedEnemy(attacks('fog'), new Rng(3)).think(
      readWorld(field({ at: { 6: [17, 4] } })),
    );
    expect(seen.filter((o) => o.type === 'attack').map((o) => [o.type, o.target])).toEqual([
      ['attack', 6],
      ['attack', 6],
    ]);
  });

  it('remembers buildings it saw: walks to one out of sight, the latest seen or the base', () => {
    const steps = (target: string) => ({
      id: target,
      at: 4,
      order: { type: 'attack', units: { type: 'soldier', max: 1 }, target },
    });
    const p = plan({
      faction: 'blue',
      knowledge: 'fog',
      steps: [steps('nearest-building'), steps('last-seen-building'), steps('enemy-base')],
    });
    const enemy = new ScriptedEnemy(p, new Rng(1));
    const add = redBarracks(10, 4);
    // tick 0: soldier 9 by red's barracks (11); tick 3: by red's hall (3); tick 4: back home
    enemy.think(readWorld(field({ tick: 0, at: { 9: [12, 3] }, add })));
    enemy.think(readWorld(field({ tick: 3, at: { 9: [3, 2] }, add })));
    expect(enemy.memorySnapshot()).toMatchObject({
      buildings: [
        { id: 3, kind: 'hall', faction: 'red', x: 0, y: 0, w: 2, h: 2, seen: 3 },
        { id: 11, kind: 'barracks', faction: 'red', x: 10, y: 4, w: 2, h: 2, seen: 0 },
      ],
    });
    const home = enemy.think(readWorld(field({ tick: 4, add })));
    // neither is seen now, so the soldier walks to the nearest footprint cell and does not attack by id
    expect(home).toEqual([
      { faction: 'blue', type: 'move', units: [9], target: { x: 11, y: 4 } },
      { faction: 'blue', type: 'move', units: [9], target: { x: 1, y: 1 } },
      { faction: 'blue', type: 'move', units: [9], target: { x: 1, y: 1 } },
    ]);
    // seen now: attacked by id
    const near = new ScriptedEnemy(p, new Rng(1)).think(
      readWorld(field({ tick: 4, at: { 9: [3, 2] }, add })),
    );
    expect(near.map((o) => [o.type, 'target' in o ? o.target : null])).toEqual([
      ['attack', 3],
      ['attack', 3],
      ['attack', 3],
    ]);
    // a remembered building seen again and gone is forgotten
    enemy.think(readWorld(field({ tick: 5, at: { 9: [12, 3] }, drop: [] })));
    expect((enemy.memorySnapshot() as { buildings: { id: number }[] }).buildings.map((b) => b.id)).toEqual([
      3,
    ]);
  });

  it('scouts the nearest unexplored cell, in the listed areas first, and waits once all is explored', () => {
    const scout = (areas?: object[]) =>
      plan({
        faction: 'blue',
        steps: [
          {
            id: 'scout',
            repeat: { every: 1, times: null },
            order: { type: 'scout', units: { type: 'soldier', max: 1 }, ...(areas ? { areas } : {}) },
          },
        ],
      });
    const view = readWorld(field());
    const vis = visibility(view, 'blue');
    // the expected cell: the nearest unseen one to soldier 9 at (20, 4), lowest row then column first
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 24; x++) {
        const d = (x - 20) ** 2 + (y - 4) ** 2;
        if (!isVisible(vis, x, y) && d < bestD) [best, bestD] = [{ x, y }, d];
      }
    expect(new ScriptedEnemy(scout(), new Rng(1)).think(view)).toEqual([
      { faction: 'blue', type: 'move', units: [9], target: best },
    ]);
    // a listed area: the first that still has an unexplored cell (the first one is all seen)
    const inArea = new ScriptedEnemy(
      scout([
        { x: 18, y: 0, w: 4, h: 4 },
        { x: 0, y: 0, w: 3, h: 2 },
      ]),
      new Rng(1),
    ).think(view);
    expect(inArea).toEqual([{ faction: 'blue', type: 'move', units: [9], target: { x: 2, y: 1 } }]);
    // all explored: no order, and the step does not fire
    const done = new ScriptedEnemy(scout([{ x: 18, y: 0, w: 4, h: 4 }]), new Rng(1));
    expect(done.think(view)).toEqual([]);
    expect(done.snapshot()).toEqual({ scout: { fired: 0, last: null } });
    // a scouting plan keeps a memory (in the kit snapshot), an older plan none
    expect(done.memorySnapshot()).not.toBeNull();
    expect(new ScriptedEnemy(PLAN, new Rng(1)).memorySnapshot()).toBeNull();
  });

  it('sends a wave only once `min` units are idle; trains up to a count; builds at the first free cell', () => {
    const wave = (min: number) =>
      plan({
        faction: 'blue',
        steps: [
          {
            id: 'wave',
            order: { type: 'attack', units: { type: 'soldier', idle: true, min }, target: 'nearest-enemy' },
          },
        ],
      });
    // in the battle fixture soldier 9 is walking, 10 idle
    expect(new ScriptedEnemy(wave(2), new Rng(1)).think(readWorld(battleSnapshot()))).toEqual([]);
    expect(new ScriptedEnemy(wave(1), new Rng(1)).think(readWorld(battleSnapshot()))).toEqual([
      { faction: 'blue', type: 'attack', units: [10], target: 7 },
    ]);

    // red has one worker and one queued at its hall
    const train = (upTo: number) =>
      plan({
        faction: 'red',
        steps: [{ id: 't', order: { type: 'train', building: 'hall', unit: 'worker', queueMax: 2, upTo } }],
      });
    expect(new ScriptedEnemy(train(2), new Rng(1)).think(readWorld(battleSnapshot()))).toEqual([]);
    expect(new ScriptedEnemy(train(3), new Rng(1)).think(readWorld(battleSnapshot()))).toEqual([
      { faction: 'red', type: 'train', units: [3], target: 'worker' },
    ]);

    // (0, 0) is the hall, (4, 0) the gold, (7, 5) off the map, (3, 3) rock: (4, 3) is the first free
    const build = (cells: object[]) =>
      plan({
        faction: 'red',
        steps: [
          { id: 'b', order: { type: 'build', units: { type: 'worker' }, building: 'barracks', cells } },
        ],
      });
    const cells = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 7, y: 5 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
    ];
    expect(new ScriptedEnemy(build(cells), new Rng(1)).think(readWorld(battleSnapshot()))).toEqual([
      { faction: 'red', type: 'build', units: [5], target: { x: 4, y: 3 }, building: 'barracks' },
    ]);
    expect(
      new ScriptedEnemy(build(cells.slice(0, 4)), new Rng(1)).think(readWorld(battleSnapshot())),
    ).toEqual([]);

    // keeping workers on gold: a repeating gather for idle workers picks up a worker once it idles
    const gold = plan({
      faction: 'red',
      steps: [
        {
          id: 'gold',
          repeat: { every: 1, times: null },
          order: { type: 'gather', units: { type: 'worker', idle: true }, resource: 'gold' },
        },
      ],
    });
    const busy = battleSnapshot({
      extra: { Task: [[5, { order: 1, kind: 'gather', goal: null, target: 4, path: [], flow: true }]] },
    });
    const keeper = new ScriptedEnemy(gold, new Rng(1));
    expect(keeper.think(readWorld(busy))).toEqual([]);
    expect(keeper.think(readWorld(battleSnapshot({ tick: 1 })))).toEqual([
      { faction: 'red', type: 'gather', units: [5], target: 4 },
    ]);
  });

  it('gives the same orders and memory for the same seed and views', () => {
    const p = plan({
      faction: 'blue',
      knowledge: 'fog',
      steps: [
        { id: 'scout', repeat: { every: 2, times: null }, order: { type: 'scout', units: { max: 1 } } },
        ...attacks('fog').steps,
      ],
    });
    const play = () => {
      const enemy = new ScriptedEnemy(p, new Rng(9));
      const out = [];
      for (let t = 0; t < 24; t++)
        out.push(enemy.think(readWorld(field({ tick: t, at: { 6: [t, 2], 9: [23 - t, 4] } }))));
      return { out, state: enemy.snapshot(), memory: enemy.memorySnapshot() };
    };
    const a = play();
    expect(play()).toEqual(a);
    expect(a.out.flat().length).toBeGreaterThan(0);
  });

  it('switched off, enemy-knows-only-what-it-saw lets a fog plan read the whole world (the mutant)', () => {
    const off = new RuleSwitch(RTS_RULES, ['enemy-knows-only-what-it-saw']);
    const view = readWorld(field());
    const fogged = new ScriptedEnemy(attacks('fog'), new Rng(1), off).think(view);
    expect(fogged).toEqual(new ScriptedEnemy(attacks('all'), new Rng(1)).think(view));
    expect(fogged).toHaveLength(5);
    expect(new ScriptedEnemy(attacks('fog'), new Rng(1), new RuleSwitch(RTS_RULES, [])).think(view)).toEqual(
      [],
    );
  });

  it('rejects a build with both or neither of cell and cells', () => {
    const bad = enemyPlanSchema.safeParse({
      faction: 'blue',
      steps: [
        { id: 'a', order: { type: 'build', building: 'barracks' } },
        {
          id: 'b',
          order: { type: 'build', building: 'barracks', cell: { x: 1, y: 1 }, cells: [{ x: 1, y: 1 }] },
        },
        { id: 'c', order: { type: 'scout', areas: [] } },
      ],
    });
    expect(bad.error?.issues.map((i) => i.path.join('.'))).toEqual([
      'steps.0.order',
      'steps.1.order',
      'steps.2.order.areas',
    ]);
  });
});
