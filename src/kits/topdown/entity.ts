import type { Renderer } from '@engine/gfx/renderer';
import { DIR_VEC, TILE, boxesOverlap, mod, type Box, type Dir } from './geometry';
import { drawFrame, type TdView } from './view';
import type { Mover, TopDownWorld } from './world';

/**
 * Anything in a room besides the hero: enemies, projectiles, pickups, push blocks, switches,
 * torches, effects. Positions are room pixels (top-left of a 16×16 cell unless `w`/`h` say
 * otherwise). Entities live only while their room is on screen; the room's state (world.ts)
 * remembers what must persist.
 */
export abstract class TdEntity {
  w = 16;
  h = 16;
  dead = false;
  /** Draw order: 0 floor things, 1 actors, 2 projectiles, 3 effects (the hero draws between 1 and 2). */
  layer = 1;
  /** Counts toward the room's 'clear' condition while alive. */
  enemy = false;
  /** Walkers, blocks and shots can't pass it (push blocks, torches). */
  solid = false;
  /** Where this came from in the room text ("col,row"), when it was placed there. */
  key: string | null = null;

  constructor(
    public x: number,
    public y: number,
  ) {}

  /** The box tiles and solid things collide with. */
  body(): Box {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  /** The box that touches (and is touched by) the hero and the sword. */
  hurtbox(): Box {
    return { x: this.x + 2, y: this.y + 2, w: this.w - 4, h: this.h - 4 };
  }

  abstract update(world: TopDownWorld): void;
  abstract render(r: Renderer, view: TdView, ox: number, oy: number): void;

  /** The sword touched it; return true if that counted as a hit (for the hit sound). */
  onSword(_world: TopDownWorld, _dir: Dir): boolean {
    return false;
  }
}

/** Frames an enemy can't be hurt again after a sword hit (one stab is one hit). */
export const ENEMY_INVULN = 16;
/** Knockback from the sword: this many frames at KNOCK_SPEED px, stopping at walls. */
export const ENEMY_KNOCK_FRAMES = 4;
export const KNOCK_SPEED = 4;

/**
 * An enemy: hit points, contact damage (in half hearts), knockback and a short invulnerability
 * after each hit, a poof and a chance to drop a heart when it dies.
 */
export abstract class TdEnemy extends TdEntity {
  override enemy = true;
  /** Names the enemy in events ('bat', 'knight', ...). */
  abstract readonly kind: string;
  abstract hp: number;
  /** Damage on touch, in half hearts. */
  contact = 1;
  facing: Dir = 'down';
  invuln = 0;
  kbDir: Dir | null = null;
  kbT = 0;
  /** Chance of a heart pickup on death. */
  dropChance = 0.3;
  /** How it moves through tiles. */
  mover: Mover = 'walk';
  /** Sword knockback (bosses stand firm). */
  knockable = true;
  /** Frames left stunned (a boomerang): it stands still and does nothing else. */
  stunT = 0;

  update(world: TopDownWorld): void {
    if (this.invuln > 0) this.invuln--;
    if (this.kbT > 0 && this.kbDir) {
      this.kbT--;
      const v = DIR_VEC[this.kbDir];
      world.moveEntity(this, v.dx * KNOCK_SPEED, v.dy * KNOCK_SPEED, this.mover);
      return;
    }
    if (this.stunT > 0) {
      this.stunT--;
      return;
    }
    this.think(world);
  }

  /** How long a stun of `frames` holds this monster (a boss may shorten it; 0 = immune). */
  stunFor(frames: number): number {
    return frames;
  }

  /** Stuns it for `frames` (as this monster takes it). True if it is stunned now. */
  stun(world: TopDownWorld, frames: number): boolean {
    const n = this.stunFor(frames);
    if (n <= 0 || this.dead) return false;
    this.stunT = Math.max(this.stunT, n);
    world.emit({ type: 'stun', kind: this.kind });
    return true;
  }

  /** Behaviour once knockback is over. */
  protected abstract think(world: TopDownWorld): void;

  override onSword(world: TopDownWorld, dir: Dir): boolean {
    if (this.hurt(world, 1, dir)) return true;
    // Still blinking from the last hit: the blade pushes it back all the same.
    if (this.knockable && !this.dead && this.kbT === 0) {
      this.kbDir = dir;
      this.kbT = ENEMY_KNOCK_FRAMES;
    }
    return false;
  }

  hurt(world: TopDownWorld, damage: number, dir: Dir): boolean {
    if (this.invuln > 0 || this.dead) return false;
    this.hp -= damage;
    this.invuln = ENEMY_INVULN;
    if (this.knockable) {
      this.kbDir = dir;
      this.kbT = ENEMY_KNOCK_FRAMES;
    }
    if (this.hp <= 0) this.die(world);
    else world.emit({ type: 'hit', kind: this.kind });
    return true;
  }

  die(world: TopDownWorld): void {
    this.dead = true;
    world.emit({ type: 'kill', kind: this.kind });
    world.add(new Poof(this.x + this.w / 2 - 8, this.y + this.h / 2 - 8));
    const kind = world.lootFor(this.dropChance);
    if (kind) {
      // Drops sit on the 8-px grid so they are easy to walk onto.
      // Over a statue, block or water they go to the nearest tile the hero can walk onto.
      const size = pickupSize(kind);
      const x = Math.round((this.x + this.w / 2 - size.w / 2) / 8) * 8;
      const y = Math.round((this.y + this.h / 2 - size.h / 2) / 8) * 8;
      const at = world.openSpotNear({ x, y, ...size });
      world.add(new Pickup(at.x, at.y, kind));
    }
  }

  /** On the 16-px tile grid on both axes (where walkers may turn). */
  protected aligned(): boolean {
    return mod(this.x, TILE) === 0 && mod(this.y, TILE) === 0;
  }

  /** Hurt blink: hidden every other 2 frames while invulnerable (never with reduce flashing). */
  protected blinkHidden(view: TdView): boolean {
    return this.invuln > 0 && !view.reduceFlashing && (view.frame & 2) === 0;
  }
}

/** The puff an enemy leaves (three frames). */
export class Poof extends TdEntity {
  override layer = 3;
  t = 0;
  update(): void {
    if (++this.t >= 18) this.dead = true;
  }
  render(r: Renderer, view: TdView, ox: number, oy: number): void {
    const sheet = view.sheet(view.sheets.enemies);
    const f = `poof-${Math.min(2, Math.floor(this.t / 6))}`;
    if (sheet?.frames.has(f)) r.sprite(sheet, f, ox + this.x, oy + this.y);
    else r.rect(ox + this.x + 4, oy + this.y + 4, 8, 8, '#fcfcfc');
  }
}

/**
 * What a pickup or chest can give (world.ts `grant`): `heart` (one heart back), `key`,
 * `heart-container` (one more heart, all of them back), `refill` (all hearts back), `white-sword`
 * (the sword beam),
 * an item's ammo pickup (`bombs`), or an item id (the item itself).
 */
export type PickupKind = string;

/** Small pickups are 8 px wide (a heart is 8×8); the rest fill a tile. */
export function pickupSize(kind: PickupKind): { w: number; h: number } {
  if (kind === 'heart') return { w: 8, h: 8 };
  if (kind === 'key' || kind === 'bombs' || kind === 'map') return { w: 8, h: 16 };
  return { w: 16, h: 16 };
}

/** The tile-sheet frame a pickup (or a chest's prize held up) is drawn with. */
export function pickupFrame(kind: PickupKind): string {
  switch (kind) {
    case 'heart':
      return 'heart-pickup';
    case 'key':
      return 'key';
    case 'bombs':
      return 'bomb-pickup';
    case 'heart-container':
    case 'map':
    case 'compass':
    case 'triforce':
      return kind;
    default:
      return `${kind}-icon`;
  }
}

/** Something lying on the floor to pick up (see PickupKind). */
export class Pickup extends TdEntity {
  override layer = 0;
  /** Not there yet: the room's `reveal` condition shows it. */
  hidden = false;
  constructor(
    x: number,
    y: number,
    readonly kind: PickupKind,
  ) {
    super(x, y);
    const size = pickupSize(kind);
    this.w = size.w;
    this.h = size.h;
  }
  override hurtbox(): Box {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }
  update(): void {}
  render(r: Renderer, view: TdView, ox: number, oy: number): void {
    if (this.hidden) return;
    const sheet = view.sheet(view.sheets.tiles, view.tilePalette);
    if (this.kind === 'refill') {
      // A refill: four little hearts in a square.
      for (const [dx, dy] of [
        [0, 0],
        [8, 0],
        [0, 8],
        [8, 8],
      ] as const)
        drawFrame(r, sheet, 'heart', ox + this.x + dx, oy + this.y + dy, '#f83800', { w: 7, h: 7 });
      return;
    }
    const color = this.kind === 'key' ? '#f8b800' : this.kind === 'heart' ? '#f83800' : '#fcfcfc';
    drawFrame(r, sheet, pickupFrame(this.kind), ox + this.x, oy + this.y, color, { w: this.w, h: this.h });
  }
}

/**
 * A chest (solid): walking into it opens it and the hero holds up what was inside (world.ts
 * `grant`). The room remembers it open.
 */
export class Chest extends TdEntity {
  override layer = 0;
  override solid = true;
  constructor(
    x: number,
    y: number,
    readonly contents: string,
    public open = false,
  ) {
    super(x, y);
  }
  override hurtbox(): Box {
    return this.body();
  }
  update(): void {}
  /** Opens it (once): its contents go to the hero. */
  tryOpen(world: TopDownWorld): boolean {
    if (this.open) return false;
    this.open = true;
    if (this.key) world.state().taken.add(this.key);
    world.emit({ type: 'chest', item: this.contents });
    world.grant(this.contents);
    world.hero.holdUp(pickupFrame(this.contents));
    return true;
  }
  render(r: Renderer, view: TdView, ox: number, oy: number): void {
    const sheet = view.sheet(view.sheets.tiles, view.tilePalette);
    drawFrame(r, sheet, this.open ? 'chest-open' : 'chest', ox + this.x, oy + this.y, '#ac7c00');
  }
}

/**
 * A loose block (Zelda style): lean into it for a moment and it slides one tile, if the tile
 * beyond is open floor. It can be pushed again and again, so it can also be pushed into a spot
 * it can't come back from; leaving the room and coming back puts it back (world.ts).
 */
export const PUSH_DELAY = 12;
export class PushBlock extends TdEntity {
  override layer = 0;
  override solid = true;
  /** Settled for good (its plate puzzle is solved). */
  fixed = false;
  private move: { dx: number; dy: number; left: number } | null = null;

  get moving(): boolean {
    return this.move !== null;
  }

  tryPush(world: TopDownWorld, dir: Dir): boolean {
    if (this.fixed || this.move) return false;
    const v = DIR_VEC[dir];
    const target = { x: this.x + v.dx * TILE, y: this.y + v.dy * TILE, w: TILE, h: TILE };
    if (world.blocked(target, 'block', this)) return false;
    if (world.entities.some((e) => e.enemy && !e.dead && boxesOverlap(e.body(), target))) return false;
    this.move = { dx: v.dx, dy: v.dy, left: TILE };
    world.emit({ type: 'push' });
    return true;
  }

  update(): void {
    if (!this.move) return;
    this.x += this.move.dx;
    this.y += this.move.dy;
    if (--this.move.left <= 0) this.move = null;
  }

  render(r: Renderer, view: TdView, ox: number, oy: number): void {
    const sheet = view.sheet(view.sheets.tiles, view.tilePalette);
    if (sheet?.frames.has('block')) r.sprite(sheet, 'block', ox + this.x, oy + this.y);
    else {
      r.rect(ox + this.x, oy + this.y, 16, 16, '#503000');
      r.rect(ox + this.x + 2, oy + this.y + 2, 12, 12, '#ac7c00');
    }
  }
}

/**
 * A floor switch. `plate`: held down only while a block rests on it (the hero is too light).
 * `latch`: the hero (or a block) steps on it once and it stays down.
 */
export class FloorSwitch extends TdEntity {
  override layer = 0;
  pressed = false;
  constructor(
    x: number,
    y: number,
    readonly kind: 'plate' | 'latch',
  ) {
    super(x, y);
  }
  update(world: TopDownWorld): void {
    const cell = { x: this.x + 4, y: this.y + 4, w: 8, h: 8 };
    const block = world.entities.some(
      (e) => e instanceof PushBlock && !e.moving && e.x === this.x && e.y === this.y,
    );
    if (this.kind === 'plate') {
      this.pressed = block;
      return;
    }
    if (this.pressed) return;
    const hero = world.hero;
    if (block || (!hero.dying && boxesOverlap(hero.feet(), cell))) {
      this.pressed = true;
      world.emit({ type: 'switch' });
    }
  }
  render(r: Renderer, view: TdView, ox: number, oy: number): void {
    const sheet = view.sheet(view.sheets.tiles, view.tilePalette);
    const f = this.pressed ? 'switch-down' : 'switch-up';
    if (sheet?.frames.has(f)) r.sprite(sheet, f, ox + this.x, oy + this.y);
    else r.rect(ox + this.x + 3, oy + this.y + 3, 10, 10, this.pressed ? '#404040' : '#bcbcbc');
  }
}

/** A brazier: solid; lit ones flicker (steady with reduce flashing). The sword lights an unlit one. */
export class Torch extends TdEntity {
  override layer = 0;
  override solid = true;
  constructor(
    x: number,
    y: number,
    public lit: boolean,
  ) {
    super(x, y);
  }
  override hurtbox(): Box {
    return this.body();
  }
  update(): void {}
  override onSword(world: TopDownWorld): boolean {
    if (this.lit) return false;
    this.lit = true;
    world.emit({ type: 'torch' });
    return true;
  }
  render(r: Renderer, view: TdView, ox: number, oy: number): void {
    const sheet = view.sheet(view.sheets.tiles, view.tilePalette);
    const f = !this.lit ? 'torch-off' : view.reduceFlashing ? 'torch-0' : `torch-${(view.frame >> 3) & 1}`;
    if (sheet?.frames.has(f)) r.sprite(sheet, f, ox + this.x, oy + this.y);
    else {
      r.rect(ox + this.x + 4, oy + this.y + 8, 8, 8, '#7c7c7c');
      if (this.lit) r.rect(ox + this.x + 5, oy + this.y + 2, 6, 6, '#f8b800');
    }
  }
}
