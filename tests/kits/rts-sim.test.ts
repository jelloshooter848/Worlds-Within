import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validate } from '@engine/core/content/validate';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import { presentFrameSchema } from '@engine/core/present';
import { applyOrder, worldFromScenario } from '@engine/sim/index';
import {
  commandAt,
  enemyPlanSchema,
  presentWorld,
  RtsPresentState,
  rtsGame,
  Selection,
  trainCommand,
  type RtsGame,
} from '@kits/rts';

// The RTS kit driven over a real engine/sim world, as a game's glue will drive it (Engine 0.9 T10).
// Kits may not import the sim, so this check lives here, outside every layer: the glue in a few
// lines, the scripted enemy and the player's commands as orders, presentation each tick, and a
// replay of the player's recorded orders giving the same state hashes.

const SCENARIO = JSON.parse(
  readFileSync(new URL('../../engine/sim/__fixtures__/battle.world.json', import.meta.url), 'utf8'),
) as unknown;

const PLAN = enemyPlanSchema.parse({
  faction: 'blue',
  steps: [
    { id: 'hold', order: { type: 'move', units: {}, area: { x: 11, y: 6, w: 3, h: 3 } } },
    {
      id: 'attack',
      at: 30,
      when: { count: 'units', side: 'enemy', op: 'gte', value: 4 },
      order: { type: 'attack', units: {}, target: 'nearest-enemy' },
    },
  ],
});

/** The glue: a sim world behind the kit's port. */
function game(seed: number): RtsGame {
  const world = worldFromScenario(SCENARIO);
  return rtsGame({
    world: {
      snapshot: () => world.snapshot(),
      applyOrder: (o) => {
        const r = applyOrder(world, o);
        return r.ok ? { ok: true } : { ok: false, error: r.error };
      },
      step: () => world.step(),
    },
    enemy: PLAN,
    seed,
  });
}

const hash = (g: RtsGame) =>
  createHash('sha256').update(canonicalJson(g.snapshot())).digest('hex').slice(0, 16);

describe('kits/rts over an engine/sim world', () => {
  it('plays a battle from commands and the scripted enemy, presents every tick, and replays to the same hashes', () => {
    const live = game(3);
    const sel = new Selection('red');
    const state = new RtsPresentState();
    const hashes: string[] = [hash(live)];
    for (let t = 0; t < 160; t++) {
      const view = live.view();
      if (t === 0) {
        sel.set([5]);
        const gather = commandAt(view, sel, { x: 4 * 16 + 8, y: 8 }, 16)!; // the gold node at (4, 0)
        expect(gather.type).toBe('gather');
        expect(live.issue(gather).error).toBeNull();
      }
      if (t === 2) {
        sel.set([3]);
        expect(live.issue(trainCommand(view, sel, 'worker')!).error).toBeNull();
      }
      if (t === 40) {
        sel.set(view.units.filter((u) => u.faction === 'red').map((u) => u.id));
        live.issue(commandAt(view, sel, { x: 9 * 16, y: 6 * 16 }, 16)!);
      }
      const frame = presentWorld(view, {
        faction: 'red',
        size: { width: 320, height: 240 },
        selection: sel.ids(),
        state,
      });
      expect(validate('frame.json', frame, presentFrameSchema).errors).toEqual([]);
      live.step();
      hashes.push(hash(live));
    }
    const sources = new Set(live.log().map((e) => e.source));
    expect(sources).toEqual(new Set(['player', 'enemy']));
    expect(live.log().find((e) => e.source === 'enemy' && e.order.type === 'attack')).toBeDefined();

    const recorded = live.recorded();
    const again = game(3);
    const replayed: string[] = [hash(again)];
    for (let t = 0; t < 160; t++) {
      for (const { tick, ...o } of recorded) if (tick === t) again.order(o as unknown as JsonObject);
      again.step();
      replayed.push(hash(again));
    }
    expect(replayed).toEqual(hashes);
    expect(again.log()).toEqual(live.log());
  });
});
