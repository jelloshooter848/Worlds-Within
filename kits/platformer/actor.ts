import { px, tileAt, velToSub } from '@engine/core/math/units';
import type { RuleSwitch } from '@engine/core/rules';
import { makeBody, moveX, moveY, type Body } from './body';
import { BossState } from './boss';
import type { ActorType, ProfileDef } from './profile';
import type { TileGrid } from './tiles';

/** An actor's box when its type gives none, in px. */
export const DEFAULT_ACTOR_BOX = { w: 16, h: 16 } as const;
/** Ticks a kicked (or freshly stomped) actor leaves the player alone when its type gives none. */
export const DEFAULT_KICK_GRACE = 15;

/**
 * An actor: one enemy of a level, of an actor type from the profile (`walker`, `shell`, ...).
 * Its behaviour is the type's data; the code only reads it.
 *
 * A tick of an active actor (`step`):
 *   1. on the ground, a `turnAt: ledges` type turns round before the edge of a drop (`ledge-turn`);
 *   2. it walks `dir * speed` (its type's `speed`, or its `kickSpeed` once kicked), x then y;
 *   3. a wall turns it round (`walkers-turn`), keeping its speed;
 *   4. in the air `actorGravity` applies, capped at `actorMaxFall` (`gravity`, `fall-cap`), but
 *      not to a `projectile: flies` type (`boss-projectiles`).
 *
 * A boss (its type has a `boss` form) starts still; the world sets its `speed` and way each tick
 * from its pattern (`boss.ts`).
 *
 * An actor waits (does not move) until the world wakes it, near the view (`actors-wake`).
 */
export class Actor {
  readonly body: Body;
  /** The way it walks. */
  dir: -1 | 1;
  /** Its walking speed now, in 1/4096 px per tick: the type's `speed`, or `kickSpeed` once kicked. */
  speed: number;
  /** Woken near the view; a waiting actor neither moves nor touches anything. */
  active = false;
  /** Ticks left in which it does not touch the player (after a kick or a stomp). */
  grace = 0;
  /** Its boss state, when its type has a `boss` form (Engine 0.16 T2), else null. */
  readonly boss: BossState | null;

  /**
   * An actor of `type` with the bottom centre of its box at x/y (sub-pixels), walking `dir`.
   * `id` is its number in the level, kept when a stomp changes its type.
   */
  constructor(
    readonly id: number,
    readonly type: string,
    readonly def: ActorType,
    x: number,
    y: number,
    dir: -1 | 1,
  ) {
    const box = def.box ?? DEFAULT_ACTOR_BOX;
    this.body = makeBody(x - (px(box.w) >> 1), y - px(box.h), box.w, box.h);
    this.dir = dir;
    this.speed = def.speed;
    this.boss = def.boss ? new BossState(def.boss) : null;
    if (this.boss) this.speed = 0;
  }

  /** The bottom centre of its box (sub-pixels). */
  get feet(): { x: number; y: number } {
    return { x: this.body.x + (this.body.w >> 1), y: this.body.y + this.body.h };
  }

  /** A kickable actor that moves: it defeats the actors it touches (`shell-hits-enemies`). */
  get isMovingShell(): boolean {
    return this.def.kickable && this.speed > 0;
  }

  /** One tick of movement. */
  step(tiles: TileGrid, profile: ProfileDef, rules: RuleSwitch): void {
    const b = this.body;
    if (this.grace > 0) this.grace--;
    if (b.onGround && this.speed > 0 && this.def.turnAt === 'ledges' && rules.isOn('ledge-turn')) {
      // The tile just ahead of the leading edge, one pixel under the feet (as SMBC probes it).
      const col = tileAt(this.dir < 0 ? b.x - px(1) : b.x + b.w + px(1));
      const row = tileAt(b.y + b.h + px(1));
      if (tiles.collisionAt(col, row) === 'empty') this.dir = this.dir < 0 ? 1 : -1;
    }
    b.vx = this.dir * this.speed;
    moveX(b, tiles, velToSub(b.vx));
    if (b.hitWall !== 0) {
      if (rules.isOn('walkers-turn')) this.dir = b.hitWall < 0 ? 1 : -1;
      b.vx = 0;
    }
    moveY(b, tiles, b.onGround ? Math.max(velToSub(b.vy), 1) : velToSub(b.vy), true);
    if (b.onGround) b.vy = 0;
    else if (this.def.projectile === 'flies' && rules.isOn('boss-projectiles')) b.vy = 0;
    else if (rules.isOn('gravity')) {
      b.vy += profile.actorGravity;
      if (rules.isOn('fall-cap') && b.vy > profile.actorMaxFall) b.vy = profile.actorMaxFall;
    }
  }
}
