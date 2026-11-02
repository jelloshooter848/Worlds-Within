import { boxesOverlap, type Box, type Dir } from './geometry';
import { TdEntity } from './entity';
import { dirFrom } from './walker';
import type { TopDownWorld } from './world';

/** How far in front of the hero's feet he can talk to someone (px). */
export const TALK_REACH = 10;
/** Frames each of a townsperson's two idle frames shows. */
export const IDLE_FRAMES = 32;

export interface PersonOptions {
  /** Who it is (the game's key for their lines). */
  id: string;
  /** The name their cards are headed with ('GUARD'). */
  name: string;
  /**
   * The frames' base name on the sheet: `<base>-0` and `<base>-1` facing down (idle), `<base>-side`
   * facing right (mirrored for left), `<base>-up` facing up if drawn (else the front). Null: no
   * picture at all (a sign, a well: the tiles draw it).
   */
  frames: string | null;
  /** The sheet their frames are on, when not the skin's default for townsfolk. */
  sheet?: string;
  palette?: string;
  /** What the prompt says ('TALK'; 'READ' for a sign, 'LOOK' for a well). */
  verb?: string;
  /** Default: solid when it has a picture (a sign stands on a solid tile instead). */
  solid?: boolean;
  /** Talked to across the counter in front of them (a barkeep): reachable from a tile further down. */
  across?: boolean;
}

/**
 * Someone in a top-down room to talk to (0.4.41: Kakariko Village's townsfolk), or something to
 * read: stands on a tile, breathes through two idle frames, turns to face the hero while talking
 * and back again after (`faceToward`, `rest`). Solid to the hero by its feet (the lower part of
 * the cell), so he can stand close and their heads overlap as in A Link to the Past. The hero
 * talks to whoever `talkTarget` finds in front of him; what is said is the game's.
 */
export class TdPerson extends TdEntity {
  readonly id: string;
  readonly name: string;
  readonly verb: string;
  readonly frames: string | null;
  readonly sheet: string | undefined;
  readonly palette: string | undefined;
  facing: Dir = 'down';
  /** Drawn sorted with the hero by its feet (who is in front). */
  readonly ySort = true;
  /** Idle animation counter. */
  t = 0;
  /** Not drawn (still talkable). */
  hidden = false;
  readonly across: boolean;

  constructor(x: number, y: number, opts: PersonOptions) {
    super(x, y);
    this.id = opts.id;
    this.name = opts.name;
    this.verb = opts.verb ?? 'TALK';
    this.frames = opts.frames;
    this.sheet = opts.sheet;
    this.palette = opts.palette;
    this.solid = opts.solid ?? opts.frames !== null;
    this.across = opts.across ?? false;
  }

  /** The feet: what the hero bumps into. */
  override body(): Box {
    return { x: this.x + 2, y: this.y + 6, w: 12, h: 10 };
  }

  /**
   * What the hero's reach must touch to talk: the feet, or the whole cell for a sign; a tile more
   * below for someone behind a counter.
   */
  talkBox(): Box {
    if (this.across) return { x: this.x, y: this.y, w: 16, h: 32 };
    return this.solid ? this.body() : { x: this.x, y: this.y, w: 16, h: 16 };
  }

  /** Turns toward `box` (the hero's feet), for a talk. */
  faceToward(box: Box): void {
    if (this.frames === null) return;
    this.facing = dirFrom(this.body(), box);
  }

  /** Back to facing down after a talk. */
  rest(): void {
    this.facing = 'down';
  }

  update(_world: TopDownWorld): void {
    this.t++;
  }
}

/** The box in front of the hero's feet he can reach to talk (TALK_REACH px deep). */
export function reachBox(world: TopDownWorld): Box {
  const f = world.hero.feet();
  const n = TALK_REACH;
  switch (world.hero.facing) {
    case 'up':
      return { x: f.x, y: f.y - n, w: f.w, h: n };
    case 'down':
      return { x: f.x, y: f.y + f.h, w: f.w, h: n };
    case 'left':
      return { x: f.x - n, y: f.y, w: n, h: f.h };
    case 'right':
      return { x: f.x + f.w, y: f.y, w: n, h: f.h };
  }
}

/** The townsperson (or sign) right in front of the hero, the nearest first; null if nobody. */
export function talkTarget(world: TopDownWorld): TdPerson | null {
  const reach = reachBox(world);
  const f = world.hero.feet();
  let best: TdPerson | null = null;
  let bestD = Infinity;
  for (const e of world.entities) {
    if (!(e instanceof TdPerson) || e.dead) continue;
    const b = e.talkBox();
    if (!boxesOverlap(reach, b)) continue;
    const d = Math.abs(b.x + b.w / 2 - (f.x + f.w / 2)) + Math.abs(b.y + b.h / 2 - (f.y + f.h / 2));
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}
