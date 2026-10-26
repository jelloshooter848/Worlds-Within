import type { InputFrame } from '@engine/input/input-manager';
import { DIRS, type Box, type Dir } from './geometry';
import { TdHero } from './hero';
import type { TopDownWorld } from './world';

/** The walker's pace: pixels on each frame of a repeating pattern (1.5 px a frame, the kit's). */
export const WALK_STEPS: readonly number[] = [1, 2];
/** With ATTACK or RUN held (ALttP's boots, cheap and handy): 2 px a frame. */
export const RUN_STEPS: readonly number[] = [2];
/** How far a walker slides sideways round a corner he walks straight into (doorways, gaps). */
export const CORNER_SLIDE = 7;

/**
 * A hero who walks eight ways (no Zelda grid), as in A Link to the Past and Blaster Master's
 * overhead mode: each axis held moves on its own and is checked on its own, so walking into a
 * wall at an angle slides along it; walking straight into a wall with an opening just beside (a
 * doorway, a gap in a hedge) nudges him toward it, up to CORNER_SLIDE px. He faces the way last
 * pressed. Jason on foot (Sophia's mini game) walks this way (Kakariko's heroes walk the keep's four-way walk since 0.4.43).
 * No sword: a game adds what its hero does with the other buttons.
 */
export class TdWalker extends TdHero {
  /** Max slide round a corner, px. */
  cornerSlide = CORNER_SLIDE;
  /** Where the walk is in its step pattern. */
  protected stepT = 0;

  constructor(x: number, y: number, maxHp = 6) {
    super(x, y, maxHp);
    this.facing = 'up';
  }

  /** A 10-px stance: it fits a doorway (16 px) with room to spare. */
  override feet(x = this.x, y = this.y): Box {
    return { x: x + 3, y: y + 8, w: 10, h: 8 };
  }

  override hurtbox(): Box {
    return { x: this.x + 3, y: this.y + 2, w: 10, h: 13 };
  }

  /** No sword. */
  override swordBox(): Box | null {
    return null;
  }

  /** Faces the way just pressed, else keeps one still held. */
  face(input: InputFrame): void {
    for (const d of DIRS) if (input.pressed(d) && input.held(d)) this.facing = d;
    if (!input.held(this.facing)) {
      const d = DIRS.find((k) => input.held(k));
      if (d) this.facing = d;
    }
  }

  /** The way held on each axis (-1, 0 or 1). */
  static axes(input: InputFrame): { dx: number; dy: number } {
    return {
      dx: (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0),
      dy: (input.held('down') ? 1 : 0) - (input.held('up') ? 1 : 0),
    };
  }

  /**
   * One frame of walking with the pad (`steps`: the pace pattern). True when a direction is held.
   */
  walk(world: TopDownWorld, input: InputFrame, steps: readonly number[] = WALK_STEPS): boolean {
    const { dx, dy } = TdWalker.axes(input);
    if (dx === 0 && dy === 0) return false;
    const step = steps[this.stepT++ % steps.length] ?? 1;
    this.walkT++;
    if (dx !== 0 && !this.moveBy(world, dx * step, 0, false) && dy === 0) this.slide(world, dx, 0);
    if (dy !== 0 && !this.moveBy(world, 0, dy * step, false) && dx === 0) this.slide(world, 0, dy);
    return true;
  }

  override update(world: TopDownWorld, input: InputFrame): void {
    if (this.dead) return;
    if (this.dying) {
      super.update(world, input);
      return;
    }
    if (this.invuln > 0) this.invuln--;
    this.face(input);
    const run = input.held('attack') || input.held('run');
    this.walk(world, input, run ? RUN_STEPS : WALK_STEPS);
  }

  /**
   * Walking straight into a wall with an opening just beside (a doorway, a gap between blocks):
   * a pixel toward the opening, as long as it is within `cornerSlide` px.
   */
  protected slide(world: TopDownWorld, dx: number, dy: number): void {
    for (let k = 1; k <= this.cornerSlide; k++)
      for (const s of [-1, 1]) {
        const ox = dx === 0 ? s * k : 0;
        const oy = dy === 0 ? s * k : 0;
        const at = this.feet(this.x + ox + dx, this.y + oy + dy);
        if (world.blocked(at, 'hero', null)) continue;
        if (world.blocked(this.feet(this.x + ox, this.y + oy), 'hero', null)) continue;
        this.moveBy(world, Math.sign(ox), Math.sign(oy), false);
        return;
      }
  }
}

/** The direction from a walker's feet toward `to`'s middle (for townsfolk turning to talk). */
export function dirFrom(from: Box, to: Box): Dir {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}
