import type { Action } from '@engine/input/actions';
import { ALIGN, swordReach } from './hero';
import {
  DIRS,
  DIR_VEC,
  mod,
  ROOM_H,
  ROOM_W,
  TILE,
  boxesOverlap,
  type Box,
  type Dir,
  type Side,
} from './geometry';
import { Rng } from '@engine/rng';
import { Chest, Pickup, PushBlock, type TdEntity } from './entity';
import { BOOMERANG_RANGE, Bomb, Explosion } from './items';
import { Projectile } from './enemies';
import type { TopDownWorld } from './world';

/**
 * A simple player for tests and tuning: walks the half-tile grid by breadth-first search, fights
 * by stepping to where the sword reaches an enemy (and stabbing, or stunning one further off
 * with a boomerang it owns), pushes blocks, opens chests, bombs walls and leaves rooms. A game
 * gives it a plan per room (a list of steps, or a function of the world for a room visited more
 * than once, picked on entry); it holds the actions for one frame at a time.
 */
export type BotStep =
  | { do: 'fight' }
  | { do: 'goto'; x: number; y: number }
  | { do: 'push'; dir: Dir; from: { x: number; y: number }; until: (w: TopDownWorld) => boolean }
  | { do: 'pickup' }
  | { do: 'chest' }
  | {
      do: 'bomb';
      /** Where to set it down from, facing `dir`; then wait at `hide` until `until`. */
      from: { x: number; y: number };
      dir: Dir;
      hide: { x: number; y: number };
      until: (w: TopDownWorld) => boolean;
    }
  | { do: 'leave'; side: Side };

export type BotPlan = readonly BotStep[] | ((w: TopDownWorld) => readonly BotStep[]);

/** Where to line up to leave by `side`: the floor just inside its doorway (walls `wall` thick). */
function inside(side: Side, wall: number): { x: number; y: number; dir: Dir } {
  const w = wall * TILE;
  switch (side) {
    case 'n':
      return { x: 7.5 * TILE, y: w, dir: 'up' };
    case 's':
      return { x: 7.5 * TILE, y: ROOM_H - w - TILE, dir: 'down' };
    case 'w':
      return { x: w, y: 5 * TILE, dir: 'left' };
    case 'e':
      return { x: ROOM_W - w - TILE, y: 5 * TILE, dir: 'right' };
  }
}

interface Node {
  x: number;
  y: number;
}

export class TopDownBot {
  private room = '';
  private step = 0;
  private attackHeld = false;
  /** Frames stuck on the current step (a goto that can't make progress moves on). */
  private stuck = 0;
  private lastDir: Dir | null = null;
  private plan: readonly BotStep[] = [];
  /** Buttons held last frame (a press needs a release in between). */
  private held: Action[] = [];

  constructor(
    private readonly plans: Readonly<Record<string, BotPlan>>,
    /** Pixels it keeps between itself and a monster while lining up a stab. */
    private readonly margin = 6,
  ) {}

  /** The actions to hold this frame. */
  next(world: TopDownWorld): Action[] {
    this.held = this.decide(world);
    return this.held;
  }

  private decide(world: TopDownWorld): Action[] {
    if (world.transition || world.hero.dying) return [];
    if (world.room.id !== this.room) {
      this.room = world.room.id;
      this.step = 0;
      this.stuck = 0;
      const p = this.plans[this.room] ?? [];
      this.plan = typeof p === 'function' ? p(world) : p;
    }
    for (let guard = 0; guard < 8; guard++) {
      const s = this.plan[this.step];
      if (!s) return [];
      const out = this.run(world, s);
      if (out !== 'done') {
        this.lastDir = (out.find((a) => (DIRS as readonly string[]).includes(a)) as Dir | undefined) ?? null;
        return out;
      }
      this.step++;
      this.stuck = 0;
    }
    return [];
  }

  /** Presses `a` this frame unless it was held last frame (then lets go, so the next is a press). */
  private tap(a: Action): Action[] {
    return this.held.includes(a) ? [] : [a];
  }

  /** Taps SELECT until `id` is in the item slot; null once it is. */
  private selectItem(world: TopDownWorld, id: string): Action[] | null {
    if (world.inv.current?.id === id) return null;
    return this.tap('select');
  }

  private run(world: TopDownWorld, s: BotStep): Action[] | 'done' {
    const hero = world.hero;
    switch (s.do) {
      case 'fight': {
        const foes = world.enemies();
        if (foes.length === 0) return 'done';
        return this.fight(world);
      }
      case 'goto':
        if (hero.x === s.x && hero.y === s.y) return 'done';
        return this.walkTo(world, (n) => n.x === s.x && n.y === s.y) ?? 'done';
      case 'pickup': {
        const item = world.entities.find((e): e is Pickup => e instanceof Pickup && !e.hidden && !e.dead);
        if (!item) return 'done';
        const box = item.hurtbox();
        return (
          this.walkTo(world, (n) => boxesOverlap({ x: n.x + 2, y: n.y + 2, w: 12, h: 12 }, box)) ?? 'done'
        );
      }
      case 'push': {
        if (s.until(world)) return 'done';
        const block = world.entities.find((e) => e instanceof PushBlock) as PushBlock | undefined;
        if (block?.moving) return [];
        if (hero.x !== s.from.x || hero.y !== s.from.y) {
          if (this.atPushSpot(world, s)) return [s.dir];
          return this.walkTo(world, (n) => n.x === s.from.x && n.y === s.from.y) ?? [s.dir];
        }
        return [s.dir];
      }
      case 'chest': {
        const c = world.entities.find((e): e is Chest => e instanceof Chest && !e.open);
        if (!c || hero.holdT > 0) return 'done';
        // Spots on the grid next to it, and the way to walk from each into it (the hero's
        // feet are his lower half, so from below he stands half a tile into its row).
        const spots: { x: number; y: number; d: Dir }[] = [
          { x: c.x, y: c.y + ALIGN, d: 'up' },
          { x: c.x - TILE, y: c.y, d: 'right' },
          { x: c.x + TILE, y: c.y, d: 'left' },
          { x: c.x, y: c.y - TILE, d: 'down' },
        ];
        // On a spot, or between it and the chest: walk in.
        const here = spots.find((p) => onApproach(hero, p, p.d));
        if (here) return [here.d];
        return this.walkTo(world, (n) => spots.some((p) => p.x === n.x && p.y === n.y)) ?? 'done';
      }
      case 'bomb': {
        if (s.until(world)) return 'done';
        if (world.entities.some((e) => (e instanceof Bomb || e instanceof Explosion) && !e.dead)) {
          if (hero.x === s.hide.x && hero.y === s.hide.y) return [];
          return this.walkTo(world, (n) => n.x === s.hide.x && n.y === s.hide.y) ?? [];
        }
        if (world.inv.count('bomb') <= 0) return 'done';
        if (!onApproach(hero, s.from, s.dir))
          return this.walkTo(world, (n) => n.x === s.from.x && n.y === s.from.y) ?? 'done';
        if (hero.facing !== s.dir) return [s.dir];
        return this.selectItem(world, 'bomb') ?? this.tap('special');
      }
      case 'leave': {
        const at = inside(s.side, world.room.wall);
        const lined = s.side === 'n' || s.side === 's' ? hero.x === at.x : hero.y === at.y;
        const past = DIR_VEC[at.dir];
        const beyond = past.dx !== 0 ? (hero.x - at.x) * past.dx >= 0 : (hero.y - at.y) * past.dy >= 0;
        if (lined && beyond) return [at.dir];
        return this.walkTo(world, (n) => n.x === at.x && n.y === at.y) ?? [at.dir];
      }
    }
  }

  /** Already leaning into the block from the planned side (it moved; follow it). */
  private atPushSpot(world: TopDownWorld, s: Extract<BotStep, { do: 'push' }>): boolean {
    const hero = world.hero;
    const v = DIR_VEC[s.dir];
    return v.dx !== 0
      ? hero.y === s.from.y && (hero.x - s.from.x) * v.dx > 0
      : hero.x === s.from.x && (hero.y - s.from.y) * v.dy > 0;
  }

  private fight(world: TopDownWorld): Action[] {
    const hero = world.hero;
    if (hero.attacking) return [];
    const foes = world.enemies();
    // Step out of the way of a shot.
    const danger = (x: number, y: number) => this.inLine(world, x, y);
    if (danger(hero.x, hero.y)) {
      const out = this.walkTo(
        world,
        (n) => !danger(n.x, n.y),
        foes.map((f) => grow(f.hurtbox(), 2)),
      );
      if (out) return out;
    }
    // Stab if the blade would reach something from here, turning first if needed.
    for (const d of DIRS) {
      const blade = swordReach(hero.x, hero.y, d);
      if (!foes.some((f) => boxesOverlap(blade, f.hurtbox()))) continue;
      if (hero.facing !== d) return [d];
      if (this.attackHeld) {
        this.attackHeld = false;
        return [];
      }
      this.attackHeld = true;
      return ['attack'];
    }
    this.attackHeld = false;
    const throwAt = this.boomerangShot(world);
    if (throwAt) return throwAt;
    const path = this.walkTo(
      world,
      // Big foes (a boss) only from below, out of their path.
      (n) =>
        DIRS.some((d) =>
          foes.some((f) => (f.w < 32 || d === 'up') && boxesOverlap(swordReach(n.x, n.y, d), f.hurtbox())),
        ),
      foes.map((f) => grow(f.hurtbox(), this.margin)),
    );
    return path ?? [];
  }

  /**
   * With the boomerang owned and ready: a monster (not a big one, not already stunned) two to
   * five tiles off straight along a direction gets it thrown at it (turning and picking it first).
   */
  private boomerangShot(world: TopDownWorld): Action[] | null {
    if (!world.inv.has('boomerang')) return null;
    const hero = world.hero;
    for (const d of DIRS) {
      const v = DIR_VEC[d];
      const lane = {
        x: v.dx > 0 ? hero.x + 2 * TILE : v.dx < 0 ? hero.x - BOOMERANG_RANGE : hero.x + 2,
        y: v.dy > 0 ? hero.y + 2 * TILE : v.dy < 0 ? hero.y - BOOMERANG_RANGE : hero.y + 2,
        w: v.dx !== 0 ? BOOMERANG_RANGE - 2 * TILE : 12,
        h: v.dy !== 0 ? BOOMERANG_RANGE - 2 * TILE : 12,
      };
      const target = world
        .enemies()
        .find((f) => f.w < 32 && f.stunT === 0 && boxesOverlap(lane, f.hurtbox()));
      if (!target) continue;
      if (world.inv.current?.id !== 'boomerang') return this.selectItem(world, 'boomerang');
      if (!world.itemUsable()) return null;
      if (hero.facing !== d) return [d];
      return this.tap('special');
    }
    return null;
  }

  /** Would a hostile shot hit a hero standing at (x, y) within the next half second? */
  private inLine(world: TopDownWorld, x: number, y: number): boolean {
    const hb = { x: x + 1, y: y + 1, w: 14, h: 14 };
    return world.entities.some((e) => {
      if (!(e instanceof Projectile) || !e.hostile || e.dead) return false;
      for (let t = 0; t <= 30; t += 2) {
        const b = e.hurtbox();
        if (boxesOverlap({ x: b.x + e.vx * t, y: b.y + e.vy * t, w: b.w, h: b.h }, hb)) return true;
      }
      return false;
    });
  }

  /**
   * One step along the shortest half-tile-grid path to a node passing `goal`, avoiding boxes in
   * `avoid` (the hero's hurtbox must not touch them). Null when there is no path.
   */
  private walkTo(world: TopDownWorld, goal: (n: Node) => boolean, avoid: Box[] = []): Action[] | null {
    const hero = world.hero;
    const offX = mod(hero.x, ALIGN) !== 0;
    const offY = mod(hero.y, ALIGN) !== 0;
    if (offX && offY) return ['left']; // knocked off the grid: walking snaps one axis back first
    if (offX || offY) {
      // Between two grid points: head for whichever of them is nearer the goal.
      const lo = offX
        ? { x: hero.x - mod(hero.x, ALIGN), y: hero.y }
        : { x: hero.x, y: hero.y - mod(hero.y, ALIGN) };
      const hi = offX ? { x: lo.x + ALIGN, y: lo.y } : { x: lo.x, y: lo.y + ALIGN };
      // (A grid point inside something solid, e.g. a chest just opened beside it, is no way on.)
      const free = (n: Node) => !world.blocked(hero.feet(n.x, n.y), 'hero', null);
      const a = free(lo) ? this.search(world, lo, goal, avoid) : null;
      const b = free(hi) ? this.search(world, hi, goal, avoid) : null;
      const toLo: Dir = offX ? 'left' : 'up';
      const toHi: Dir = offX ? 'right' : 'down';
      if (!a && !b) return [this.lastDir === toHi ? toHi : toLo];
      return [!b || (a && a.dist <= b.dist) ? toLo : toHi];
    }
    const found = this.search(world, { x: hero.x, y: hero.y }, goal, avoid);
    if (found?.first) {
      this.stuck = 0;
      return [found.first];
    }
    if (!found && ++this.stuck > 600) this.step++;
    return null;
  }

  /** Breadth-first search on the half-tile grid: distance to the goal and the first move (null if none). */
  private search(
    world: TopDownWorld,
    start: Node,
    goal: (n: Node) => boolean,
    avoid: Box[],
  ): { dist: number; first: Dir | null } | null {
    const hero = world.hero;
    const key = (n: Node) => `${n.x},${n.y}`;
    const free = (n: Node) =>
      n.x >= 0 &&
      n.y >= 0 &&
      n.x <= ROOM_W - TILE &&
      n.y <= ROOM_H - TILE &&
      !world.blocked(hero.feet(n.x, n.y), 'hero', null) &&
      !avoid.some((b) => boxesOverlap({ x: n.x + 2, y: n.y + 2, w: 12, h: 12 }, b));
    if (goal(start)) return { dist: 0, first: null };
    const prev = new Map<string, { from: Node; dir: Dir; dist: number } | null>([[key(start), null]]);
    const queue: Node[] = [start];
    while (queue.length) {
      const n = queue.shift() as Node;
      const nd = prev.get(key(n))?.dist ?? 0;
      for (const d of DIRS) {
        const v = DIR_VEC[d];
        const m = { x: n.x + v.dx * ALIGN, y: n.y + v.dy * ALIGN };
        if (prev.has(key(m)) || !free(m)) continue;
        prev.set(key(m), { from: n, dir: d, dist: nd + 1 });
        if (goal(m)) {
          let cur = m;
          let first: Dir = d;
          for (;;) {
            const p = prev.get(key(cur));
            if (!p) break;
            first = p.dir;
            cur = p.from;
          }
          return { dist: nd + 1, first };
        }
        queue.push(m);
      }
    }
    return null;
  }
}

/** At `p`, or up to half a tile past it going `d` (walking on into something from there). */
function onApproach(hero: { x: number; y: number }, p: { x: number; y: number }, d: Dir): boolean {
  const v = DIR_VEC[d];
  const along = v.dx !== 0 ? (hero.x - p.x) * v.dx : (hero.y - p.y) * v.dy;
  const lined = v.dx !== 0 ? hero.y === p.y : hero.x === p.x;
  return lined && along >= 0 && along < ALIGN;
}

function grow(b: Box, n: number): Box {
  return { x: b.x - n, y: b.y - n, w: b.w + 2 * n, h: b.h + 2 * n };
}

/** How a cautious first-time player differs from the perfect bot (see CautiousBot). */
export interface CautiousOptions {
  /** Seeds the player's own slips (not the world's dice). */
  seed: number;
  /** Frames between something happening on screen and the player reacting to it. */
  reaction: number;
  /** Chance per frame of a short pause (looking around, thinking). */
  hesitate: number;
  /** Chance per frame, with a monster close, of swinging early instead of lining up. */
  sloppy: number;
  /** Pixels kept from monsters while lining up (the perfect bot keeps 6). */
  margin: number;
  /** Misjudged monster positions: up to this many pixels off on each axis, changing now and then. */
  aim: number;
}

export const CAUTIOUS_DEFAULTS: Omit<CautiousOptions, 'seed'> = {
  reaction: 15,
  hesitate: 0.01,
  sloppy: 0.04,
  margin: 2,
  aim: 4,
};

/**
 * A "cautious human" for tuning difficulty: the same plan as TopDownBot, but it sees monsters and
 * shots where they were `reaction` frames ago (a shot fired more recently than that isn't seen
 * yet), misjudges where monsters are by a few pixels, keeps less distance, pauses now and then,
 * and sometimes swings before it has lined up. It knows where it is
 * itself. Its pass rate over many seeds is a rough stand-in for a first-time player's.
 */
export class CautiousBot {
  private readonly bot: TopDownBot;
  private readonly rng: Rng;
  private readonly opts: CautiousOptions;
  private readonly seen = new Map<TdEntity, { x: number; y: number }[]>();
  private readonly misjudged = new Map<TdEntity, { dx: number; dy: number }>();
  private pause = 0;
  private room = '';
  private t = 0;

  constructor(plans: Readonly<Record<string, BotPlan>>, opts: Partial<CautiousOptions> = {}) {
    this.opts = { seed: 1, ...CAUTIOUS_DEFAULTS, ...opts };
    this.bot = new TopDownBot(plans, this.opts.margin);
    this.rng = new Rng(Math.imul(this.opts.seed, 0x9e3779b1) >>> 0 || 1);
  }

  next(world: TopDownWorld): Action[] {
    if (world.room.id !== this.room) {
      this.room = world.room.id;
      this.seen.clear();
      this.misjudged.clear();
    }
    if (++this.t % 24 === 0) this.misjudged.clear();
    // Remember where every monster and shot is now; forget the ones that are gone.
    const watched = world.entities.filter((e) => !e.dead && (e.enemy || e instanceof Projectile));
    for (const k of [...this.seen.keys()]) if (!watched.includes(k)) this.seen.delete(k);
    for (const e of watched) {
      const h = this.seen.get(e) ?? [];
      h.push({ x: e.x, y: e.y });
      if (h.length > this.opts.reaction + 1) h.shift();
      this.seen.set(e, h);
    }
    if (this.pause > 0) {
      this.pause--;
      return [];
    }
    if (!world.transition && this.rng.chance(this.opts.hesitate)) {
      this.pause = 4 + this.rng.int(12);
      return [];
    }
    // Decide on the old picture: monsters where they were, shots not seen yet left out.
    const real = new Map<TdEntity, { x: number; y: number; dead: boolean }>();
    for (const e of watched) {
      const h = this.seen.get(e) ?? [];
      real.set(e, { x: e.x, y: e.y, dead: e.dead });
      const old = h.length > this.opts.reaction ? h[0] : null;
      if (old) {
        e.x = old.x;
        e.y = old.y;
      } else if (!e.enemy) e.dead = true;
      if (e.enemy) {
        const a = this.opts.aim;
        let off = this.misjudged.get(e);
        if (!off) {
          off = { dx: this.rng.int(2 * a + 1) - a, dy: this.rng.int(2 * a + 1) - a };
          this.misjudged.set(e, off);
        }
        e.x += off.dx;
        e.y += off.dy;
      }
    }
    let out: Action[];
    try {
      out = this.bot.next(world);
    } finally {
      for (const [e, s] of real) {
        e.x = s.x;
        e.y = s.y;
        e.dead = s.dead;
      }
    }
    const hero = world.hero;
    if (!out.includes('attack') && !hero.attacking && this.rng.chance(this.opts.sloppy)) {
      const near = world
        .enemies()
        .some((f) => Math.abs(f.x - hero.x) < 2 * TILE && Math.abs(f.y - hero.y) < 2 * TILE);
      if (near) return ['attack'];
    }
    return out;
  }
}
