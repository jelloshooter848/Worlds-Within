import { describe, expect, it } from 'vitest';
import type { Action } from '@engine/core/input/actions';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { validate } from '@engine/core/content/validate';
import { presentFrameSchema } from '@engine/core/present';
import { BOSS_DIRS, BossShot, TdBoss, dirIndexToward, type BossDef, type BossStep } from './boss';
import { buildDungeon, parseRoom, type RoomDef } from './room';
import { TopDownWorld, eventPlace, type TdEvent, type TdWorldOptions } from './world';
import { presentWorld, TdPresentState } from './present';
import { roomSchema } from './schema';
import { snapshotWorld } from './snapshot';
import { TILE } from './geometry';

// The data-driven boss (Engine 0.16 part C T6): a tiny fixture boss in a room whose east shutter
// seals until it is down. Each test changes only the form's fields it is about.

const MAP = [
  '################',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..@...........X',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '################',
];

const NEXT = [
  '################',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  'O..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '################',
];

/** The fixture boss: 4 hp, 10 ticks of hit invulnerability, standing at col 10, row 4. */
const BOSS: BossDef = {
  id: 'ogre',
  name: 'The Ogre',
  at: [10, 4],
  hp: 4,
  hitInvuln: 10,
  defeatTicks: 20,
  flag: 'bossDefeated',
  pattern: [{ do: 'idle', ticks: 1000 }],
};

function room(boss: Partial<BossDef> = {}, extra: Partial<RoomDef> = {}): RoomDef {
  return { id: 'lair', at: [0, 0], map: MAP, shutters: 'boss', boss: { ...BOSS, ...boss }, ...extra };
}

function world(boss: Partial<BossDef> = {}, opts: TdWorldOptions = {}, extra: Partial<RoomDef> = {}) {
  const d = buildDungeon([room(boss, extra), { id: 'beyond', at: [1, 0], map: NEXT }]);
  const w = new TopDownWorld(d, { seed: 1, ...opts });
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
  const boss_ = w.entities.find((e): e is TdBoss => e instanceof TdBoss) as TdBoss;
  return { w, boss: boss_, step };
}

const types = (es: readonly TdEvent[]) => es.map((e) => e.type);
const pattern = (steps: BossStep[]): Partial<BossDef> => ({ pattern: steps });

describe('a boss declared in data', () => {
  it('stands in its room at its cell, presented as boss:<id> with a HUD bar', () => {
    const { w, boss } = world();
    expect(boss.x).toBe(10 * TILE);
    expect(boss.y).toBe(4 * TILE);
    expect([boss.w, boss.h]).toEqual([32, 32]);
    expect(boss.kind).toBe('boss:ogre');
    const frame = presentWorld(w);
    expect(validate('frame.json', frame, presentFrameSchema).errors).toEqual([]);
    const p = frame.entities.find((e) => e.kind === 'boss:ogre');
    expect(p).toMatchObject({ w: 32, h: 32, anim: { state: 'idle' } });
    expect(p?.tags).toContain('boss');
    expect(frame.status).toMatchObject({ bossHp: 4, bossMaxHp: 4, bossName: 'The Ogre', bossPhase: 0 });
    const snap = snapshotWorld(w);
    expect(snap.entities.find((e) => e.kind === 'boss:ogre')).toEqual({
      kind: 'boss:ogre',
      x: 160,
      y: 64,
      key: '10,4',
      hp: 4,
      boss: { mode: 'fight', phase: 0, step: 0, tick: 0, invuln: 0 },
    });
    expect(snap.flags).toBeUndefined();
  });

  it('loops its pattern: idle, a telegraph (with its event) and back', () => {
    const { w, boss, step } = world(
      pattern([
        { do: 'idle', ticks: 3 },
        { do: 'telegraph', ticks: 2, attack: 'slam' },
      ]),
    );
    expect(types(step([], 3)).filter((t) => t.startsWith('boss'))).toEqual([]);
    expect(boss.step).toBe(1);
    const tele = step();
    expect(tele).toEqual([{ type: 'boss-telegraph', boss: 'ogre', attack: 'slam', ticks: 2, x: 176, y: 80 }]);
    expect(presentWorld(w).entities.find((e) => e.kind === 'boss:ogre')?.anim).toEqual({
      state: 'telegraph-slam',
      t: 1,
    });
    step();
    expect([boss.step, boss.tick]).toEqual([0, 0]);
  });

  it('charges at the hero until a wall stops it', () => {
    const { w, boss, step } = world(
      pattern([
        { do: 'charge', speed: 3 },
        { do: 'idle', ticks: 500 },
      ]),
    );
    w.hero.x = 2 * TILE;
    w.hero.y = 4 * TILE + 8;
    const first = step();
    expect(first).toContainEqual(expect.objectContaining({ type: 'boss-attack', attack: 'charge' }));
    expect(boss.x).toBe(160 - 3);
    expect(presentWorld(w).entities.find((e) => e.kind === 'boss:ogre')?.anim.state).toBe('charge');
    w.hero.y = 9 * TILE; // out of the way: the wall stops it
    step([], 60);
    expect(boss.x).toBe(TILE);
    expect(boss.step).toBe(1);
  });

  it('shoots a ring all round and a spread at the hero', () => {
    const ring = world(
      pattern([
        { do: 'shoot', pattern: 'ring', count: 8 },
        { do: 'idle', ticks: 99 },
      ]),
    );
    expect(types(ring.step())).toContain('boss-attack');
    const shots = ring.w.entities.filter((e): e is BossShot => e instanceof BossShot);
    expect(shots).toHaveLength(8);
    expect(
      shots.map((s) => [Math.sign(Math.round(s.vx * 100)) || 0, Math.sign(Math.round(s.vy * 100)) || 0]),
    ).toEqual([
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ]);
    const spread = world(
      pattern([
        { do: 'shoot', pattern: 'spread', count: 3, gap: 4 },
        { do: 'idle', ticks: 99 },
      ]),
    );
    spread.step();
    const fan = spread.w.entities.filter((e): e is BossShot => e instanceof BossShot);
    expect(fan).toHaveLength(3);
    // The hero is left of the boss: the middle shot flies straight left.
    expect(fan[1]?.vx).toBeCloseTo(-2);
    expect(fan[1]?.vy).toBeCloseTo(0);
    expect(fan[0]?.vy).not.toBeCloseTo(0);
    expect(dirIndexToward(0, 0, -5, 0)).toBe(16);
    expect(BOSS_DIRS[8]).toEqual({ x: 0, y: 1 });
  });

  it('hurts the hero with its shots', () => {
    const { w, step } = world(
      pattern([
        { do: 'shoot', pattern: 'spread', count: 1, damage: 2 },
        { do: 'idle', ticks: 999 },
      ]),
    );
    const hp = w.hero.hp;
    const out = step([], 120);
    expect(types(out)).toContain('hurt');
    expect(w.hero.hp).toBe(hp - 2);
  });

  it('slams an area round itself: the hero inside is hurt, outside not', () => {
    const near = world(
      pattern([
        { do: 'slam', radius: 40, damage: 3 },
        { do: 'idle', ticks: 99 },
      ]),
    );
    near.w.hero.x = 8 * TILE;
    near.w.hero.y = 4 * TILE;
    const hp = near.w.hero.hp;
    const out = near.step();
    expect(out).toContainEqual(expect.objectContaining({ type: 'boss-attack', attack: 'slam', radius: 40 }));
    expect(near.w.hero.hp).toBe(hp - 3);
    const far = world(
      pattern([
        { do: 'slam', radius: 40 },
        { do: 'idle', ticks: 99 },
      ]),
    );
    far.step();
    expect(far.w.hero.hp).toBe(hp);
  });

  it('summons minions of its kinds beside it, never more than max alive', () => {
    const { boss, step } = world(
      pattern([
        { do: 'summon', kinds: ['knight', 'bat'], count: 2, max: 3 },
        { do: 'idle', ticks: 2 },
      ]),
    );
    const out = step();
    expect(out).toContainEqual(expect.objectContaining({ type: 'boss-attack', attack: 'summon', count: 2 }));
    expect(boss.minions).toHaveLength(2);
    expect(boss.minions.map((m) => [m.x, m.y])).toEqual([
      [9 * TILE, 5 * TILE],
      [12 * TILE, 5 * TILE],
    ]);
    step([], 3);
    expect(boss.minions).toHaveLength(3);
    step([], 3);
    expect(boss.minions).toHaveLength(3);
    // The kinds come from the seeded RNG: the same seed picks the same ones.
    const again = world(boss.def);
    again.step([], 4);
    expect(again.boss.minions.map((m) => m.kind)).toEqual(boss.minions.map((m) => m.kind));
  });

  it('refuses a summon of a kind the world cannot spawn', () => {
    expect(() => world(pattern([{ do: 'summon', kinds: ['dragon'] }]))).toThrow(/summons "dragon"/);
  });

  it('takes a sword hit: hp, hit invulnerability, the hit events with a place, a flash', () => {
    const { w, boss, step } = world();
    w.hero.x = 8 * TILE + 4;
    w.hero.y = 4 * TILE + 8;
    w.hero.facing = 'right';
    const out = step(['attack'], 8);
    expect(boss.hp).toBe(3);
    const hit = out.find((e) => e.type === 'boss-hit');
    expect(hit).toEqual({
      type: 'boss-hit',
      hp: 3,
      maxHp: 4,
      phase: 0,
      invuln: 10,
      boss: 'ogre',
      x: 176,
      y: 80,
    });
    const kitHit = out.find((e) => e.type === 'hit') as TdEvent;
    // The place rides beside the event (no new field in it, so hashes keep), and is presented.
    expect(kitHit).toEqual({ type: 'hit', kind: 'boss:ogre' });
    expect(eventPlace(kitHit)).toMatchObject({ entity: boss, x: 176, y: 80 });
    const frame = presentWorld(w, out, { state: new TdPresentState() });
    const ev = frame.events.find((e) => e['type'] === 'hit');
    expect(ev).toMatchObject({ kind: 'boss:ogre', entity: 'lair/boss:ogre@10,4' });
    expect(typeof ev?.['x']).toBe('number');
    const p = frame.entities.find((e) => e.kind === 'boss:ogre');
    expect(p?.tags).toEqual(expect.arrayContaining(['invuln', 'flashing']));
    expect(p?.anim.state).toBe('hurt');
    // Within its hit invulnerability another hit does nothing.
    expect(boss.hurt(w, 1, 'right')).toBe(false);
    expect(boss.hp).toBe(3);
    // Bosses stand firm by default.
    expect(boss.x).toBe(10 * TILE);
  });

  it('a knockResist under 1 lets the sword push it', () => {
    const { w, boss, step } = world({ knockResist: 0 });
    boss.hurt(w, 1, 'right');
    step();
    expect(boss.x).toBeGreaterThan(10 * TILE);
  });

  it('boss-hit-invuln off: a hit boss can be hit again at once', () => {
    const { w, boss } = world({}, { disabledRules: ['boss-hit-invuln'] });
    expect(boss.hurt(w, 1, 'right')).toBe(true);
    expect(boss.hurt(w, 1, 'right')).toBe(true);
    expect(boss.hp).toBe(2);
  });

  it('enters a phase at its hp: that pattern from its first step, and its speed', () => {
    const def: Partial<BossDef> = {
      pattern: [{ do: 'idle', ticks: 50 }],
      phases: [{ hp: 2, speed: 4, pattern: [{ do: 'charge' }, { do: 'idle', ticks: 50 }] }],
      hitInvuln: 0,
    };
    const { w, boss, step } = world(def);
    boss.hurt(w, 1, 'up');
    expect(boss.phase).toBe(0);
    w.events.length = 0;
    boss.hurt(w, 1, 'up');
    expect(boss.phase).toBe(1);
    expect(w.events).toContainEqual(expect.objectContaining({ type: 'boss-phase', phase: 1, hp: 2 }));
    step();
    expect(boss.x).toBe(10 * TILE - 4);
    const off = world(def, { disabledRules: ['boss-phases'] });
    off.boss.hurt(off.w, 2, 'up');
    expect(off.boss.phase).toBe(0);
  });

  it('boss-patterns off: it only stands', () => {
    const { boss, step } = world(pattern([{ do: 'charge' }]), { disabledRules: ['boss-patterns'] });
    expect(types(step([], 30)).filter((t) => t.startsWith('boss'))).toEqual([]);
    expect(boss.x).toBe(10 * TILE);
  });

  it('seals its room until it is down, then plays its defeat sequence and opens the way on', () => {
    const { w, boss, step } = world({
      pattern: [
        { do: 'summon', kinds: ['bat'] },
        { do: 'idle', ticks: 99 },
      ],
    });
    step([], 2);
    expect(w.sealed).toBe(true);
    expect(w.shuttersShut()).toBe(true);
    expect(boss.minions).toHaveLength(1);
    w.events.length = 0;
    for (let i = 0; i < 4; i++) {
      boss.invuln = 0;
      boss.hurt(w, 1, 'up');
    }
    expect(types(w.events)).toContain('boss-defeat');
    expect(w.events).toContainEqual(expect.objectContaining({ type: 'boss-defeat', ticks: 20 }));
    expect(boss.mode).toBe('dying');
    expect(boss.minions[0]?.dead).toBe(true);
    expect(boss.contact).toBe(0);
    w.events.length = 0;
    const during = step([], 19);
    expect(types(during)).not.toContain('boss-defeated');
    expect(presentWorld(w).entities.find((e) => e.kind === 'boss:ogre')?.anim.state).toBe('dying');
    expect(w.shuttersShut()).toBe(true);
    const end = step();
    expect(types(end)).toEqual(expect.arrayContaining(['kill', 'boss-defeated', 'met', 'shutters']));
    expect(end).toContainEqual({ type: 'boss-defeated', boss: 'ogre', flag: 'bossDefeated' });
    expect(end).toContainEqual({ type: 'shutters', open: true });
    expect(w.shuttersShut()).toBe(false);
    expect(snapshotWorld(w).flags).toEqual(['bossDefeated']);
    expect(presentWorld(w).status['bossHp']).toBeUndefined();
    // It stays beaten: coming back, the room has no boss.
    w.warpTo('beyond', 32, 80);
    w.warpTo('lair', 64, 80);
    expect(w.entities.some((e) => e instanceof TdBoss)).toBe(false);
  });

  it('boss-seals-room off: the shutters never shut', () => {
    const { w, step } = world({}, { disabledRules: ['boss-seals-room'] });
    step([], 2);
    expect(w.sealed).toBe(true);
    expect(w.shuttersShut()).toBe(false);
  });

  it('is the same fight from the same seed, and its jitter another from another seed', () => {
    const def = pattern([
      { do: 'telegraph', ticks: 4, attack: 'shoot' },
      { do: 'shoot', pattern: 'ring', count: 4, jitter: 3 },
      { do: 'summon', kinds: ['bat', 'knight'] },
      { do: 'charge', ticks: 20 },
    ]);
    const play = (seed: number) => {
      const { w, step } = world(def, { seed });
      const snaps: string[] = [];
      for (let i = 0; i < 200; i++) {
        step(i % 30 < 15 ? ['up'] : ['down']);
        snaps.push(JSON.stringify(snapshotWorld(w)));
      }
      return snaps;
    };
    expect(play(5)).toEqual(play(5));
    expect(play(5)).not.toEqual(play(6));
  });

  it('changes nothing in a room without a boss', () => {
    const d = buildDungeon([{ id: 'r', at: [0, 0], map: MAP.map((r) => r.replace('X', '#')) }]);
    const w = new TopDownWorld(d, { seed: 1 });
    const snap = snapshotWorld(w);
    expect('flags' in snap).toBe(false);
    expect(presentWorld(w).status['bossHp']).toBeUndefined();
  });
});

describe('the boss form in room files', () => {
  const schema = roomSchema();
  const check = (def: unknown) => validate('lair.json', def, schema).errors.map((e) => `${e.path} ${e.code}`);

  it('takes a whole boss with every step kind and phases', () => {
    const full = room({
      size: [32, 48],
      contact: 1,
      knockResist: 0.5,
      speed: 3,
      pattern: [
        { do: 'idle', ticks: 10 },
        { do: 'telegraph', ticks: 20, attack: 'charge' },
        { do: 'charge', speed: 3, ticks: 40 },
        { do: 'shoot', pattern: 'ring', count: 8, jitter: 2 },
        { do: 'slam', radius: 40 },
        { do: 'summon', kinds: ['bat'], count: 2, max: 4 },
      ],
      phases: [
        { hp: 3, pattern: [{ do: 'idle', ticks: 5 }] },
        { hp: 1, speed: 4, pattern: [{ do: 'charge' }] },
      ],
    });
    expect(check(full)).toEqual([]);
    expect(parseRoom(full).def.boss?.id).toBe('ogre');
  });

  it('refuses phases out of order, a bad step, a boss off the floor and a boss condition without one', () => {
    expect(check(room({ phases: [{ hp: 4, pattern: [{ do: 'idle', ticks: 1 }] }] }))).toEqual([
      'boss.phases.0.hp custom',
    ]);
    expect(check(room({ pattern: [{ do: 'jump', ticks: 1 } as unknown as BossStep] }))[0]).toMatch(
      /^boss\.pattern\.0/,
    );
    expect(check(room({ at: [14, 4] }))).toEqual(['map.4 invalid_room']);
    expect(() => parseRoom(room({ at: [14, 4] }))).toThrow(/does not fit/);
    const noBoss = { id: 'lair', at: [0, 0], map: MAP, shutters: 'boss' };
    expect(() => parseRoom(noBoss as unknown as RoomDef)).toThrow(/needs a `boss`/);
  });
});
