import type { Renderer } from '@engine/gfx/renderer';
import { DIRS, DIR_VEC, OPPOSITE, TILE, mod, type Box, type Dir } from './geometry';
import { TdEnemy, TdEntity } from './entity';
import type { TdView } from './view';
import type { Mover, TopDownWorld } from './world';

/**
 * A straight-flying shot. Positions are kept as floats so any angle works; `dir` is set for
 * shots that travel along an axis.
 */
export class Projectile extends TdEntity {
  override layer = 2;
  override w = 8;
  override h = 8;
  damage = 1;
  /** Hurts the hero (as opposed to a shot of the hero's own). */
  hostile = true;
  mover: Mover = 'shot';
  frames: readonly string[] = ['rock'];
  color = '#bcbcbc';
  private fx: number;
  private fy: number;

  constructor(
    x: number,
    y: number,
    readonly vx: number,
    readonly vy: number,
    readonly dir: Dir | null,
  ) {
    super(Math.round(x), Math.round(y));
    this.fx = x;
    this.fy = y;
  }

  override hurtbox(): Box {
    return { x: this.x + 1, y: this.y + 1, w: this.w - 2, h: this.h - 2 };
  }

  update(world: TopDownWorld): void {
    this.fx += this.vx;
    this.fy += this.vy;
    this.x = Math.round(this.fx);
    this.y = Math.round(this.fy);
    if (world.blocked(this.body(), this.mover, this)) this.dead = true;
  }

  render(r: Renderer, view: TdView, ox: number, oy: number): void {
    const sheet = view.sheet(view.sheets.enemies);
    const f = this.frames[(view.frame >> 2) % this.frames.length] as string;
    if (sheet?.frames.has(f)) r.sprite(sheet, f, ox + this.x, oy + this.y);
    else r.rect(ox + this.x + 1, oy + this.y + 1, 6, 6, this.color);
  }
}

export const ROCK_SPEED = 2;

/** A spitter's rock: flies straight along its facing. */
export class Rock extends Projectile {
  constructor(x: number, y: number, dir: Dir) {
    const v = DIR_VEC[dir];
    super(x, y, v.dx * ROCK_SPEED, v.dy * ROCK_SPEED, dir);
  }
}

/**
 * A bat: flutters in short bursts in any of eight directions, changing course often, and rests
 * now and then. Flies over water and blocks but not walls. One hit.
 */
export class Bat extends TdEnemy {
  readonly kind = 'bat';
  hp = 1;
  override mover: Mover = 'fly';
  override knockable = true;
  private vx = 0;
  private vy = 0;
  /** Frames left in the current leg (flying) or rest. */
  private t = 0;
  resting = true;
  private flightLeft = 0;

  constructor(x: number, y: number) {
    super(x, y);
  }

  override hurtbox(): Box {
    return { x: this.x + 2, y: this.y + 4, w: 12, h: 8 };
  }

  protected think(world: TopDownWorld): void {
    const rng = world.rng;
    if (this.t > 0) this.t--;
    if (this.resting) {
      if (this.t === 0) {
        this.resting = false;
        this.flightLeft = 90 + rng.int(120);
        this.newLeg(world);
      }
      return;
    }
    if (--this.flightLeft <= 0) {
      this.resting = true;
      this.t = 30 + rng.int(50);
      return;
    }
    if (this.t === 0) this.newLeg(world);
    // Wings beat: two pixels on most frames, a pause every fourth.
    if ((world.frame & 3) === 0) return;
    if (!world.moveEntity(this, this.vx, this.vy, this.mover)) this.newLeg(world);
  }

  private newLeg(world: TopDownWorld): void {
    const rng = world.rng;
    this.t = 12 + rng.int(28);
    do {
      this.vx = rng.int(3) - 1;
      this.vy = rng.int(3) - 1;
    } while (this.vx === 0 && this.vy === 0);
  }

  render(r: Renderer, view: TdView, ox: number, oy: number): void {
    if (this.blinkHidden(view)) return;
    const sheet = view.sheet(view.sheets.enemies);
    const f = this.resting ? 'bat-0' : `bat-${(view.frame >> 2) & 1}`;
    if (sheet?.frames.has(f)) r.sprite(sheet, f, ox + this.x, oy + this.y);
    else r.rect(ox + this.x + 2, oy + this.y + 5, 12, 6, '#9878f8');
  }
}

/**
 * Something that walks the tile grid in four directions: it turns only on a tile, sometimes at
 * random and always when the way ahead is shut, and after a knockback it first walks back onto
 * the grid. `speed` is a 4-frame pattern of pixel steps.
 */
export abstract class Walker extends TdEnemy {
  protected speed: readonly number[] = [1, 1, 1, 0];
  /** Chance of a random turn at each tile. */
  protected turnChance = 0.25;
  protected anim = 0;

  /** One frame of walking. Returns false when it bumped into something. */
  protected walk(world: TopDownWorld): boolean {
    const step = this.speed[world.frame & 3] ?? 1;
    if (step === 0) return true;
    if (!this.aligned()) {
      // Back onto the grid on the axis across the facing (a knockback may have pushed it off).
      const v = DIR_VEC[this.facing];
      if (v.dx !== 0 && mod(this.y, TILE) !== 0) this.facing = mod(this.y, TILE) < TILE / 2 ? 'up' : 'down';
      else if (v.dy !== 0 && mod(this.x, TILE) !== 0)
        this.facing = mod(this.x, TILE) < TILE / 2 ? 'left' : 'right';
    } else this.chooseTurn(world);
    const v = DIR_VEC[this.facing];
    this.anim++;
    if (world.moveEntity(this, v.dx * step, v.dy * step, this.mover)) return true;
    this.facing = OPPOSITE[this.facing];
    return false;
  }

  protected openDirs(world: TopDownWorld): Dir[] {
    return DIRS.filter((d) => {
      const v = DIR_VEC[d];
      return !world.blocked(
        { x: this.x + v.dx * TILE, y: this.y + v.dy * TILE, w: TILE, h: TILE },
        this.mover,
        this,
      );
    });
  }

  protected chooseTurn(world: TopDownWorld): void {
    const open = this.openDirs(world);
    if (open.length === 0) return;
    if (!open.includes(this.facing) || world.rng.chance(this.turnChance)) this.facing = world.rng.pick(open);
  }
}

/** A skeleton knight: walks and turns on the grid. Two hits. */
export class Knight extends Walker {
  readonly kind = 'knight';
  hp = 2;

  protected think(world: TopDownWorld): void {
    this.walk(world);
  }

  render(r: Renderer, view: TdView, ox: number, oy: number): void {
    if (this.blinkHidden(view)) return;
    const sheet = view.sheet(view.sheets.enemies);
    const side = this.facing === 'left' || this.facing === 'right';
    const name = side ? 'side' : this.facing;
    const f = `knight-${name}-${(this.anim >> 3) & 1}`;
    if (sheet?.frames.has(f)) r.sprite(sheet, f, ox + this.x, oy + this.y, this.facing === 'left');
    else {
      r.rect(ox + this.x + 2, oy + this.y + 1, 12, 14, '#bcbcbc');
      r.rect(ox + this.x + 4, oy + this.y + 3, 8, 3, '#404040');
    }
  }
}

/** Frames a spitter stands still before it spits, and after. */
export const SPIT_WINDUP = 24;
export const SPIT_HOLD = 20;

/**
 * A rock-spitter: walks like a knight, then stops on a tile, faces its way and spits a rock in
 * a straight line. One hit.
 */
export class Spitter extends Walker {
  readonly kind = 'spitter';
  hp = 1;
  /** Frames of walking left before the next stop. */
  walkLeft = 0;
  /** Frames into the current stop (0 while walking). */
  stopT = 0;

  protected override speed: readonly number[] = [1, 0, 1, 0];

  constructor(x: number, y: number) {
    super(x, y);
    this.walkLeft = 40;
  }

  protected think(world: TopDownWorld): void {
    if (this.stopT > 0) {
      this.stopT++;
      if (this.stopT === SPIT_WINDUP) this.spit(world);
      if (this.stopT >= SPIT_WINDUP + SPIT_HOLD) {
        this.stopT = 0;
        this.walkLeft = 60 + world.rng.int(90);
      }
      return;
    }
    if (this.walkLeft > 0) this.walkLeft--;
    if (this.walkLeft === 0 && this.aligned()) {
      this.stopT = 1;
      return;
    }
    this.walk(world);
  }

  private spit(world: TopDownWorld): void {
    const v = DIR_VEC[this.facing];
    world.add(new Rock(this.x + 4 + v.dx * 8, this.y + 4 + v.dy * 8, this.facing));
    world.emit({ type: 'spit' });
  }

  render(r: Renderer, view: TdView, ox: number, oy: number): void {
    if (this.blinkHidden(view)) return;
    const sheet = view.sheet(view.sheets.enemies);
    const side = this.facing === 'left' || this.facing === 'right';
    const f = `spitter-${side ? 'side' : 'down'}-${this.stopT > 0 ? 0 : (this.anim >> 3) & 1}`;
    if (sheet?.frames.has(f))
      r.sprite(sheet, f, ox + this.x, oy + this.y, this.facing === 'left', this.facing === 'up');
    else {
      r.rect(ox + this.x + 2, oy + this.y + 2, 12, 12, '#e45c10');
      const v = DIR_VEC[this.facing];
      r.rect(ox + this.x + 6 + v.dx * 6, oy + this.y + 6 + v.dy * 6, 4, 4, '#000000');
    }
  }
}
