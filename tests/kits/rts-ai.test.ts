import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '@engine/core/headless';
import { rtsWorldPort, worldFromScenario } from '@engine/sim/index';
import {
  enemyPlanSchema,
  matchResult,
  rtsEndSchema,
  rtsGame,
  sidesOf,
  visibility,
  isVisible,
  type MatchResult,
  type RtsGame,
} from '@kits/rts';

// The RTS kit's skirmish opponent (Engine 0.16 part D, D6) over a real engine/sim world: a small
// field where blue starts with a hall, two workers and a gold node, and red, the player, has only
// a hall across a rock. Blue's plan knows only what its side has seen: it keeps its workers on
// gold, builds a barracks at the first free cell, trains soldiers up to a count, scouts until it
// finds red, and sends a wave at red's base once enough soldiers are idle. The end rule is data.

const SCENARIO = JSON.parse(
  readFileSync(new URL('./__fixtures__/skirmish-ai.world.json', import.meta.url), 'utf8'),
) as unknown;

const PLAN = enemyPlanSchema.parse({
  faction: 'blue',
  knowledge: 'fog',
  steps: [
    {
      id: 'gold',
      repeat: { every: 4, times: null },
      order: { type: 'gather', units: { type: 'worker', idle: true }, resource: 'gold' },
    },
    {
      id: 'barracks',
      at: 20,
      when: { count: 'buildings', side: 'self', type: 'barracks', op: 'lte', value: 0 },
      repeat: { every: 10, times: null },
      order: {
        type: 'build',
        units: { type: 'worker', max: 1 },
        building: 'barracks',
        cells: [
          { x: 17, y: 4 },
          { x: 14, y: 7 },
          { x: 14, y: 4 },
        ],
      },
    },
    {
      id: 'train',
      repeat: { every: 5, times: null },
      order: { type: 'train', building: 'barracks', unit: 'soldier', upTo: 4 },
    },
    {
      id: 'scout',
      repeat: { every: 5, times: null },
      when: { count: 'buildings', side: 'enemy', op: 'lte', value: 0 },
      order: { type: 'scout', units: { type: 'soldier', idle: true, max: 1 } },
    },
    {
      id: 'wave',
      repeat: { every: 20, times: null },
      order: { type: 'attack', units: { type: 'soldier', idle: true, min: 3 }, target: 'enemy-base' },
    },
  ],
});

const RED_END = rtsEndSchema.parse({
  faction: 'red',
  won: [{ count: 'buildings', side: 'enemy', type: 'hall', op: 'lte', value: 0 }],
  lost: [{ count: 'buildings', side: 'self', type: 'hall', op: 'lte', value: 0 }],
});

const BLUE_END = rtsEndSchema.parse({ ...RED_END, faction: 'blue' });

function game(): RtsGame {
  return rtsGame({ world: rtsWorldPort(worldFromScenario(SCENARIO)), enemy: PLAN, seed: 5 });
}

const hash = (g: RtsGame) =>
  createHash('sha256').update(canonicalJson(g.snapshot())).digest('hex').slice(0, 16);

interface Played {
  hashes: string[];
  barracksAt: number | null;
  firstAttack: number | null;
  result: MatchResult;
  endTick: number;
  blueSaw: MatchResult;
}

/** Plays up to `ticks` ticks, or until the end rule decides the match. */
function play(g: RtsGame, ticks: number): Played {
  const out: Played = {
    hashes: [],
    barracksAt: null,
    firstAttack: null,
    result: null,
    endTick: 0,
    blueSaw: null,
  };
  for (let t = 0; t < ticks; t++) {
    const view = g.view();
    const blue = sidesOf(view, ['blue'])['blue']!;
    if (out.barracksAt === null && (blue.buildings['barracks'] ?? 0) > 0) out.barracksAt = t;
    out.result = matchResult(view, RED_END);
    out.blueSaw = matchResult(view, BLUE_END, g.scriptedEnemy()!.knowledge());
    out.endTick = t;
    if (out.result !== null) break;
    g.step();
    out.hashes.push(hash(g));
  }
  const attack = g.log().find((e) => e.source === 'enemy' && e.order.type === 'attack' && e.error === null);
  out.firstAttack = attack?.tick ?? null;
  return out;
}

describe('the RTS kit skirmish opponent over a sim world (D6)', () => {
  it('gathers, builds a barracks, trains, scouts, and attacks red in a wave until the end rule says lost', () => {
    const g = game();
    const p = play(g, 3000);
    expect(p.barracksAt).not.toBeNull();
    expect(p.firstAttack).not.toBeNull();
    expect(p.barracksAt!).toBeLessThan(p.firstAttack!);
    expect(p.result).toBe('lost');
    // blue, reading only what it knows, sees the same end: red's hall gone where it looked
    expect(p.blueSaw).toBe('won');
    // every enemy attack named a target blue's side saw on that tick (fog knowledge)
    const log = g.log().filter((e) => e.source === 'enemy');
    expect(log.some((e) => e.order.type === 'build' && e.error === null)).toBe(true);
    expect(log.some((e) => e.order.type === 'train' && e.error === null)).toBe(true);
    // the kit snapshot carries blue's memory (a fog plan), explored rows the map's size
    const seen = (g.snapshot()['kit'] as { seen?: { explored: string[] } }).seen;
    expect(seen?.explored).toHaveLength(10);
    const steps = (g.snapshot()['kit'] as { enemy: Record<string, { fired: number }> }).enemy;
    expect(steps['scout']!.fired).toBeGreaterThan(0);
    expect(steps['wave']!.fired).toBeGreaterThan(0);
  });

  it('never attacks a red thing its side cannot see on that tick', () => {
    const g = game();
    for (let t = 0; t < 1500; t++) {
      const view = g.view();
      const vis = visibility(view, 'blue');
      const before = g.log().length;
      g.step();
      for (const e of g.log().slice(before)) {
        if (e.source !== 'enemy' || e.order.type !== 'attack') continue;
        const target = e.order.target;
        const unit = view.units.find((u) => u.id === target);
        const building = view.buildings.find((b) => b.id === target);
        const seen = unit
          ? isVisible(vis, unit.x, unit.y)
          : building !== undefined &&
            [...Array(building.w * building.h).keys()].some((i) =>
              isVisible(vis, building.x + (i % building.w), building.y + Math.floor(i / building.w)),
            );
        expect(seen, `tick ${t} order ${e.order.id}`).toBe(true);
      }
      if (matchResult(g.view(), RED_END) !== null) break;
    }
  });

  it('plays the same match every run (the same hashes)', () => {
    const a = play(game(), 400).hashes;
    expect(play(game(), 400).hashes).toEqual(a);
  });
});
