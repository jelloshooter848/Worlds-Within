import type { Renderer } from '@engine/gfx/renderer';
import { DIR_VEC, boxesOverlap, type Box, type Dir } from './geometry';
import { TdEnemy, TdEntity } from './entity';
import { drawFrame, type TdView } from './view';
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
/** Frames each colour of the beam's flicker lasts (steady with reduce flashing). */
const FLICKER = 2;
/** The beam's tints (link-td palettes), cycled while it flies. */
export const BEAM_PALETTES = [
  'link-td-beam-0',
  'link-td-beam-1',
  'link-td-beam-2',
  'link-td-beam-3',
] as const;
export const BEAM_PALETTE_CALM = 'link-td-beam-calm';

/** The tint of the beam (and its burst) this frame: flickering, or one steady tint. */
function beamPalette(view: TdView): string {
  if (view.reduceFlashing) return BEAM_PALETTE_CALM;
  return BEAM_PALETTES[Math.floor(view.frame / FLICKER) % BEAM_PALETTES.length] as string;
}

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

  render(r: Renderer, view: TdView, ox: number, oy: number): void {
    const sheet = view.sheet(view.sheets.hero, beamPalette(view)) ?? view.sheet(view.sheets.hero);
    const v = this.dir === 'up' || this.dir === 'down';
    drawFrame(
      r,
      sheet,
      v ? 'sword-v' : 'sword-h',
      ox + this.x,
      oy + this.y,
      '#fcfcfc',
      { w: this.w, h: this.h },
      this.dir === 'left',
      this.dir === 'down',
    );
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

  render(r: Renderer, view: TdView, ox: number, oy: number): void {
    const sheet = view.sheet(view.sheets.hero, beamPalette(view)) ?? view.sheet(view.sheets.hero);
    for (const p of this.pieces()) {
      // The shard art points up-left; each piece is flipped to point the way it flies.
      const x = Math.round(ox + this.cx + p.dx - 4);
      const y = Math.round(oy + this.cy + p.dy - 4);
      drawFrame(r, sheet, 'beam-shard', x, y, '#fcfcfc', { w: 4, h: 4 }, p.dx > 0, p.dy > 0);
    }
  }
}
