import { describe, expect, it } from 'vitest';
import { canonicalJson, type HeadlessGame, type JsonObject } from '@engine/core/headless';
import type { Order } from '@engine/core/orders';
import { battleSnapshot, siegeSnapshot } from './__fixtures__/world';
import { enemyPlanSchema } from './enemy';
import { rtsGame, type RtsWorldPort } from './game';

/** A stand-in world: the fixture snapshot at its tick; it refuses orders for units of another side. */
function fakeWorld(): RtsWorldPort & { applied: Order[] } {
  let tick = 0;
  const applied: Order[] = [];
  const owner = new Map(
    (battleSnapshot().components['Owner'] as [number, { faction: string }][]).map(([id, o]) => [
      id,
      o.faction,
    ]),
  );
  return {
    applied,
    snapshot: () => battleSnapshot({ tick }),
    applyOrder(order) {
      const stranger = order.units.find((u) => owner.get(u) !== order.faction);
      if (stranger !== undefined)
        return { ok: false, error: `order ${order.id}: unit ${stranger} is not ${order.faction}'s` };
      applied.push(order);
      return { ok: true };
    },
    step: () => {
      tick += 1;
    },
  };
}

const PLAN = enemyPlanSchema.parse({
  faction: 'blue',
  steps: [
    {
      id: 'wander',
      repeat: { every: 4, times: null },
      order: { type: 'move', units: {}, area: { x: 0, y: 0, w: 8, h: 6 } },
    },
    { id: 'hit', at: 3, order: { type: 'attack', units: { max: 1 }, target: 'random-enemy' } },
  ],
});

/** Plays `ticks` steps; `orders` are the player's, by tick. Returns each tick's snapshot text. */
function play(game: HeadlessGame, ticks: number, orders: (tick: number) => JsonObject[]): string[] {
  const out = [canonicalJson(game.snapshot())];
  for (let t = 0; t < ticks; t++) {
    for (const o of orders(t)) game.order!(o);
    game.step({} as never);
    out.push(canonicalJson(game.snapshot()));
  }
  return out;
}

describe('rtsGame', () => {
  it('stamps order ids across both sides, applies the enemy before each step, records the player', () => {
    const world = fakeWorld();
    const game = rtsGame({ world, enemy: PLAN, seed: 5 });
    expect(game.issue({ faction: 'red', type: 'stop', units: [6] })).toEqual({
      order: { id: 1, faction: 'red', type: 'stop', units: [6] },
      error: null,
    });
    game.step();
    game.step();
    expect(game.issue({ faction: 'red', type: 'stop', units: [9] }).error).toBe(
      "order 3: unit 9 is not red's",
    );
    for (let i = 0; i < 4; i++) game.step();
    expect(game.log().map((e) => [e.tick, e.source, e.order.id, e.order.type, e.error === null])).toEqual([
      [0, 'player', 1, 'stop', true],
      [0, 'enemy', 2, 'move', true],
      [2, 'player', 3, 'stop', false],
      [3, 'enemy', 4, 'attack', true],
      [4, 'enemy', 5, 'move', true],
    ]);
    expect(game.recorded()).toEqual([
      { tick: 0, id: 1, faction: 'red', type: 'stop', units: [6] },
      { tick: 2, id: 3, faction: 'red', type: 'stop', units: [9] },
    ]);
    expect(game.tick).toBe(6);
    expect(game.snapshot()['kit']).toMatchObject({
      nextOrder: 6,
      enemy: { wander: { fired: 2, last: 4 }, hit: { fired: 1, last: 3 } },
    });
  });

  it('a replay of the recorded player orders gives the same orders, ids and snapshots', () => {
    const first = rtsGame({ world: fakeWorld(), enemy: PLAN, seed: 9 });
    const live = play(first, 12, (t) =>
      t === 1 || t === 6
        ? [{ id: first.nextOrderId, faction: 'red', type: 'move', units: [6, 7], target: { x: t, y: 2 } }]
        : [],
    );
    const recorded = first.recorded();
    const again = rtsGame({ world: fakeWorld(), enemy: PLAN, seed: 9 });
    const replay = play(again, 12, (t) =>
      recorded.filter((o) => o.tick === t).map(({ tick: _, ...o }) => o as JsonObject),
    );
    expect(replay).toEqual(live);
    expect(again.log()).toEqual(first.log());
    // another seed: the enemy draws other cells
    const quiet = (seed: number) => play(rtsGame({ world: fakeWorld(), enemy: PLAN, seed }), 12, () => []);
    expect(quiet(9)).toEqual(quiet(9));
    expect(quiet(10)).not.toEqual(quiet(9));
  });

  it('drops what is not an order with a reason, and checks switched-off rule ids', () => {
    const game = rtsGame({ world: fakeWorld(), seed: 1 });
    expect(game.order({ id: 1, faction: 'red', type: 'fly', units: [5] })).toMatch(/^not an order: type/);
    expect(() => rtsGame({ world: fakeWorld(), seed: 1, disabledRules: ['nope'] })).toThrow(/unknown rule/);
    const quiet = rtsGame({
      world: fakeWorld(),
      enemy: PLAN,
      seed: 1,
      disabledRules: ['enemy-follows-plan'],
    });
    quiet.step();
    expect(quiet.log()).toEqual([]);
  });
});

describe('RtsGame.refresh (Engine 0.11)', () => {
  it('reads the snapshot again after the world changed outside the port', () => {
    let offered = false;
    const world = fakeWorld();
    const game = rtsGame({
      world: { ...world, snapshot: () => (offered ? siegeSnapshot({ tick: 0 }) : battleSnapshot()) },
      seed: 1,
    });
    expect(game.view().missions.offered).toEqual([]);
    offered = true; // a host opened a window between steps
    expect(game.view().missions.offered).toEqual([]);
    game.refresh();
    expect(game.view().missions.offered.map((o) => o.mission)).toEqual(['raid']);
  });
});
