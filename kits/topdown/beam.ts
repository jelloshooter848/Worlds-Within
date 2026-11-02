import { DIR_VEC, boxesOverlap, type Box, type Dir } from './geometry';
import { TdEnemy, TdEntity } from './entity';
import type { TopDownWorld } from './world';

/**
 * Pixels per frame a sword beam flies. [M] Recalled from Zelda 1, where the beam crosses a
 * dungeon room in well under a second: not measured.
 */
export const BEAM_SPEED = 3;
/** Frames the burst's four pieces fly apart before they are gone. */
export const BURST_FRAMES = 18;
/** Pixels per frame each burst piece travels on each axis. */
const BURST_SPEED = 1.5;
/**
 * Zelda's sword beam: with every heart full, a stab also throws the blade's image straight ahead
 * (one on screen at a time). It flies until it meets a monster, which it hurts like the sword
 * (an invulnerable one just stops it), or a wall, a door or the room's edge, where it bursts
 * into four pieces that fly apart diagonally (BeamBurst). Like Zelda's, it flies over blocks,
 * statues, water, torches and push blocks (it moves as a flyer).
 */
export class SwordBeam extends TdEntity {
  override layer = 2;

  constructor(
    x: number,
    y: number,
    readonly dir: Dir,
  ) {
    super(x, y);
    const v = dir === 'up' || dir === 'down';
    this.w = v ? 8 : 16;
    this.h = v ? 16 : 8;
  }

  override hurtbox(): Box {
    return this.body();
  }

  update(world: TopDownWorld): void {
    if (this.hitMonster(world)) return;
    const v = DIR_VEC[this.dir];
    if (!world.moveEntity(this, v.dx * BEAM_SPEED, v.dy * BEAM_SPEED, 'fly')) {
      this.burst(world);
      return;
    }
    this.hitMonster(world);
  }

  /** Touching a living monster: it takes a sword's hit (if it can) and the beam is spent. */
  private hitMonster(world: TopDownWorld): boolean {
    const me = this.body();
    for (const e of world.entities)
      if (e instanceof TdEnemy && !e.dead && boxesOverlap(me, e.hurtbox())) {
        e.hurt(world, 1, this.dir);
        this.burst(world);
        return true;
      }
    return false;
  }

  private burst(world: TopDownWorld): void {
    this.dead = true;
    world.add(new BeamBurst(this.x + this.w / 2, this.y + this.h / 2));
  }
}

/** The four pieces of a spent beam flying apart diagonally from where it burst; harmless. */
export class BeamBurst extends TdEntity {
  override layer = 3;
  t = 0;

  constructor(
    readonly cx: number,
    readonly cy: number,
  ) {
    super(Math.round(cx), Math.round(cy));
    this.w = 0;
    this.h = 0;
  }

  override hurtbox(): Box {
    return { x: this.x, y: this.y, w: 0, h: 0 };
  }

  /** Each piece's offset from the burst's middle (its top-left, an 8×8 shard). */
  pieces(): { dx: number; dy: number }[] {
    const d = 1 + this.t * BURST_SPEED;
    return [
      { dx: -d, dy: -d },
      { dx: d, dy: -d },
      { dx: -d, dy: d },
      { dx: d, dy: d },
    ];
  }

  update(): void {
    if (++this.t >= BURST_FRAMES) this.dead = true;
  }
}
