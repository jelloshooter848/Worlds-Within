import type { Renderer } from '@engine/gfx/renderer';
import { DIR_VEC, TILE, boxesOverlap, centre, type Box, type Dir } from './geometry';
import { Pickup, TdEnemy, TdEntity } from './entity';
import { drawFrame, type TdView } from './view';
import type { TopDownWorld } from './world';

/**
 * Items, Zelda style: the hero owns some, one sits in the item slot, SPECIAL uses it and SELECT
 * moves the slot to the next one owned. An item may use ammo (a count with a cap, refilled by a
 * pickup). The kit brings two (the boomerang and bombs); a game may add its own.
 */
export interface TdItem {
  readonly id: string;
  /** Its name on the HUD, the touch button and in announcements ("BOOMERANG"). */
  readonly label: string;
  /** Its icon frame on the tile sheet (8×16, HUD item box and counters). */
  readonly icon: string;
  /** Ammo: how many come with the item, the most that can be carried, and the pickup that adds more. */
  readonly ammo?: { start: number; max: number; refill: number; pickup: string };
  /** Can it be used right now, ammo aside (e.g. not while one is still out)? */
  ready?(world: TopDownWorld): boolean;
  /** Uses it; true if it was used. The world has checked ammo and `ready`, and spends the ammo. */
  use(world: TopDownWorld): boolean;
}

/** The items the hero owns, the one in the slot, and ammo counts. */
export class Inventory {
  readonly owned: string[] = [];
  private slot = 0;
  private readonly ammo = new Map<string, number>();

  constructor(private readonly defs: Readonly<Record<string, TdItem>>) {}

  has(id: string): boolean {
    return this.owned.includes(id);
  }

  /** The item in the slot, or null when none is owned. */
  get current(): TdItem | null {
    const id = this.owned[this.slot];
    return id ? (this.defs[id] ?? null) : null;
  }

  /** Adds an item (with its starting ammo); the first one owned goes into the slot. False if already owned. */
  give(id: string): boolean {
    const def = this.defs[id];
    if (!def || this.has(id)) return false;
    this.owned.push(id);
    if (def.ammo) this.ammo.set(id, Math.min(def.ammo.max, (this.ammo.get(id) ?? 0) + def.ammo.start));
    return true;
  }

  /** Puts an owned item in the slot. */
  select(id: string): boolean {
    const i = this.owned.indexOf(id);
    if (i < 0) return false;
    this.slot = i;
    return true;
  }

  /** Moves the slot to the next owned item; false with fewer than two. */
  cycle(): boolean {
    if (this.owned.length < 2) return false;
    this.slot = (this.slot + 1) % this.owned.length;
    return true;
  }

  count(id: string): number {
    return this.ammo.get(id) ?? 0;
  }

  addAmmo(id: string, n: number): void {
    const max = this.defs[id]?.ammo?.max ?? 0;
    this.ammo.set(id, Math.max(0, Math.min(max, this.count(id) + n)));
  }

  /** Owned items that carry ammo, in the order they were found. */
  withAmmo(): TdItem[] {
    return this.owned.map((id) => this.defs[id]).filter((d): d is TdItem => !!d?.ammo);
  }
}

/* ------------------------------------------------------------------------------------------ */
/* The boomerang                                                                               */
/* ------------------------------------------------------------------------------------------ */

export const BOOMERANG_SPEED = 3;
/** How far it flies out before it turns back (if nothing stops it sooner). */
export const BOOMERANG_RANGE = 5 * TILE;
/** How long it stuns a monster (a boss may take less, TdEnemy.stunFor). */
export const STUN_FRAMES = 180;
/** A whirr sound event every this many frames in flight. */
export const WHIRR_EVERY = 12;

/**
 * The thrown boomerang: flies straight along the hero's facing until it has gone its range or
 * hits a wall, block or monster, then flies back to the hero through everything and is caught.
 * A monster it touches is stunned (it turns back); hearts, keys and ammo it touches ride back on
 * it and are the hero's on the catch (0.4.43: they used to vanish on contact). Leaving the room
 * loses it in flight, which only means it is ready again (what it carries is the hero's then).
 */
export class Boomerang extends TdEntity {
  override layer = 2;
  override w = 8;
  override h = 8;
  out = true;
  t = 0;
  private gone = 0;
  private fx: number;
  private fy: number;
  /** Pickups it touched, riding back on it (out of the room until the catch). */
  readonly carried: Pickup[] = [];

  constructor(
    x: number,
    y: number,
    readonly dir: Dir,
  ) {
    super(x, y);
    this.fx = x;
    this.fy = y;
  }

  override hurtbox(): Box {
    return this.body();
  }

  update(world: TopDownWorld): void {
    this.t++;
    if (this.t % WHIRR_EVERY === 1) world.emit({ type: 'whirr' });
    const hero = world.hero;
    if (this.out) {
      const v = DIR_VEC[this.dir];
      if (!world.moveEntity(this, v.dx * BOOMERANG_SPEED, v.dy * BOOMERANG_SPEED, 'shot')) this.out = false;
      this.fx = this.x;
      this.fy = this.y;
      this.gone += BOOMERANG_SPEED;
      if (this.gone >= BOOMERANG_RANGE) this.out = false;
    } else {
      const to = centre(hero.hurtbox());
      const dx = to.x - (this.fx + 4);
      const dy = to.y - (this.fy + 4);
      const d = Math.hypot(dx, dy);
      if (d <= BOOMERANG_SPEED) return this.caught(world);
      this.fx += (dx / d) * BOOMERANG_SPEED;
      this.fy += (dy / d) * BOOMERANG_SPEED;
      this.x = Math.round(this.fx);
      this.y = Math.round(this.fy);
      if (boxesOverlap(this.body(), hero.hurtbox())) return this.caught(world);
    }
    const me = this.body();
    for (const e of world.entities) {
      if (e.dead || !boxesOverlap(me, e.hurtbox())) continue;
      if (e instanceof TdEnemy && this.out) {
        e.stun(world, STUN_FRAMES);
        this.out = false;
      } else if (e instanceof Pickup && !e.hidden) {
        // Taken out of the room onto the boomerang; the hero gets it on the catch.
        e.dead = true;
        this.carried.push(e);
      }
    }
  }

  /** Back in the hero's hand: what it carries is his. */
  private caught(world: TopDownWorld): void {
    this.dead = true;
    this.deliver(world);
  }

  /** The hero gets what it carries (the catch, or the room left with it in flight). */
  deliver(world: TopDownWorld): void {
    for (const p of this.carried.splice(0)) {
      p.dead = false;
      world.collect(p);
    }
  }

  render(r: Renderer, view: TdView, ox: number, oy: number): void {
    const sheet = view.sheet(view.sheets.hero);
    drawFrame(r, sheet, `boomerang-${(this.t >> 2) & 3}`, ox + this.x, oy + this.y, '#ac7c00', {
      w: 8,
      h: 8,
    });
    // What it carries rides on it, centred.
    for (const p of this.carried) {
      p.x = this.x + 4 - (p.w >> 1);
      p.y = this.y + 4 - (p.h >> 1);
      p.render(r, view, ox, oy);
    }
  }
}

export const BOOMERANG: TdItem = {
  id: 'boomerang',
  label: 'BOOMERANG',
  icon: 'boomerang-icon',
  ready: (w) => !w.entities.some((e) => e instanceof Boomerang && !e.dead),
  use: (w) => {
    const h = w.hero;
    const v = DIR_VEC[h.facing];
    w.add(new Boomerang(h.x + 4 + v.dx * 8, h.y + 4 + v.dy * 8, h.facing));
    return true;
  },
};

/* ------------------------------------------------------------------------------------------ */
/* Bombs                                                                                       */
/* ------------------------------------------------------------------------------------------ */

/** Frames from setting a bomb down to the blast. */
export const BOMB_FUSE = 90;
/** The blast's reach from the bomb's middle, its damage to monsters and to the hero (half hearts). */
export const BLAST_RADIUS = 24;
export const BLAST_DAMAGE = 2;
export const BLAST_SELF_DAMAGE = 1;
/** How long the blast is drawn (it hurts on its first frame only). */
export const BLAST_FRAMES = 24;
/** A fuse sound event every this many frames. */
export const FUSE_EVERY = 15;

/**
 * A blast: on its first frame it hurts monsters and the hero within `radius` of its middle and
 * breaks cracked walls there (world.ts `blast`); then it is only drawn.
 */
export class Explosion extends TdEntity {
  override layer = 3;
  override w = 32;
  override h = 32;
  t = 0;
  constructor(
    readonly cx: number,
    readonly cy: number,
    readonly radius = BLAST_RADIUS,
    readonly damage = BLAST_DAMAGE,
    readonly selfDamage = BLAST_SELF_DAMAGE,
  ) {
    super(Math.round(cx - 16), Math.round(cy - 16));
  }
  override hurtbox(): Box {
    return { x: this.x, y: this.y, w: 0, h: 0 };
  }
  update(world: TopDownWorld): void {
    if (this.t++ === 0) world.blast(this.cx, this.cy, this.radius, this.damage, this.selfDamage);
    if (this.t >= BLAST_FRAMES) this.dead = true;
  }
  render(r: Renderer, view: TdView, ox: number, oy: number): void {
    const sheet = view.sheet(view.sheets.hero);
    const f = `blast-${Math.min(2, Math.floor((this.t * 3) / BLAST_FRAMES))}`;
    drawFrame(r, sheet, f, ox + this.x, oy + this.y, '#fca044', { w: 32, h: 32 });
  }
}

/** A lit bomb: it sits where it was set down and blows up when the fuse runs out. */
export class Bomb extends TdEntity {
  override layer = 0;
  fuse = BOMB_FUSE;
  update(world: TopDownWorld): void {
    if (this.fuse % FUSE_EVERY === 0) world.emit({ type: 'fuse' });
    if (--this.fuse > 0) return;
    this.dead = true;
    const blast = new Explosion(this.x + 8, this.y + 8);
    world.add(blast);
    world.emit({ type: 'blast' });
    blast.update(world); // it goes off this frame
  }
  render(r: Renderer, view: TdView, ox: number, oy: number): void {
    const sheet = view.sheet(view.sheets.hero);
    // The fuse flickers faster near the end (steady with reduce flashing).
    const rate = this.fuse < BOMB_FUSE / 3 ? 2 : 3;
    const f = view.reduceFlashing ? 'bomb-0' : `bomb-${(view.frame >> rate) & 1}`;
    drawFrame(r, sheet, f, ox + this.x, oy + this.y, '#2038ec');
  }
}

/** Bombs: set one down in front of the hero (one at a time); four come with them, up to eight. */
export const BOMBS: TdItem = {
  id: 'bomb',
  label: 'BOMB',
  icon: 'bomb-icon',
  ammo: { start: 4, max: 8, refill: 4, pickup: 'bombs' },
  ready: (w) => !w.entities.some((e) => e instanceof Bomb && !e.dead),
  use: (w) => {
    const h = w.hero;
    const v = DIR_VEC[h.facing];
    w.add(new Bomb(h.x + v.dx * 12, h.y + v.dy * 12));
    w.emit({ type: 'bomb' });
    return true;
  },
};

export const DEFAULT_ITEMS: Readonly<Record<string, TdItem>> = { boomerang: BOOMERANG, bomb: BOMBS };

/** Does a circle touch a box? */
export function circleHits(cx: number, cy: number, radius: number, b: Box): boolean {
  const nx = Math.max(b.x, Math.min(cx, b.x + b.w));
  const ny = Math.max(b.y, Math.min(cy, b.y + b.h));
  return (nx - cx) ** 2 + (ny - cy) ** 2 < radius * radius;
}
