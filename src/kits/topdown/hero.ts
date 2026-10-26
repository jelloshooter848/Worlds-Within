import type { Renderer } from '@engine/gfx/renderer';
import type { InputFrame } from '@engine/input/input-manager';
import { DIRS, DIR_VEC, TILE, isHorizontal, mod, type Box, type Dir } from './geometry';
import { Chest, PUSH_DELAY, PushBlock } from './entity';
import { SwordBeam } from './beam';
import { drawFrame, type TdView } from './view';
import type { TopDownWorld } from './world';

/** Frames of one sword stab (the hero stands still for all of them). */
export const ATTACK_FRAMES = 14;
/** The blade is out (and hits) from this frame of the stab to SWORD_LAST, inclusive. */
export const SWORD_FIRST = 1;
export const SWORD_LAST = 12;
/** How far the stab's reach spills past the tile in front, to each side (angled approaches). */
export const SWORD_SPREAD = 4;
/** Frames the hero stands in the throw pose after using an item. */
export const USE_FRAMES = 10;
/** Frames the hero holds a chest's prize over his head (the room waits). */
export const HOLD_FRAMES = 64;
/** After a hit: this long invulnerable, and knocked back KNOCK_FRAMES frames at KNOCK_PX. */
export const HERO_INVULN = 60;
export const KNOCK_FRAMES = 8;
export const KNOCK_PX = 4;
/** The death spin, then the poof; `dead` after both. */
export const SPIN_FRAMES = 72;
export const DEATH_FRAMES = SPIN_FRAMES + 24;
/** Movement snaps the cross axis to this grid (Zelda's half tile), so doorways line up. */
export const ALIGN = 8;

/** The blade's box for a hero at (x, y) facing `d` (where the art draws it): a short stab in front. */
export function swordAt(x: number, y: number, d: Dir): Box {
  switch (d) {
    case 'up':
      return { x, y: y - 12, w: 8, h: 16 };
    case 'down':
      return { x: x + 8, y: y + 12, w: 8, h: 16 };
    case 'left':
      return { x: x - 12, y: y + 8, w: 16, h: 8 };
    case 'right':
      return { x: x + 12, y: y + 8, w: 16, h: 8 };
  }
}

/**
 * Where a stab hits for a hero at (x, y) facing `d`: the whole tile in front, SWORD_SPREAD px
 * past it on each side, and 6 px back into the hero's own tile, so a monster coming in at an
 * angle meets the blade before it reaches him.
 */
export function swordReach(x: number, y: number, d: Dir): Box {
  const s = SWORD_SPREAD;
  switch (d) {
    case 'up':
      return { x: x - s, y: y - TILE, w: TILE + 2 * s, h: TILE + 6 };
    case 'down':
      return { x: x - s, y: y + TILE - 6, w: TILE + 2 * s, h: TILE + 6 };
    case 'left':
      return { x: x - TILE, y: y - s, w: TILE + 6, h: TILE + 2 * s };
    case 'right':
      return { x: x + TILE - 6, y: y - s, w: TILE + 6, h: TILE + 2 * s };
  }
}

const SPIN: readonly Dir[] = ['down', 'left', 'up', 'right'];

/**
 * The top-down hero (Link in the Shadow Keep): four-way walking at 1.5 px/frame on a half-tile
 * grid, a sword stab in the facing direction (one at a time; at full hearts, in a world with
 * beams, it also throws a sword beam), the item in the slot on SPECIAL
 * (SELECT moves the slot), hearts in halves, knockback with invulnerability after a hit, and a
 * death spin. Walking into a chest opens it; he holds the prize up for a moment.
 */
export class TdHero {
  x: number;
  y: number;
  facing: Dir = 'up';
  /** Hit points in half hearts. */
  hp: number;
  maxHp: number;
  /** Frames left in the current stab (0 = not attacking). */
  attackT = 0;
  /** Frames left in the throw pose after using an item. */
  useT = 0;
  /** Frames left holding a prize up, and its tile-sheet frame. */
  holdT = 0;
  holding: string | null = null;
  invuln = 0;
  kbT = 0;
  kbDir: Dir = 'down';
  /** Frames since the death started (0 = alive). */
  dying = 0;
  dead = false;
  /** Walking animation counter (advances only while moving). */
  walkT = 0;
  /** Frames leaning into the same push block. */
  pushT = 0;
  private pushing: PushBlock | null = null;
  private parity = 0;
  /** The direction pressed most recently, which wins when two are held. */
  private lastDir: Dir | null = null;
  private wasHeld = new Set<Dir>();

  constructor(x: number, y: number, maxHp = 6) {
    this.x = x;
    this.y = y;
    this.maxHp = maxHp;
    this.hp = maxHp;
  }

  get attacking(): boolean {
    return this.attackT > 0;
  }

  /** The box that collides with tiles: the lower half, a little narrower than the sprite. */
  feet(x = this.x, y = this.y): Box {
    return { x: x + 1, y: y + 8, w: 14, h: 8 };
  }

  /** The box enemies and shots hurt. */
  hurtbox(): Box {
    return { x: this.x + 2, y: this.y + 2, w: 12, h: 12 };
  }

  /** What the stab hits while the blade is out (swordReach), else null. */
  swordBox(): Box | null {
    if (!this.attacking) return null;
    const e = ATTACK_FRAMES - this.attackT;
    if (e < SWORD_FIRST || e > SWORD_LAST) return null;
    return swordReach(this.x, this.y, this.facing);
  }

  /**
   * Does a stab now also throw a sword beam (beam.ts)? In a world with beams, with every heart
   * full and no beam of his already flying, as in Zelda.
   */
  beamReady(world: TopDownWorld): boolean {
    return (
      world.swordBeam &&
      this.hp >= this.maxHp &&
      !world.entities.some((e) => e instanceof SwordBeam && !e.dead)
    );
  }

  /** Holds a chest's prize up (its frame) for HOLD_FRAMES; the room waits meanwhile. */
  holdUp(frame: string): void {
    this.holdT = HOLD_FRAMES;
    this.holding = frame;
    this.attackT = 0;
    this.useT = 0;
    this.facing = 'down';
  }

  /** Where the blade is drawn (and hits), by facing. */
  private swordSprite(): Box & { frame: string; fx: boolean; fy: boolean } {
    const b = swordAt(this.x, this.y, this.facing);
    const v = this.facing === 'up' || this.facing === 'down';
    return { ...b, frame: v ? 'sword-v' : 'sword-h', fx: this.facing === 'left', fy: this.facing === 'down' };
  }

  /**
   * Takes `damage` half hearts, knocked back toward `push`. False when invulnerable or already
   * down. With the world's no-damage assist on he is still knocked back but keeps his hearts.
   */
  hurt(world: TopDownWorld, damage: number, push: Dir): boolean {
    if (this.invuln > 0 || this.dying || this.holdT > 0) return false;
    if (!world.noDamage()) this.hp = Math.max(0, this.hp - damage);
    this.attackT = 0;
    this.useT = 0;
    this.pushT = 0;
    if (this.hp === 0) {
      this.dying = 1;
      world.emit({ type: 'dying' });
      return true;
    }
    this.invuln = HERO_INVULN;
    this.kbT = KNOCK_FRAMES;
    this.kbDir = push;
    world.emit({ type: 'hurt', hp: this.hp });
    return true;
  }

  /**
   * One frame of walking himself toward (x, y) in `dir` (after coming through a doorway), at his
   * walking pace. False once he is there or something stops him.
   */
  walkInStep(world: TopDownWorld, dir: Dir, x: number, y: number): boolean {
    if (this.invuln > 0) this.invuln--;
    this.facing = dir;
    const left = Math.abs(x - this.x) + Math.abs(y - this.y);
    if (left === 0) return false;
    this.parity ^= 1;
    this.walkT++;
    const step = Math.min(left, this.parity ? 1 : 2);
    const v = DIR_VEC[dir];
    return this.moveBy(world, v.dx * step, v.dy * step, false) && left > step;
  }

  heal(halves: number): void {
    this.hp = Math.min(this.maxHp, this.hp + halves);
  }

  /** The held direction that counts: the latest one pressed among those held. */
  protected wantDir(input: InputFrame): Dir | null {
    const held = DIRS.filter((d) => input.held(d));
    for (const d of held) if (!this.wasHeld.has(d)) this.lastDir = d;
    this.wasHeld = new Set(held);
    if (this.lastDir && held.includes(this.lastDir)) return this.lastDir;
    return held[0] ?? null;
  }

  update(world: TopDownWorld, input: InputFrame): void {
    if (this.dead) return;
    if (this.dying) {
      if (this.dying < DEATH_FRAMES) this.dying++;
      if (this.dying < SPIN_FRAMES) this.facing = SPIN[(this.dying >> 2) & 3] as Dir;
      if (this.dying >= DEATH_FRAMES && !this.dead) {
        this.dead = true;
        world.emit({ type: 'dead' });
      }
      return;
    }
    if (this.invuln > 0) this.invuln--;
    const want = this.wantDir(input);
    if (this.kbT > 0) {
      this.kbT--;
      const v = DIR_VEC[this.kbDir];
      // Knocked about the floor only, never back out through a doorway (as in Zelda): on the
      // floor he stays on it; still in a doorway, only a step toward the floor is taken.
      for (let i = 0; i < KNOCK_PX; i++) {
        const now = world.offFloor(this.feet());
        const next = world.offFloor(this.feet(this.x + v.dx, this.y + v.dy));
        if (next > 0 && next >= now) break;
        if (!this.moveBy(world, v.dx, v.dy, false)) break;
      }
      return;
    }
    if (this.holdT > 0) {
      if (--this.holdT === 0) this.holding = null;
      return;
    }
    if (this.attackT > 0) {
      this.attackT--;
      return;
    }
    if (this.useT > 0) {
      this.useT--;
      return;
    }
    if (input.pressed('select')) world.cycleItem();
    if (input.pressed('attack')) {
      this.attackT = ATTACK_FRAMES;
      this.pushT = 0;
      world.emit({ type: 'sword' });
      if (this.beamReady(world)) {
        const b = swordAt(this.x, this.y, this.facing);
        world.add(new SwordBeam(b.x, b.y, this.facing));
        world.emit({ type: 'beam' });
      }
      return;
    }
    if (input.pressed('special') && world.useItem()) {
      this.useT = USE_FRAMES;
      this.pushT = 0;
      return;
    }
    if (!want) {
      this.pushT = 0;
      return;
    }
    this.walk4(world, want);
  }

  /**
   * One frame of the keep's four-way walk in `want` (0.4.43: Kakariko's heroes walk this way too):
   * 1.5 px a frame on Zelda's half-tile grid, nudged onto the grid line with the way ahead open,
   * and round a corner by up to half a tile into a doorway or a gap.
   */
  protected walk4(world: TopDownWorld, want: Dir): void {
    this.facing = want;
    this.parity ^= 1;
    const step = this.parity ? 1 : 2; // 1.5 px/frame on average
    this.walkT++;
    const v = DIR_VEC[want];
    // Zelda's half-tile grid: first slide onto the grid across the way you are going, to the
    // grid line with the way ahead open if only one of the two has it; and round a corner by up
    // to half a tile when the way ahead is shut but open just beside (doorways, gaps).
    const h = isHorizontal(want);
    const pos = h ? this.y : this.x;
    const cross = mod(pos, ALIGN);
    const at = (c: number) => (h ? { x: this.x, y: c } : { x: c, y: this.y });
    const open = (c: number) => {
      const p = at(c);
      return (
        !world.blocked(this.feet(p.x, p.y), 'hero', null) &&
        !world.blocked(this.feet(p.x + v.dx, p.y + v.dy), 'hero', null)
      );
    };
    // Leaning on a push block half a tile off: slide onto its row or column so the push takes.
    const block = world.solidEntityAt(this.feet(this.x + v.dx, this.y + v.dy));
    const line = block instanceof PushBlock ? (h ? block.y : block.x) : null;
    const square = line !== null && (pos === line || (h && pos === line - ALIGN));
    let target = pos;
    if (line !== null && !square && Math.abs(line - pos) <= ALIGN) target = line;
    else if (cross !== 0) {
      const near = cross < ALIGN / 2 ? pos - cross : pos - cross + ALIGN;
      const far = near < pos ? near + ALIGN : near - ALIGN;
      target = !open(near) && open(far) ? far : near;
    } else if (!open(pos) && line === null && !(block instanceof Chest))
      // (Walking into a chest opens it, so no rounding it.)
      target = [pos - ALIGN, pos + ALIGN].find(open) ?? pos;
    if (target !== pos) {
      const n = Math.min(step, Math.abs(target - pos)) * Math.sign(target - pos);
      if (h ? this.moveBy(world, 0, n, false) : this.moveBy(world, n, 0, false)) return;
    }
    this.moveBy(world, v.dx * step, v.dy * step, true);
  }

  /**
   * Moves pixel by pixel up to (dx, dy) (one axis), stopping at anything solid. When `lean` is
   * set, bumping a push block leans on it and bumping a locked door tries a key. Returns true
   * when it moved the whole way.
   */
  moveBy(world: TopDownWorld, dx: number, dy: number, lean: boolean): boolean {
    const n = Math.abs(dx) + Math.abs(dy);
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    for (let i = 0; i < n; i++) {
      const box = this.feet(this.x + sx, this.y + sy);
      if (world.blocked(box, 'hero', null)) {
        if (lean) this.lean(world, box);
        return false;
      }
      this.x += sx;
      this.y += sy;
    }
    if (lean) this.pushT = 0;
    return true;
  }

  /** Bumped into something while walking: lean on a push block, open a chest, or unlock a locked door. */
  private lean(world: TopDownWorld, box: Box): void {
    world.tryUnlock(box);
    const block = world.solidEntityAt(box);
    if (block instanceof Chest) {
      block.tryOpen(world);
      return;
    }
    if (!(block instanceof PushBlock)) {
      this.pushT = 0;
      this.pushing = null;
      return;
    }
    // Lean squarely: across the push, most of the hero's width must be on the block.
    const f = this.feet();
    const overlap = isHorizontal(this.facing)
      ? Math.min(f.y + f.h, block.y + 16) - Math.max(f.y, block.y)
      : Math.min(f.x + f.w, block.x + 16) - Math.max(f.x, block.x);
    if (overlap < (isHorizontal(this.facing) ? 6 : 10)) {
      this.pushT = 0;
      return;
    }
    if (block !== this.pushing) this.pushT = 0;
    this.pushing = block;
    if (++this.pushT >= PUSH_DELAY) {
      block.tryPush(world, this.facing);
      this.pushT = 0;
    }
  }

  render(r: Renderer, view: TdView, ox: number, oy: number): void {
    const x = ox + this.x;
    const y = oy + this.y;
    if (this.dying >= SPIN_FRAMES) {
      if (this.dead) return;
      const enemies = view.sheet(view.sheets.enemies);
      const f = `poof-${Math.min(2, Math.floor((this.dying - SPIN_FRAMES) / 8))}`;
      if (enemies?.frames.has(f)) r.sprite(enemies, f, x, y);
      else r.rect(x + 4, y + 4, 8, 8, '#fcfcfc');
      return;
    }
    let palette: string | undefined;
    if (this.invuln > 0 || this.dying) {
      palette = view.reduceFlashing
        ? `${view.sheets.hero}-hurt-calm`
        : `${view.sheets.hero}-hurt-${(view.frame >> 2) & 1}`;
    }
    let sheet = palette ? view.sheet(view.sheets.hero, palette) : null;
    if (palette && !sheet) {
      // No hurt palettes: blink instead (steady with reduce flashing).
      if (!view.reduceFlashing && (view.frame & 2) === 0) return;
    }
    sheet ??= view.sheet(view.sheets.hero);
    const side = isHorizontal(this.facing);
    const dirName = side ? 'side' : this.facing;
    const sword = this.attacking ? this.swordSprite() : null;
    const pose = this.attacking
      ? `attack-${dirName}`
      : this.useT > 0
        ? `throw-${dirName}`
        : this.holdT > 0
          ? sheet?.frames.has('hold')
            ? 'hold'
            : 'down-0'
          : `${dirName}-${(this.walkT >> 3) & 1}`;
    const frame = pose;
    if (this.holding) {
      const tiles = view.sheet(view.sheets.tiles, view.tilePalette);
      const w = tiles?.frames.get(this.holding)?.w ?? 8;
      drawFrame(r, tiles, this.holding, x + 8 - (w >> 1), y - 16, '#fcfcfc', { w, h: 16 });
    }
    if (sword) {
      if (sheet?.frames.has(sword.frame))
        r.sprite(sheet, sword.frame, ox + sword.x, oy + sword.y, sword.fx, sword.fy);
      else
        r.rect(
          ox + sword.x + (sword.w > 8 ? 0 : 3),
          oy + sword.y + (sword.w > 8 ? 3 : 0),
          sword.w > 8 ? 16 : 2,
          sword.w > 8 ? 2 : 16,
          '#fcfcfc',
        );
    }
    if (sheet?.frames.has(frame)) r.sprite(sheet, frame, x, y, this.facing === 'left');
    else {
      r.rect(x + 2, y + 1, 12, 14, palette ? '#fcfcfc' : '#00a800');
      const v = DIR_VEC[this.facing];
      r.rect(x + 6 + v.dx * 5, y + 6 + v.dy * 5, 4, 4, '#fca044');
    }
  }
}
