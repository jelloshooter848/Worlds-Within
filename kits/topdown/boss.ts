import { TILE, boxesOverlap, dirToward, type Box, type Dir } from './geometry';
import { ENEMY_KNOCK_FRAMES, Poof, TdEnemy, type TdEntity } from './entity';
import { Projectile } from './enemies';
import { circleHits } from './items';
import type { Mover, TopDownWorld } from './world';

/**
 * A data-driven boss (Engine 0.16 part C T6): a room's `boss` field (`RoomDef.boss`, checked by
 * `bossSchema` in `schema.ts`) declares it, and the kit only steps it. Everything it does is in
 * the form: its size, hit points, touch damage, hit invulnerability, knockback resistance, a
 * looping pattern of steps, phases by hit points (their own patterns and speed), a defeat
 * sequence and the world flag its defeat sets. See `kits/topdown/CLAUDE.md`, "Bosses".
 */

/** Stands still for `ticks` ticks. */
export interface BossIdle {
  do: 'idle';
  ticks: number;
}

/** Stands still and announces an attack (`boss-telegraph`) for `ticks` ticks. */
export interface BossTelegraph {
  do: 'telegraph';
  ticks: number;
  /** The attack it announces (a free name, usually the next step's `do`): `telegraph-<attack>`. */
  attack: string;
}

/** Runs at the hero (aimed once, at its start) until a wall stops it or `ticks` pass. */
export interface BossCharge {
  do: 'charge';
  /** Pixels a tick (the phase's or the boss's `speed` when left out). */
  speed?: number;
  /** The longest it runs (BOSS_CHARGE_TICKS when left out). */
  ticks?: number;
}

/**
 * Shoots `count` shots from its centre: a `ring` all round (from `start`, or aimed at the hero
 * with `aim`), or a `spread` fanned `gap` apart round the hero's direction. Directions are the 32
 * of `BOSS_DIRS` (11.25 degrees apart); `jitter` turns each volley by up to that many of them,
 * drawn from the world's RNG.
 */
export interface BossShoot {
  do: 'shoot';
  pattern: 'ring' | 'spread';
  count: number;
  /** Pixels a tick (BOSS_SHOT_SPEED when left out). */
  speed?: number;
  /** Half hearts a shot takes (1 when left out). */
  damage?: number;
  /** A spread's gap between shots, in `BOSS_DIRS` steps (2, 22.5 degrees, when left out). */
  gap?: number;
  /** A ring's first direction in `BOSS_DIRS` steps (0, right; 8 is down) when not aimed. */
  start?: number;
  /** A ring starts at the hero's direction instead of `start`. */
  aim?: boolean;
  /** Each volley turned by a random number of `BOSS_DIRS` steps in -jitter..jitter. */
  jitter?: number;
  /** Ticks the step lasts (1 when left out). */
  ticks?: number;
}

/** An area hit round its centre: the hero within `radius` px is hurt. */
export interface BossSlam {
  do: 'slam';
  radius: number;
  /** Half hearts (the boss's `contact` when left out). */
  damage?: number;
  /** Ticks the step lasts (1 when left out). */
  ticks?: number;
}

/**
 * Calls up `count` minions beside it, each of a kind from `kinds` (spawn kinds, as the room
 * legend's: `bat`, `knight`, or a game's own; picked by the world's RNG when there are several),
 * never more than `max` of its minions alive at once.
 */
export interface BossSummon {
  do: 'summon';
  kinds: readonly string[];
  /** How many a summon calls (1 when left out). */
  count?: number;
  /** The most of its minions alive at once (3 when left out). */
  max?: number;
  /** Ticks the step lasts (1 when left out). */
  ticks?: number;
}

export type BossStep = BossIdle | BossTelegraph | BossCharge | BossShoot | BossSlam | BossSummon;

/** A phase: from `hp` hit points left (or fewer), this pattern, from its first step. */
export interface BossPhase {
  hp: number;
  pattern: readonly BossStep[];
  /** A charge's speed in this phase (else the boss's). */
  speed?: number;
}

/** A boss's form: what a room's `boss` field holds (`bossSchema`). */
export interface BossDef {
  /** Names it: presented as `boss:<id>`, and in its events' `boss`. */
  id: string;
  /** Its name for the HUD (`bossName`); the id when left out. */
  name?: string;
  /** Its top-left cell in the room, [column, row]; the whole box must stand on floor. */
  at: readonly [number, number];
  /** Its box in pixels, [width, height] ([32, 32] when left out). */
  size?: readonly [number, number];
  hp: number;
  /** Half hearts a touch takes (2 when left out). */
  contact?: number;
  /** Ticks after a hit in which it cannot be hit again (BOSS_HIT_INVULN when left out). */
  hitInvuln?: number;
  /** How little the sword pushes it, 0 (like any monster) to 1 (not at all, the default). */
  knockResist?: number;
  /** A charge's pixels a tick (2 when left out). */
  speed?: number;
  /** Flies over water, pits and blocks (it walks when left out). */
  flies?: boolean;
  /** Its steps, looped. */
  pattern: readonly BossStep[];
  /** Later phases, highest `hp` first (each below the boss's hp and the phase before). */
  phases?: readonly BossPhase[];
  /** Ticks of its defeat sequence (BOSS_DEFEAT_TICKS when left out). */
  defeatTicks?: number;
  /** A world flag its defeat sets (`world.flags`, the snapshot's `flags`): `bossDefeated`. */
  flag?: string;
}

export const BOSS_SIZE: readonly [number, number] = [32, 32];
export const BOSS_CONTACT = 2;
export const BOSS_HIT_INVULN = 30;
export const BOSS_SPEED = 2;
export const BOSS_CHARGE_TICKS = 90;
export const BOSS_SHOT_SPEED = 2;
export const BOSS_DEFEAT_TICKS = 60;
export const BOSS_SUMMON_MAX = 3;
/** Ticks after a hit the boss is presented as `hurt`. */
export const BOSS_HURT_TICKS = 12;

/**
 * The 32 directions shots fly in (11.25 degrees apart, 0 right, 8 down, 16 left, 24 up), from
 * written-out constants, so no trigonometry decides a shot's path (the same in every JS engine).
 */
const QUARTER = [
  1, 0.9807852804032304, 0.9238795325112867, 0.8314696123025452, 0.7071067811865476, 0.5555702330196022,
  0.3826834323650898, 0.19509032201612825, 0,
];
export const BOSS_DIRS: readonly { x: number; y: number }[] = Array.from({ length: 32 }, (_, k) => {
  const q = k % 8;
  const c = QUARTER[q] as number;
  const s = QUARTER[8 - q] as number;
  const [x, y] = [
    [c, s],
    [-s, c],
    [-c, -s],
    [s, -c],
  ][k >> 3] as [number, number];
  // `+ 0` turns a -0 into 0.
  return { x: x + 0, y: y + 0 };
});

/** The `BOSS_DIRS` index nearest the way from (fx, fy) to (tx, ty) (right when they meet). */
export function dirIndexToward(fx: number, fy: number, tx: number, ty: number): number {
  const dx = tx - fx;
  const dy = ty - fy;
  let best = 0;
  let bestDot = -Infinity;
  BOSS_DIRS.forEach((d, i) => {
    const dot = d.x * dx + d.y * dy;
    if (dot > bestDot) [best, bestDot] = [i, dot];
  });
  return best;
}

/** A boss's shot: a hostile `Projectile` (kind `boss-shot`) flying over water and pits. */
export class BossShot extends Projectile {
  readonly kind = 'boss-shot';
  constructor(x: number, y: number, vx: number, vy: number, damage = 1) {
    super(x, y, vx, vy, null);
    this.damage = damage;
  }
}

/** Where a boss stands: fighting, or in its defeat sequence (then it is gone). */
export type BossMode = 'fight' | 'dying';

/**
 * The boss: a big `TdEnemy` stepping its form's pattern. Its state is whole numbers (`hp`,
 * `phase`, `step`, `tick`, `invuln`) and its mode; a charge keeps its aim and its sub-pixel place.
 * Its turn is the world's step 3 (every entity's update): hit invulnerability counts down, a sword
 * knockback runs, then `think` plays the step. A step's first tick starts it (the telegraph's and
 * attack's events, the shots, the slam, the summon); the step is over after its ticks (a charge
 * also at a wall), then the next comes, after the last the first again.
 */
export class TdBoss extends TdEnemy {
  readonly kind: string;
  hp: number;
  readonly maxHp: number;
  mode: BossMode = 'fight';
  /** 0: the form's `pattern`; n: its `phases[n - 1]`. */
  phase = 0;
  step = 0;
  /** Ticks into the step (in its defeat sequence: into that). */
  tick = 0;
  override dropChance = 0;
  override knockable = false;
  override contact: number;
  override mover: Mover;
  /** Its minions still in the room (summons). */
  readonly minions: TdEnemy[] = [];
  private vx = 0;
  private vy = 0;
  private fx = 0;
  private fy = 0;

  constructor(
    x: number,
    y: number,
    readonly def: BossDef,
  ) {
    super(x, y);
    const [w, h] = def.size ?? BOSS_SIZE;
    this.w = w;
    this.h = h;
    this.kind = `boss:${def.id}`;
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.contact = def.contact ?? BOSS_CONTACT;
    this.mover = def.flies ? 'fly' : 'walk';
  }

  /** The name for the HUD. */
  get name(): string {
    return this.def.name ?? this.def.id;
  }

  /** The pattern of the phase it is in. */
  get pattern(): readonly BossStep[] {
    return this.phase === 0
      ? this.def.pattern
      : (this.def.phases?.[this.phase - 1]?.pattern ?? this.def.pattern);
  }

  /** The step it is on. */
  get current(): BossStep {
    return this.pattern[this.step % this.pattern.length] as BossStep;
  }

  /** The phase its hit points call for: how many phases' `hp` are at or over `hp`. */
  phaseFor(hp: number): number {
    return (this.def.phases ?? []).filter((ph) => hp <= ph.hp).length;
  }

  /** Its centre in room pixels. */
  centre(): { x: number; y: number } {
    return { x: this.x + this.w / 2, y: this.y + this.h / 2 };
  }

  /** The place its events carry (its centre) and the boss's id. */
  private about(): { boss: string; x: number; y: number } {
    const c = this.centre();
    return { boss: this.def.id, x: c.x, y: c.y };
  }

  /** Bosses take no stun (a boomerang only clinks). */
  override stunFor(): number {
    return 0;
  }

  protected think(world: TopDownWorld): void {
    if (this.mode === 'dying') {
      if (++this.tick >= (this.def.defeatTicks ?? BOSS_DEFEAT_TICKS)) this.finish(world);
      return;
    }
    // Off: the boss only stands there (and can still be hit).
    if (!world.rules.isOn('boss-patterns')) return;
    const step = this.current;
    if (this.tick === 0) this.begin(world, step);
    const stopped = step.do === 'charge' && !this.chargeStep(world);
    this.tick++;
    if (stopped || this.tick >= stepTicks(step)) {
      this.step = (this.step + 1) % this.pattern.length;
      this.tick = 0;
    }
  }

  /** A step's first tick: what it announces or does at once. */
  private begin(world: TopDownWorld, step: BossStep): void {
    const c = this.centre();
    const hero = world.hero.hurtbox();
    const hx = hero.x + hero.w / 2;
    const hy = hero.y + hero.h / 2;
    switch (step.do) {
      case 'idle':
        return;
      case 'telegraph':
        world.emit({ type: 'boss-telegraph', attack: step.attack, ticks: step.ticks, ...this.about() }, this);
        return;
      case 'charge': {
        const speed = step.speed ?? this.def.phases?.[this.phase - 1]?.speed ?? this.def.speed ?? BOSS_SPEED;
        const dx = hx - c.x;
        const dy = hy - c.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        [this.vx, this.vy] = len === 0 ? [0, 0] : [(dx / len) * speed, (dy / len) * speed];
        [this.fx, this.fy] = [this.x, this.y];
        world.emit({ type: 'boss-attack', attack: 'charge', ...this.about() }, this);
        return;
      }
      case 'shoot':
        this.shoot(world, step, dirIndexToward(c.x, c.y, hx, hy));
        return;
      case 'slam': {
        const damage = step.damage ?? this.contact;
        world.emit({ type: 'boss-attack', attack: 'slam', radius: step.radius, ...this.about() }, this);
        const h = world.hero;
        if (!h.dying && circleHits(c.x, c.y, step.radius, h.hurtbox()))
          h.hurt(world, damage, dirToward(this.body(), h.hurtbox()));
        return;
      }
      case 'summon':
        this.summon(world, step);
        return;
    }
  }

  /** One tick of a charge; false when something stopped it. */
  private chargeStep(world: TopDownWorld): boolean {
    if (this.vx === 0 && this.vy === 0) return false;
    this.fx += this.vx;
    this.fy += this.vy;
    const ok = world.moveEntity(this, Math.round(this.fx) - this.x, Math.round(this.fy) - this.y, this.mover);
    if (!ok) [this.fx, this.fy] = [this.x, this.y];
    return ok;
  }

  private shoot(world: TopDownWorld, step: BossShoot, aimed: number): void {
    const jitter = step.jitter ?? 0;
    const turn = jitter > 0 ? world.rng.int(jitter * 2 + 1) - jitter : 0;
    const dirs: number[] = [];
    if (step.pattern === 'ring') {
      const from = step.aim ? aimed : (step.start ?? 0);
      for (let i = 0; i < step.count; i++) dirs.push(from + Math.round((i * 32) / step.count));
    } else {
      const gap = step.gap ?? 2;
      for (let i = 0; i < step.count; i++) dirs.push(aimed + Math.round((i - (step.count - 1) / 2) * gap));
    }
    const speed = step.speed ?? BOSS_SHOT_SPEED;
    const c = this.centre();
    for (const k of dirs) {
      const d = BOSS_DIRS[(((k + turn) % 32) + 32) % 32] as { x: number; y: number };
      world.add(new BossShot(c.x - 4, c.y - 4, d.x * speed, d.y * speed, step.damage ?? 1));
    }
    world.emit(
      { type: 'boss-attack', attack: 'shoot', pattern: step.pattern, count: dirs.length, ...this.about() },
      this,
    );
  }

  /** The cells beside it a minion may stand on: left, right, below, above (centred on it). */
  private summonSpots(world: TopDownWorld): Box[] {
    const col = Math.floor((this.x + this.w / 2) / TILE);
    const row = Math.floor((this.y + this.h / 2) / TILE);
    const left = Math.floor(this.x / TILE) - 1;
    const right = Math.floor((this.x + this.w - 1) / TILE) + 1;
    const top = Math.floor(this.y / TILE) - 1;
    const bottom = Math.floor((this.y + this.h - 1) / TILE) + 1;
    const cells: [number, number][] = [
      [left, row],
      [right, row],
      [col, bottom],
      [col, top],
    ];
    const hero = world.hero.hurtbox();
    return cells
      .map(([c, r]) => ({ x: c * TILE, y: r * TILE, w: TILE, h: TILE }))
      .filter(
        (b) =>
          world.onFloor(b) &&
          !world.blocked(b, 'walk') &&
          !boxesOverlap(b, hero) &&
          !world.entities.some((e) => e.enemy && !e.dead && boxesOverlap(e.body(), b)),
      );
  }

  private summon(world: TopDownWorld, step: BossSummon): void {
    for (let i = this.minions.length - 1; i >= 0; i--) if (this.minions[i]?.dead) this.minions.splice(i, 1);
    const room = Math.max(0, (step.max ?? BOSS_SUMMON_MAX) - this.minions.length);
    const spots = this.summonSpots(world).slice(0, Math.min(step.count ?? 1, room));
    for (const b of spots) {
      const kind = step.kinds.length > 1 ? world.rng.pick(step.kinds) : (step.kinds[0] as string);
      const make = world.spawners[kind];
      if (!make) throw new Error(`boss "${this.def.id}": no spawner for "${kind}"`);
      const e = make(world, { kind, col: b.x / TILE, row: b.y / TILE, x: b.x, y: b.y });
      if (!(e instanceof TdEnemy)) continue;
      world.add(e);
      this.minions.push(e);
    }
    world.emit({ type: 'boss-attack', attack: 'summon', count: spots.length, ...this.about() }, this);
  }

  /**
   * A hit (the sword, a beam, a bomb): unless it is in its hit invulnerability or already
   * beaten, it loses `damage` hit points, starts `hitInvuln` ticks of invulnerability
   * (`boss-hit-invuln`), is pushed back as little as its `knockResist` says and, at a phase's hp,
   * starts that phase (`boss-phases`). At 0 its defeat sequence starts (`boss-defeat`).
   */
  override hurt(world: TopDownWorld, damage: number, dir: Dir): boolean {
    if (this.invuln > 0 || this.dead || this.mode === 'dying') return false;
    this.hp = Math.max(0, this.hp - damage);
    const invuln = world.rules.isOn('boss-hit-invuln') ? (this.def.hitInvuln ?? BOSS_HIT_INVULN) : 0;
    this.invuln = invuln;
    const knock = Math.round(ENEMY_KNOCK_FRAMES * (1 - (this.def.knockResist ?? 1)));
    if (knock > 0 && this.hp > 0) {
      this.kbDir = dir;
      this.kbT = knock;
      this.vx = 0;
      this.vy = 0;
    }
    world.emit({ type: 'hit', kind: this.kind }, this);
    const phase = world.rules.isOn('boss-phases') ? this.phaseFor(this.hp) : this.phase;
    world.emit(
      {
        type: 'boss-hit',
        hp: this.hp,
        maxHp: this.maxHp,
        phase: Math.max(phase, this.phase),
        invuln,
        ...this.about(),
      },
      this,
    );
    if (this.hp <= 0) {
      this.defeat(world);
      return true;
    }
    if (phase > this.phase) {
      this.phase = phase;
      this.step = 0;
      this.tick = 0;
      world.emit({ type: 'boss-phase', phase, hp: this.hp, ...this.about() }, this);
    }
    return true;
  }

  /** Its hit points are gone: the defeat sequence starts, its minions vanish. */
  private defeat(world: TopDownWorld): void {
    this.mode = 'dying';
    this.tick = 0;
    this.invuln = 0;
    this.kbT = 0;
    this.contact = 0;
    for (const m of this.minions)
      if (!m.dead) {
        m.dead = true;
        world.add(new Poof(m.x + m.w / 2 - 8, m.y + m.h / 2 - 8));
      }
    for (const e of world.entities) if (e instanceof BossShot) e.dead = true;
    world.emit(
      { type: 'boss-defeat', ticks: this.def.defeatTicks ?? BOSS_DEFEAT_TICKS, ...this.about() },
      this,
    );
  }

  /** The end of its defeat sequence: it is gone, and the world hears (`TopDownWorld.bossDown`). */
  private finish(world: TopDownWorld): void {
    this.dead = true;
    const c = this.centre();
    world.add(new Poof(c.x - 8, c.y - 8));
    world.emit({ type: 'kill', kind: this.kind }, this);
    world.bossDown(this);
  }

  /** It does not die like a monster (no loot); its defeat sequence ends it (`finish`). */
  override die(): void {}

  /** What it is doing, for presentation: a `BOSS_ANIMS` state. */
  get anim(): string {
    if (this.mode === 'dying') return 'dying';
    const hit = this.def.hitInvuln ?? BOSS_HIT_INVULN;
    if (this.invuln > 0 && hit - this.invuln < BOSS_HURT_TICKS) return 'hurt';
    const s = this.current;
    if (s.do === 'telegraph') return `telegraph-${s.attack}`;
    return s.do;
  }
}

/** How many ticks a step lasts at most (a charge stops sooner at a wall). */
export function stepTicks(step: BossStep): number {
  switch (step.do) {
    case 'idle':
    case 'telegraph':
      return step.ticks;
    case 'charge':
      return step.ticks ?? BOSS_CHARGE_TICKS;
    default:
      return step.ticks ?? 1;
  }
}

/** The bosses of a set of entities that are still in the room (for the HUD). */
export function bossesIn(entities: readonly TdEntity[]): TdBoss[] {
  return entities.filter((e): e is TdBoss => e instanceof TdBoss && !e.dead);
}
