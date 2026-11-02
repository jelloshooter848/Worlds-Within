import { describe, expect, it } from 'vitest';
import { parseOrder } from '@engine/core/orders';
import { Rng } from '@engine/core/rng';
import { RuleSwitch } from '@engine/core/rules';
import { battleSnapshot } from './__fixtures__/world';
import { enemyPlanSchema, ScriptedEnemy, type EnemyPlan } from './enemy';
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
