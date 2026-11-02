import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../core/headless';
import { Construction, Patrol, Position, STANDARD_COMPONENTS, Health, inventoryAdd } from './components';
import { stockpileOf } from './economy';
import { Building } from './footprint';
import { Cooldown } from './rts';
import { applyOrder } from './rts-orders';
import { loadWorld, saveWorld } from './save';
import { worldFromScenario } from './scenario';
import { SYSTEM_SETS } from './system-sets';
import { SYSTEM_COMPONENTS, Walk, patrolSystem } from './systems';
import { Terrain, flatTerrain } from './terrain';
import {
  EventMember,
  TIME_COMPONENTS,
  WorldTime,
  addExperience,
  eventMembers,
  freezeEvent,
  joinEvent,
  leaveEvent,
  stampCommitment,
  startExperience,
  timeOf,
  unfreezeEvent,
} from './time';
import { createWorld, type Entity, type World } from './world';

const hash = (world: World): string =>
  createHash('sha256').update(world.canonical()).digest('hex').slice(0, 16);

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')) as unknown;

describe('the time components', () => {
  it('stay out of snapshots and saves until used', () => {
    const plain = createWorld(3, { components: STANDARD_COMPONENTS });
    const timed = createWorld(3, { components: [...STANDARD_COMPONENTS, ...TIME_COMPONENTS] });
    for (const w of [plain, timed]) w.add(w.spawn(), Position, { x: 1, y: 2, z: 0 });
    expect(timed.canonical()).toBe(plain.canonical());
    expect(canonicalJson(saveWorld(timed))).toBe(canonicalJson(saveWorld(plain)));
    joinEvent(timed, 1, 'battle', 'scenario');
    expect(Object.keys(timed.snapshot().components)).toContain(EventMember.name);
  });

  it('are registered on first use in a world built without them', () => {
    const w = createWorld(1, { components: STANDARD_COMPONENTS });
    expect(w.registered(WorldTime)).toBe(false);
    expect(freezeEvent(w, 'battle', 'mission:raid')).toEqual({ ok: true });
    expect(w.registered(WorldTime) && w.registered(EventMember)).toBe(true);
    expect(timeOf(w).frozen()).toEqual([{ event: 'battle', by: 'mission:raid', since: 0 }]);
  });

  it('save an event member that has left again, because the log still names it', () => {
    const w = createWorld(1, { components: [...STANDARD_COMPONENTS, ...TIME_COMPONENTS] });
    const id = w.spawn();
    joinEvent(w, id, 'battle', 'scenario');
    expect(eventMembers(w, 'battle')).toEqual([id]);
    expect(leaveEvent(w, id, 'scenario')).toBe(true);
    expect(eventMembers(w, 'battle')).toEqual([]);
    const save = saveWorld(w);
    expect(save['components']).toContain(EventMember.name);
    const back = loadWorld(save, { components: [...STANDARD_COMPONENTS, ...TIME_COMPONENTS] });
    expect(back.canonical()).toBe(w.canonical());
    expect(canonicalJson(saveWorld(back))).toBe(canonicalJson(save));
  });
});

describe('the time service', () => {
  it('reads world time, experience time and commitment time', () => {
    const w = createWorld(5, { components: TIME_COMPONENTS });
    const time = timeOf(w);
    expect(time.world).toBe(0);
    for (let i = 0; i < 4; i++) w.step();
    expect(time.world).toBe(4);

    expect(startExperience(w, 'raid', 'mission:raid')).toEqual({ ok: true });
    expect(time.experience('raid')).toBe(0);
    expect(addExperience(w, 'raid', 240, 'mission:raid')).toEqual({ ok: true });
    expect(addExperience(w, 'raid', 10000, 'mission:raid')).toEqual({ ok: true });
    // Experience time never moves the world.
    expect(time.world).toBe(4);
    expect(time.experience('raid')).toBe(10240);
    expect(time.open()).toEqual([{ mission: 'raid', since: 4, ticks: 10240 }]);

    for (let i = 0; i < 6; i++) w.step();
    expect(stampCommitment(w, 'raid', 'mission:raid')).toEqual({ ok: true });
    expect(time.experience('raid')).toBeNull();
    expect(time.commitment('raid')).toEqual({ mission: 'raid', opened: 4, tick: 10, experience: 10240 });

    expect(startExperience(w, 'convoy', 'mission:convoy')).toEqual({ ok: true });
    expect(stampCommitment(w, 'convoy', 'mission:convoy', 13)).toEqual({ ok: true });
    expect(time.commitments().map((c) => [c.mission, c.tick])).toEqual([
      ['raid', 10],
      ['convoy', 13],
    ]);
  });

  it('refuses what would change a committed result, and changes nothing then', () => {
    const w = createWorld(5, { components: TIME_COMPONENTS });
    startExperience(w, 'raid', 'mission:raid');
    w.step();
    stampCommitment(w, 'raid', 'mission:raid');
    const before = w.canonical();
    const logged = w.events().length;
    const refusals = [
      [startExperience(w, 'raid', 'x'), 'mission_committed'],
      [addExperience(w, 'raid', 1, 'x'), 'mission_committed'],
      [stampCommitment(w, 'raid', 'x'), 'mission_committed'],
      [addExperience(w, 'ghost', 1, 'x'), 'mission_not_open'],
      [stampCommitment(w, 'ghost', 'x'), 'mission_not_open'],
      [startExperience(w, '9lives', 'x'), 'bad_id'],
      [freezeEvent(w, 'two words', 'x'), 'bad_id'],
      [unfreezeEvent(w, 'battle', 'x'), 'event_not_frozen'],
    ] as const;
    for (const [result, code] of refusals) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(code);
    }
    startExperience(w, 'convoy', 'mission:convoy');
    const opened = w.canonical();
    expect(startExperience(w, 'convoy', 'x')).toMatchObject({ ok: false, code: 'mission_open' });
    expect(addExperience(w, 'convoy', -1, 'x')).toMatchObject({ ok: false, code: 'bad_ticks' });
    expect(addExperience(w, 'convoy', 1.5, 'x')).toMatchObject({ ok: false, code: 'bad_ticks' });
    expect(stampCommitment(w, 'convoy', 'x', 0)).toMatchObject({ ok: false, code: 'bad_ticks' });
    expect(w.canonical()).toBe(opened);
    expect(before).not.toBe(opened);
    expect(w.events().length).toBe(logged + 1);
  });

  it('refuses to freeze an event twice', () => {
    const w = createWorld(5, { components: TIME_COMPONENTS });
    expect(freezeEvent(w, 'battle', 'mission:raid')).toEqual({ ok: true });
    expect(freezeEvent(w, 'battle', 'mission:other')).toMatchObject({ ok: false, code: 'event_frozen' });
    expect(timeOf(w).frozen()).toEqual([{ event: 'battle', by: 'mission:raid', since: 0 }]);
  });
});

describe('a frozen patrol', () => {
  it('stands still while its event is frozen and walks on after', () => {
    const w = createWorld(1, {
      components: [...STANDARD_COMPONENTS, Terrain, ...SYSTEM_COMPONENTS, ...TIME_COMPONENTS],
      systems: [patrolSystem],
    });
    w.add(w.spawn(), Terrain, flatTerrain(6, 1));
    const guard = w.spawn();
    w.add(guard, Position, { x: 0, y: 0, z: 0 });
    w.add(guard, Walk, { wait: 0 });
    w.add(guard, Patrol, { waypoints: [{ x: 5, y: 0, z: 0 }], index: 0 });
    joinEvent(w, guard, 'watch', 'scenario');
    w.step();
    expect(w.get(guard, Position)?.x).toBe(1);
    freezeEvent(w, 'watch', 'mission:sneak');
    for (let i = 0; i < 5; i++) w.step();
    expect(w.get(guard, Position)?.x).toBe(1);
    unfreezeEvent(w, 'watch', 'mission:sneak');
    w.step();
    expect(w.get(guard, Position)?.x).toBe(2);
  });
});

describe('the battle fixture with its battle frozen', () => {
  const ORDERS = (fixture('battle.run.json') as { orders: ({ tick: number } & Record<string, unknown>)[] })
    .orders;
  const FREEZE_AT = 92;
  const FROZEN_TICKS = 40;
  // The fighting units: red soldiers 7 and 13 and the blue force 8-10 (the workers 5, 6 and 12 are
  // the economy, not the battle).
  const BATTLE = [7, 8, 9, 10, 13];

  function applyRunOrders(w: World): void {
    for (const { tick, ...order } of ORDERS) {
      if (tick === w.tick) expect(applyOrder(w, order).ok).toBe(true);
    }
  }

  /** The battle up to FREEZE_AT, then a new barracks ordered and the battle frozen. */
  function frozenBattle(): { w: World; site: Entity } {
    const w = worldFromScenario(fixture('battle.world.json'));
    while (w.tick < FREEZE_AT) {
      applyRunOrders(w);
      w.step();
    }
    w.withCause('test', (tw) => inventoryAdd(tw, stockpileOf(tw, 'red') as Entity, 'gold', 100));
    const site = w.nextId;
    const build = { id: 100, faction: 'red', type: 'build', units: [6], target: { x: 0, y: 7 } };
    expect(applyOrder(w, { ...build, building: 'barracks' })).toMatchObject({ ok: true });
    for (const id of BATTLE) joinEvent(w, id, 'battle', 'scenario:battle');
    expect(freezeEvent(w, 'battle', 'mission:raid')).toEqual({ ok: true });
    return { w, site };
  }

  const stateOf = (w: World, id: Entity) => ({
    position: w.get(id, Position) ?? null,
    health: w.get(id, Health) ?? null,
    cooldown: w.get(id, Cooldown) ?? null,
  });

  it("finishes a building while the battle's units do not move, fight or cool down", () => {
    const { w, site } = frozenBattle();
    const held = BATTLE.map((id) => stateOf(w, id));
    expect(held.filter((s) => s.cooldown !== null).length).toBeGreaterThan(0);
    expect(w.get(site, Construction)?.done).toBe(false);
    for (let i = 0; i < FROZEN_TICKS; i++) {
      w.step();
      expect(
        BATTLE.map((id) => stateOf(w, id)),
        `tick ${w.tick}`,
      ).toEqual(held);
    }
    expect(w.get(site, Building)?.kind).toBe('barracks');
    expect(w.get(site, Construction)?.done).toBe(true);
    expect(w.get(site, Health)).toEqual({ hp: 200, max: 200 });
    // No change at all touched a battle unit while it was frozen.
    expect(
      w.events(FREEZE_AT).filter((e) => BATTLE.includes(e.entity) && e.cause !== 'scenario:battle'),
    ).toEqual([]);

    expect(unfreezeEvent(w, 'battle', 'mission:raid')).toEqual({ ok: true });
    for (let i = 0; i < 10; i++) w.step();
    expect(BATTLE.map((id) => (w.alive(id) ? stateOf(w, id) : null))).not.toEqual(held);
  });

  it('logs the freeze and the unfreeze with their cause', () => {
    const { w } = frozenBattle();
    w.step();
    unfreezeEvent(w, 'battle', 'mission:raid');
    const changes = w.events().filter((e) => e.component === WorldTime.name);
    expect(changes.map((e) => [e.tick, e.cause, e.op, (e.value as { frozen: unknown[] }).frozen])).toEqual([
      [FREEZE_AT, 'mission:raid', 'add', [{ event: 'battle', by: 'mission:raid', since: FREEZE_AT }]],
      [FREEZE_AT + 1, 'mission:raid', 'set', []],
    ]);
    const joins = w.events().filter((e) => e.component === EventMember.name);
    expect(joins.map((e) => [e.entity, e.cause])).toEqual(BATTLE.map((id) => [id, 'scenario:battle']));
  });

  it('saves and loads mid-freeze and steps on with the same hashes', () => {
    const run = (saveAt: number | null): string[] => {
      let { w } = frozenBattle();
      const hashes: string[] = [];
      for (let i = 0; i < FROZEN_TICKS + 20; i++) {
        if (i === saveAt) {
          const text = canonicalJson(saveWorld(w));
          w = loadWorld(JSON.parse(text) as unknown, SYSTEM_SETS.rts);
          expect(canonicalJson(saveWorld(w))).toBe(text);
        }
        if (i === FROZEN_TICKS) unfreezeEvent(w, 'battle', 'mission:raid');
        w.step();
        hashes.push(hash(w));
      }
      return hashes;
    };
    const whole = run(null);
    expect(run(null)).toEqual(whole);
    for (const saveAt of [0, 7, 25]) expect(run(saveAt), `save at ${saveAt}`).toEqual(whole);
  });
});

describe('time changes during a step', () => {
  it('are logged under the running system, with the cause given kept in the data', () => {
    const w = createWorld(1, {
      components: TIME_COMPONENTS,
      systems: [{ name: 'missions', run: (sw) => void freezeEvent(sw, 'battle', 'mission:raid') }],
    });
    w.step();
    const [spawn, add] = w.events();
    expect([spawn?.op, spawn?.cause, add?.op, add?.cause]).toEqual(['spawn', 'missions', 'add', 'missions']);
    expect(timeOf(w).frozen()).toEqual([{ event: 'battle', by: 'mission:raid', since: 0 }]);
  });
});
