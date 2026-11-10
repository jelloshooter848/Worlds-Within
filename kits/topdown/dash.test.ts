import { describe, expect, it } from 'vitest';
import type { Action } from '@engine/core/input/actions';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { buildDungeon, parseRoom } from './room';
import { TopDownWorld, type TdEvent, type TdWorldOptions } from './world';
import { DASH_TUNING, DEFAULT_ITEMS, dashItem, type DashItem } from './items';
import { topdownItems } from './kit';
import { topdownOptionsSchema } from './schema';
import { presentMap, presentWorld } from './present';
import { snapshotWorld } from './snapshot';
import { TILE } from './geometry';

// The dash (Engine 0.16 part C T5): a data-tuned burst along the facing, unhurtable while it
// lasts, with a cooldown, that crosses pits (`^`) to floor within its reach (`dash-crosses-pits`).

const EMPTY = [
  '################',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#......@.......#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '################',
];

/** EMPTY with whole columns (rows 1-9) of pits. */
function pits(cols: number[]): string[] {
  return EMPTY.map((row, r) =>
    r === 0 || r === 10
      ? row
      : row
          .split('')
          .map((ch, c) => (cols.includes(c) ? '^' : ch))
          .join(''),
  );
}

function world(mapRows: string[], opts: TdWorldOptions = {}, owned = true) {
  const w = new TopDownWorld(buildDungeon([{ id: 'r', at: [0, 0], map: mapRows }]), { seed: 1, ...opts });
  if (owned) w.inv.give('dash');
  w.events.length = 0;
  const input = new ScriptedInput({ steps: [] });
  const step = (held: Action[] = [], n = 1): TdEvent[] => {
    const out: TdEvent[] = [];
    for (let i = 0; i < n; i++) {
      input.setHeld(held);
      input.next();
      w.update(input);
      out.push(...w.events.splice(0));
    }
    return out;
  };
  return { w, hero: w.hero, step };
}

const { ticks, distance, cooldown, guard } = DASH_TUNING;

describe('the dash item', () => {
  it('is one of the kit items, tuned by DASH_TUNING', () => {
    expect((DEFAULT_ITEMS.dash as DashItem).dash).toEqual(DASH_TUNING);
    expect(DEFAULT_ITEMS.dash?.icon).toBe('dash-icon');
  });

  it('bursts its distance along the facing in its ticks, with dash and dash-end events', () => {
    const { w, hero, step } = world(EMPTY);
    hero.facing = 'right';
    const x0 = hero.x;
    const used = step(['special']);
    expect(used).toContainEqual({ type: 'dash', dir: 'right', distance });
    expect(used).toContainEqual({ type: 'item', id: 'dash' });
    expect(hero.dashing).toBe(true);
    expect(hero.useT).toBe(0); // its own pose, not the throw
    const xs: number[] = [];
    let events: TdEvent[] = [];
    for (let i = 0; i < ticks; i++) {
      events = step();
      xs.push(hero.x);
    }
    expect(xs[0]! - x0).toBe(distance / ticks);
    expect(hero.x - x0).toBe(distance);
    expect(hero.y).toBe(80);
    expect(events).toContainEqual({ type: 'dash-end' });
    expect(hero.dashing).toBe(false);
    expect(w.frame).toBe(ticks + 1);
  });

  it('stops short at a wall and does nothing with nowhere to go', () => {
    const { hero, step } = world(EMPTY);
    hero.facing = 'right';
    hero.x = 15 * TILE - 15 - 20;
    step(['special']);
    step([], ticks);
    expect(hero.x).toBe(15 * TILE - 15); // feet against the east wall
    const fresh = world(EMPTY);
    fresh.hero.facing = 'right';
    fresh.hero.x = 15 * TILE - 15;
    expect(fresh.step(['special'])).toEqual([]);
    expect(fresh.hero.dashing).toBe(false);
  });

  it('cannot be hurt while dashing or in the guard after, and can again then', () => {
    const { w, hero, step } = world(EMPTY);
    hero.facing = 'right';
    step(['special']);
    expect(hero.hurt(w, 2, 'left')).toBe(false);
    step([], ticks);
    expect(hero.dashing).toBe(false);
    expect(hero.dashGuard).toBe(guard);
    expect(hero.hurt(w, 2, 'left')).toBe(false);
    step([], guard);
    expect(hero.hurt(w, 2, 'left')).toBe(true);
    expect(hero.hp).toBe(hero.maxHp - 2);
  });

  it('waits out its cooldown before the next dash', () => {
    const { w, hero, step } = world(EMPTY);
    hero.facing = 'left';
    hero.x = 13 * TILE;
    step(['special']);
    expect(w.itemUsable()).toBe(false);
    step([], ticks);
    expect(hero.dashCd).toBe(cooldown);
    // A press right after the dash does nothing.
    expect(step(['special']).some((e) => e.type === 'dash')).toBe(false);
    step([], cooldown - 2);
    expect(w.itemUsable()).toBe(false);
    // The cooldown's last tick runs out as the next press comes in: it dashes.
    expect(step(['special']).some((e) => e.type === 'dash')).toBe(true);
  });

  it('takes its tuning from data: a dashItem, or kitOptions.topdown.dash', () => {
    const { hero, step } = world(EMPTY, { items: { dash: dashItem({ ticks: 4, distance: 32 }) } });
    hero.facing = 'down';
    const y0 = hero.y;
    step(['special']);
    step([], 4);
    expect(hero.y - y0).toBe(32);
    expect(hero.dashing).toBe(false);
    const items = topdownItems({ kitOptions: { topdown: { dash: { distance: 64, cooldown: 0 } } } });
    expect((items.dash as DashItem).dash).toEqual({ ...DASH_TUNING, distance: 64, cooldown: 0 });
    expect(topdownItems({})).toBe(DEFAULT_ITEMS);
    expect(topdownOptionsSchema.safeParse({ dash: { speed: 2 } }).success).toBe(false);
    expect(topdownOptionsSchema.safeParse({ dash: { ticks: 0 } }).success).toBe(false);
  });
});

describe('pits (^)', () => {
  it('parse as a pit tile and are presented as ^', () => {
    const room = parseRoom({ id: 'r', at: [0, 0], map: pits([10]) });
    expect(room.tiles[1 * 16 + 10]).toBe('pit');
    const { w } = world(pits([10]));
    expect(presentMap(w).map.tiles[3]).toBe('#.........^....#');
  });

  it('stop the hero walking, walkers and blocks; flyers and shots pass over', () => {
    const { w, hero, step } = world(pits([10]), {}, false);
    step(['right'], 120);
    expect(hero.x).toBe(10 * TILE - 15); // feet against the pit's edge
    const over = { x: 10 * TILE, y: 3 * TILE, w: 8, h: 8 };
    expect(w.blocked(over, 'walk')).toBe(true);
    expect(w.blocked(over, 'block')).toBe(true);
    expect(w.blocked(over, 'hero')).toBe(true);
    expect(w.blocked(over, 'fly')).toBe(false);
    expect(w.blocked(over, 'shot')).toBe(false);
    expect(w.blocked(over, 'dash')).toBe(false);
  });

  it('a dash crosses a pit to floor within its reach (dash-crosses-pits)', () => {
    const { hero, step } = world(pits([10, 11]));
    step(['right'], 120);
    expect(hero.x).toBe(10 * TILE - 15);
    step(['special']);
    step([], ticks);
    expect(hero.x).toBe(10 * TILE - 15 + distance);
    expect(hero.x + 1).toBeGreaterThanOrEqual(12 * TILE); // on the far side
  });

  it('a dash does not cross with the rule off: no dash at the pit edge', () => {
    const { hero, step } = world(pits([10, 11]), { disabledRules: ['dash-crosses-pits'] });
    step(['right'], 120);
    expect(step(['special'])).toEqual([]);
    step([], ticks);
    expect(hero.x).toBe(10 * TILE - 15);
  });

  it('a dash does not leave the hero over a pit too wide for it: it stops short', () => {
    const wide = world(pits([10, 11, 12, 13]));
    wide.step(['right'], 120);
    expect(wide.step(['special'])).toEqual([]); // nowhere to land
    const back = world(pits([10, 11, 12, 13]));
    back.hero.facing = 'right';
    back.hero.x = 10 * TILE - 15 - 20;
    back.step(['special']);
    back.step([], ticks);
    expect(back.hero.x).toBe(10 * TILE - 15);
  });

  it('cannot be crossed without the dash', () => {
    const { w, hero, step } = world(pits([10, 11]), {}, false);
    step(['right'], 120);
    step(['special']);
    step(['right'], 60);
    expect(hero.x).toBe(10 * TILE - 15);
    expect(w.inv.has('dash')).toBe(false);
  });
});

describe('the dash, presented and in snapshots', () => {
  it('shows the hero in `dash` with a `dash` tag, and the events at the hero', () => {
    const { w, hero, step } = world(EMPTY);
    hero.facing = 'right';
    const events = step(['special']);
    step();
    const frame = presentWorld(w, events);
    const h = frame.entities.find((e) => e.id === 'hero');
    expect(h?.anim).toEqual({ state: 'dash', t: 1 });
    expect(h?.tags).toContain('dash');
    expect(frame.events.find((e) => e.type === 'dash')).toMatchObject({ entity: 'hero', dir: 'right' });
    step([], ticks);
    const after = presentWorld(w).entities.find((e) => e.id === 'hero');
    expect(after?.anim.state).not.toBe('dash');
    expect(after?.tags).not.toContain('dash');
  });

  it('adds hero.dash to the snapshot only once the dash is owned', () => {
    const without = world(EMPTY, {}, false);
    expect(snapshotWorld(without.w).hero).not.toHaveProperty('dash');
    const { w, hero, step } = world(EMPTY);
    expect(snapshotWorld(w).hero.dash).toEqual({ t: 0, cooldown: 0, guard: 0 });
    hero.facing = 'right';
    step(['special']);
    expect(snapshotWorld(w).hero.dash).toEqual({ t: ticks, cooldown: 0, guard: 0 });
  });
});
