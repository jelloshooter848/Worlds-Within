import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { px } from '@engine/core/math/units';
import { presentFrameSchema } from '@engine/core/present';
import { validate } from '@engine/core/content/validate';
import { BossState, stepOver } from './boss';
import { checkLevel, levelSchema } from './level';
import { presentWorld, PlatformerPresentState, presentStatus } from './present';
import { profileSchema, type ProfileDef } from './profile';
import { BOSS_RULES } from './rules';
import { platformerGame, type PlatformerSnapshot } from './snapshot';
import { PlatformerWorld } from './world';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const BASE = JSON.parse(fixture('runner.profile.json')) as Record<string, unknown> & {
  actors: Record<string, unknown>;
};

/** A boss type with `boss` as its form (24x24, stompable, harmful). */
const bossType = (boss: Record<string, unknown>) => ({
  box: { w: 24, h: 24 },
  speed: 0,
  turnAt: 'walls',
  stompable: true,
  kickable: false,
  harms: true,
  boss,
});
const BOLT = {
  box: { w: 8, h: 8 },
  speed: 8192,
  turnAt: 'walls',
  stompable: false,
  kickable: false,
  harms: true,
  projectile: 'flies',
};
const ROCK = { ...BOLT, speed: 0, projectile: 'falls' };

/** The fixture profile with a `boss` type of the given form and two projectile types. */
function profileWith(boss: Record<string, unknown>, extra: Record<string, unknown> = {}): ProfileDef {
  return profileSchema.parse({
    ...BASE,
    player: { ...(BASE['player'] as object), lives: 2, ...extra },
    actors: { ...BASE.actors, boss: bossType(boss), bolt: BOLT, rock: ROCK },
  });
}

interface Setup {
  map: string[];
  profile: ProfileDef;
  ticks: number;
  header?: Record<string, unknown>;
  seed?: number;
}

/** Plays a setup standing still with `off` rules switched off: the snapshot after each tick. */
function play(s: Setup, off: string[] = []): PlatformerSnapshot[] {
  const level = levelSchema.parse({
    id: 'arena',
    profile: 'runner',
    clear: 'boss',
    spawns: { b: { actor: 'boss' } },
    ...s.header,
    map: s.map,
  });
  const world = new PlatformerWorld(level, s.profile, { seed: s.seed ?? 3, disabledRules: off });
  const game = platformerGame(world);
  const input = new ScriptedInput({ steps: [] });
  const out: PlatformerSnapshot[] = [];
  for (let i = 0; i < s.ticks; i++) {
    input.next();
    game.step(input);
    out.push(game.snapshot() as PlatformerSnapshot);
  }
  return out;
}

const events = (snaps: PlatformerSnapshot[], type: string): (JsonObject & { tick: number })[] =>
  snaps.flatMap((s, tick) => s.events.filter((e) => e.type === type).map((e) => ({ ...e, tick })));
const bossOf = (s: PlatformerSnapshot) => s.actors.find((a) => a.boss);

/** The player starts over the boss and keeps bouncing on it (standing still). */
const BOUNCE_MAP = [
  '............',
  '.....@......',
  '............',
  '............',
  '.....b......',
  '############',
];
const BOUNCE = (hitInvuln: number): Setup => ({
  map: BOUNCE_MAP,
  ticks: 200,
  profile: profileWith({
    hp: 4,
    hitInvuln,
    defeatTicks: 20,
    pattern: [{ do: 'idle', ticks: 600 }],
    phases: [{ hp: 2, pattern: [{ do: 'telegraph', ticks: 600, attack: 'rage' }] }],
  }),
});

/** The player on a two-tile pillar at the left; the boss on the floor at the right. */
const PILLAR_MAP = [
  '..............',
  '..............',
  '.@............',
  '##............',
  '##..........b.',
  '##############',
];
const CHARGE: Setup = {
  map: PILLAR_MAP,
  ticks: 160,
  profile: profileWith({
    hp: 3,
    hitInvuln: 30,
    defeatTicks: 20,
    pattern: [
      { do: 'idle', ticks: 5 },
      { do: 'telegraph', ticks: 6, attack: 'charge' },
      { do: 'charge', speed: 8192 },
    ],
  }),
};
const SHOOT: Setup = {
  map: PILLAR_MAP,
  ticks: 120,
  profile: profileWith({
    hp: 3,
    hitInvuln: 30,
    defeatTicks: 20,
    pattern: [
      { do: 'telegraph', ticks: 4, attack: 'shoot' },
      { do: 'shoot', actor: 'bolt' },
      { do: 'idle', ticks: 200 },
    ],
  }),
};
const DROP = (spread: number): Setup => ({
  map: PILLAR_MAP,
  ticks: 120,
  profile: profileWith({
    hp: 3,
    hitInvuln: 30,
    defeatTicks: 20,
    pattern: [
      { do: 'idle', ticks: 4 },
      { do: 'drop', actor: 'rock', spread },
      { do: 'idle', ticks: 200 },
    ],
  }),
});
const LEAP: Setup = {
  map: PILLAR_MAP,
  ticks: 120,
  profile: profileWith({
    hp: 3,
    hitInvuln: 30,
    defeatTicks: 20,
    pattern: [
      { do: 'idle', ticks: 4 },
      { do: 'leap', speed: 16384, run: 4096 },
      { do: 'idle', ticks: 200 },
    ],
  }),
};

const hitTicks = (s: PlatformerSnapshot[]) => events(s, 'boss-hit').map((e) => e.tick);

/**
 * The boss tests, each a check that holds with every rule on. The mutant test below switches
 * each boss rule off in turn and requires at least one of these to fail without it.
 */
const CASES: { name: string; holds: (off: string[]) => boolean }[] = [
  {
    name: 'a stomp takes one hit point, bounces the player, and the boss is hit again after its invulnerability',
    holds: (off) => {
      const s = play(BOUNCE(30), off);
      const first = s[hitTicks(s)[0] ?? 0]!;
      return (
        hitTicks(s).length === 4 &&
        bossOf(first)?.boss?.hp === 3 &&
        bossOf(first)?.boss?.invuln === 30 &&
        first.player.vy < 0 &&
        s.every((x) => x.player.hp === 2)
      );
    },
  },
  {
    name: 'a stomp in the hit invulnerability only bounces',
    holds: (off) => {
      const s = play({ ...BOUNCE(50), ticks: 60 }, off);
      const bounces = s.filter((x, i) => i > 0 && x.player.vy < 0 && s[i - 1]!.player.vy >= 0).length;
      return bounces === 3 && hitTicks(s).length === 1 && bossOf(s.at(-1)!)?.boss?.hp === 3;
    },
  },
  {
    name: "at a phase's hp the boss starts that phase's pattern",
    holds: (off) => {
      const s = play(BOUNCE(30), off);
      const second = s[hitTicks(s)[1] ?? 0]!;
      const telegraphs = events(s, 'boss-telegraph');
      return (
        bossOf(second)?.boss?.phase === 1 &&
        bossOf(second)?.boss?.step === 0 &&
        telegraphs.length === 1 &&
        telegraphs[0]!['attack'] === 'rage'
      );
    },
  },
  {
    name: 'at 0 hit points the defeat sequence runs defeatTicks ticks, then the level is cleared',
    holds: (off) => {
      const s = play(BOUNCE(30), off);
      const defeat = events(s, 'boss-defeat');
      if (defeat.length !== 1 || defeat[0]!['ticks'] !== 20) return false;
      const at = defeat[0]!.tick;
      return (
        bossOf(s[at]!)?.boss?.mode === 'defeated' &&
        bossOf(s[at + 19]!)?.boss?.tick === 19 &&
        s[at + 19]!.outcome === 'playing' &&
        s[at + 20]!.outcome === 'cleared' &&
        bossOf(s[at + 20]!) === undefined &&
        events(s, 'cleared').length === 1
      );
    },
  },
  {
    name: 'the pattern telegraphs, then charges to the wall, and loops',
    holds: (off) => {
      const s = play(CHARGE, off);
      const tele = events(s, 'boss-telegraph');
      const attacks = events(s, 'boss-attack');
      if (tele.length < 2 || attacks.length < 2) return false;
      const t0 = tele[0]!.tick;
      const wall = s.findIndex(
        (x, i) => i > t0 && bossOf(x)?.boss?.step === 0 && bossOf(s[i - 1]!)?.boss?.step === 2,
      );
      return (
        t0 === 5 &&
        tele[0]!['attack'] === 'charge' &&
        tele[0]!['ticks'] === 6 &&
        attacks[0]!.tick === 11 &&
        attacks[0]!['attack'] === 'charge' &&
        bossOf(s[12]!)!.vx === -8192 &&
        wall > 0 &&
        bossOf(s[wall]!)!.x === px(32 + 12) &&
        tele[1]!.tick === wall + 6 &&
        s.every((x) => x.player.hp === 2)
      );
    },
  },
  {
    name: 'a shot flies straight at its speed and is gone at a wall',
    holds: (off) => {
      const s = play(SHOOT, off);
      const attack = events(s, 'boss-attack')[0];
      if (attack?.['attack'] !== 'shoot') return false;
      const id = attack['projectile'];
      const bolt = (x: PlatformerSnapshot) => x.actors.find((a) => a.id === id);
      const flying = s.slice(attack.tick, attack.tick + 10).map(bolt);
      return (
        flying.every((b) => b !== undefined && b.y === flying[0]!.y && b.type === 'bolt') &&
        bolt(s[attack.tick + 2]!)!.vx === -8192 &&
        bolt(s.at(-1)!) === undefined
      );
    },
  },
  {
    name: "a drop falls over the player's column, hurts it and is gone",
    holds: (off) => {
      const s = play(DROP(0), off);
      const attack = events(s, 'boss-attack')[0];
      if (attack?.['attack'] !== 'drop') return false;
      const id = attack['projectile'];
      const rock = s[attack.tick]!.actors.find((a) => a.id === id);
      return (
        rock?.x === s[attack.tick]!.player.x &&
        events(s, 'hurt').length === 1 &&
        s.at(-1)!.actors.every((a) => a.id !== id)
      );
    },
  },
  {
    name: 'a leap takes off towards the player and ends on landing',
    holds: (off) => {
      const s = play(LEAP, off);
      const attack = events(s, 'boss-attack')[0];
      if (attack?.['attack'] !== 'leap') return false;
      const land = s.findIndex((x, i) => i > attack.tick && bossOf(x)?.boss?.step === 2);
      return (
        bossOf(s[attack.tick]!)!.onGround === false &&
        bossOf(s[attack.tick]!)!.dir === -1 &&
        land > attack.tick + 5 &&
        bossOf(s[land]!)!.onGround &&
        bossOf(s[land]!)!.x < bossOf(s[attack.tick]!)!.x
      );
    },
  },
];

describe('the platformer boss', () => {
  for (const c of CASES) it(c.name, () => expect(c.holds([])).toBe(true));

  it('fails at least one boss test with each boss rule switched off', () => {
    const weak = BOSS_RULES.map((r) => r.id).filter((id) => CASES.every((c) => c.holds([id])));
    expect(weak).toEqual([]);
  });

  it('drops with a spread from the seeded rng: the same run for a seed, the rng only drawn with a spread', () => {
    const run = (spread: number, seed: number) => play({ ...DROP(spread), ticks: 10, seed });
    expect(run(3, 5).map((x) => canonicalJson(x))).toEqual(run(3, 5).map((x) => canonicalJson(x)));
    expect(run(0, 5).at(-1)!.rng).toBe(run(0, 5)[0]!.rng);
    expect(run(3, 5).at(-1)!.rng).not.toBe(run(3, 5)[0]!.rng);
    const xs = [1, 2, 3, 4, 5, 6, 7, 8].map(
      (seed) =>
        run(3, seed)
          .at(-1)!
          .actors.find((a) => a.type === 'rock')!.x,
    );
    expect(new Set(xs).size).toBeGreaterThan(1);
  });

  it('keeps whole numbers and the boss state in the snapshot, and other actors without a boss key', () => {
    const s = play(BOUNCE(30));
    for (const x of s) {
      const nums = JSON.stringify(x).match(/-?\d+(\.\d+)?/g) ?? [];
      expect(nums.every((n) => Number.isInteger(Number(n)))).toBe(true);
    }
    expect(Object.keys(bossOf(s[0]!)!.boss!).sort()).toEqual([
      'hp',
      'invuln',
      'mode',
      'phase',
      'step',
      'tick',
    ]);
    const shot = play(SHOOT);
    expect(shot.at(20)!.actors.find((a) => a.type === 'bolt')).not.toHaveProperty('boss');
  });
});

describe('the boss state', () => {
  const def = profileWith({
    hp: 6,
    hitInvuln: 10,
    defeatTicks: 5,
    pattern: [
      { do: 'idle', ticks: 3 },
      { do: 'telegraph', ticks: 2, attack: 'charge' },
    ],
    phases: [
      { hp: 4, pattern: [{ do: 'idle', ticks: 1 }] },
      { hp: 2, pattern: [{ do: 'idle', ticks: 1 }] },
    ],
  }).actors['boss']!.boss!;

  it('steps through its pattern and loops', () => {
    const s = new BossState(def);
    expect(s.current).toEqual({ do: 'idle', ticks: 3 });
    s.next();
    expect([s.step, s.telegraph]).toEqual([1, 'charge']);
    s.next();
    expect([s.step, s.telegraph]).toEqual([0, '']);
  });

  it('picks the phase by the hit points left', () => {
    const s = new BossState(def);
    expect([6, 5, 4, 3, 2, 1].map((hp) => s.phaseFor(hp))).toEqual([0, 0, 1, 1, 2, 2]);
    s.enterPhase(2);
    expect(s.pattern).toEqual([{ do: 'idle', ticks: 1 }]);
  });

  it('says when each kind of step is over', () => {
    expect(stepOver({ do: 'idle', ticks: 3 }, 1, 0, true)).toBe(false);
    expect(stepOver({ do: 'idle', ticks: 3 }, 2, 0, true)).toBe(true);
    expect(stepOver({ do: 'shoot', actor: 'bolt' }, 0, 0, true)).toBe(true);
    expect(stepOver({ do: 'drop', actor: 'rock', ticks: 2 }, 0, 0, true)).toBe(false);
    expect(stepOver({ do: 'charge', speed: 1 }, 50, 0, true)).toBe(false);
    expect(stepOver({ do: 'charge', speed: 1 }, 3, -1, true)).toBe(true);
    expect(stepOver({ do: 'charge', speed: 1, ticks: 4 }, 3, 0, true)).toBe(true);
    expect(stepOver({ do: 'leap', speed: 1, run: 0 }, 0, 0, true)).toBe(false);
    expect(stepOver({ do: 'leap', speed: 1, run: 0 }, 5, 0, false)).toBe(false);
    expect(stepOver({ do: 'leap', speed: 1, run: 0 }, 5, 0, true)).toBe(true);
  });
});

describe('boss content checks', () => {
  const codes = (input: unknown) => {
    const r = profileSchema.safeParse(input);
    return r.success
      ? []
      : r.error.issues.map((i) => [(i as { params?: { code?: string } }).params?.code, i.path.join('.')]);
  };
  const withBoss = (type: Record<string, unknown>) => ({ ...BASE, actors: { bolt: BOLT, boss: type } });
  const form = { hp: 4, hitInvuln: 0, defeatTicks: 10, pattern: [{ do: 'shoot', actor: 'bolt' }] };

  it('accepts a boss form and reports a kickable boss, a stompInto, phases out of order and bad projectiles', () => {
    expect(codes(withBoss(bossType(form)))).toEqual([]);
    expect(codes(withBoss({ ...bossType(form), kickable: true, kickSpeed: 1 }))).toContainEqual([
      'bad_boss',
      'actors.boss.kickable',
    ]);
    expect(codes(withBoss({ ...bossType(form), stompInto: 'bolt' }))).toContainEqual([
      'bad_boss',
      'actors.boss.stompInto',
    ]);
    const phases = [
      { hp: 2, pattern: [{ do: 'idle', ticks: 1 }] },
      { hp: 3, pattern: [{ do: 'drop', actor: 'nothing' }] },
    ];
    expect(codes(withBoss(bossType({ ...form, phases })))).toEqual([
      ['bad_boss', 'actors.boss.boss.phases.1.hp'],
      ['unknown_actor', 'actors.boss.boss.phases.1.pattern.0.actor'],
    ]);
    expect(codes(withBoss(bossType({ ...form, pattern: [{ do: 'shoot', actor: 'boss' }] })))).toEqual([
      ['bad_boss', 'actors.boss.boss.pattern.0.actor'],
    ]);
    expect(codes(withBoss(bossType({ ...form, pattern: [] })))).not.toEqual([]);
    expect(codes(withBoss(bossType({ ...form, pattern: [{ do: 'dance', ticks: 1 }] })))).not.toEqual([]);
  });

  it('needs no goal but a boss spawn on the map in a level cleared by its boss', () => {
    const profile = profileWith(form);
    const level = (header: Record<string, unknown>, map: string[]) =>
      levelSchema.parse({
        id: 'a',
        profile: 'runner',
        spawns: { b: { actor: 'boss' }, w: { actor: 'walker' } },
        ...header,
        map,
      });
    const check = (header: Record<string, unknown>, map: string[]) =>
      checkLevel(level(header, map), profile).map((p) => p.code);
    expect(check({ clear: 'boss' }, ['.@..b.', '######'])).toEqual([]);
    expect(check({}, ['.@..b.', '######'])).toEqual(['no_goal']);
    expect(check({ clear: 'boss' }, ['.@..w.', '######'])).toEqual(['no_boss']);
    expect(check({ clear: 'goal' }, ['.@..bG', '######'])).toEqual([]);
  });
});

describe('boss presentation', () => {
  it('shows the boss state, hp, phase and telegraph as tags and HUD values, and places boss events at it', () => {
    const level = levelSchema.parse({
      id: 'arena',
      profile: 'runner',
      clear: 'boss',
      spawns: { b: { actor: 'boss' } },
      map: PILLAR_MAP,
    });
    const world = new PlatformerWorld(level, CHARGE.profile, { seed: 3 });
    const state = new PlatformerPresentState();
    const input = new ScriptedInput({ steps: [] });
    const seen = new Set<string>();
    let telegraphFrame = null;
    for (let i = 0; i < 40; i++) {
      input.next();
      world.update(input);
      const evs = world.events.splice(0);
      const frame = presentWorld(world, evs, { state });
      expect(validate('frame', frame, presentFrameSchema).ok).toBe(true);
      const boss = frame.entities.find((e) => e.id === 'actor#1')!;
      seen.add(boss.anim.state);
      if (evs.some((e) => e.type === 'boss-telegraph')) {
        telegraphFrame = frame;
        const ev = frame.events.find((e) => e.type === 'boss-telegraph')!;
        expect(ev).toMatchObject({ entity: 'actor#1', attack: 'charge', ticks: 6 });
        expect(ev.x).toBe(boss.x + (boss.w >> 1));
      }
    }
    expect([...seen].sort()).toEqual(['charge', 'idle', 'telegraph']);
    expect(telegraphFrame!.status).toMatchObject({
      bossHp: 3,
      bossMaxHp: 3,
      bossPhase: 0,
      bossState: 'telegraph',
      bossTelegraph: 'charge',
    });
    const boss = telegraphFrame!.entities.find((e) => e.id === 'actor#1')!;
    expect(boss.tags).toEqual(['boss', 'hp:3', 'phase:0', 'telegraph:charge']);
  });

  it('shows hurt after a hit and defeated through the defeat sequence, then the boss as gone', () => {
    const s = BOUNCE(30);
    const level = levelSchema.parse({
      id: 'arena',
      profile: 'runner',
      clear: 'boss',
      spawns: { b: { actor: 'boss' } },
      map: s.map,
    });
    const world = new PlatformerWorld(level, s.profile, { seed: 3 });
    const input = new ScriptedInput({ steps: [] });
    const states: string[] = [];
    for (let i = 0; i < 160; i++) {
      input.next();
      world.update(input);
      const st = presentStatus(world)['bossState'] as string;
      if (states.at(-1) !== st) states.push(st);
    }
    expect(states).toEqual([
      'idle',
      'hurt',
      'idle',
      'hurt',
      'telegraph',
      'hurt',
      'telegraph',
      'defeated',
      'gone',
    ]);
    expect(presentStatus(world)).toMatchObject({ bossHp: 0, bossMaxHp: 4, outcome: 'cleared' });
  });

  it('adds no boss HUD values in a level without a boss', () => {
    const level = levelSchema.parse({ id: 'a', profile: 'runner', map: ['.@..G', '#####'] });
    const world = new PlatformerWorld(
      level,
      profileWith({ hp: 1, hitInvuln: 0, defeatTicks: 1, pattern: [{ do: 'idle', ticks: 1 }] }),
    );
    expect(Object.keys(presentStatus(world)).some((k) => k.startsWith('boss'))).toBe(false);
  });
});
