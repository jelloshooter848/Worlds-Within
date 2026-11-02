import { px, tileAt, tileToSub } from '@engine/core/math/units';
import type { TileGrid } from './tiles';

/**
 * A physics body: a box in sub-pixels (`x`, `y` its top-left corner, `w`, `h` its size) and a
 * velocity in 1/4096 px per tick. Whole numbers only; a tick moves it `velToSub(v)` sub-pixels.
 *
 * Collision is tile by tile, one axis at a time (x first, then y), as in SMBC: after the move the
 * leading edge's tiles are tested and the body is put back against the first solid one. A move is
 * never longer than a tile, so no tile is skipped.
 */
export interface Body {
  x: number;
  y: number;
  readonly w: number;
  readonly h: number;
  vx: number;
  vy: number;
  onGround: boolean;
  /** -1 or 1 when the last x move hit a wall on that side, else 0. */
  hitWall: -1 | 0 | 1;
  /** The tile the head hit on the last y move, or null. */
  bumped: { col: number; row: number } | null;
}

/** A body of `wPx` x `hPx` pixels with its top-left corner at x/y (sub-pixels), at rest. */
export function makeBody(x: number, y: number, wPx: number, hPx: number): Body {
  return { x, y, w: px(wPx), h: px(hPx), vx: 0, vy: 0, onGround: false, hitWall: 0, bumped: null };
}

/** Moves the body `dx` sub-pixels sideways, stopping it against a solid tile. */
export function moveX(b: Body, tiles: TileGrid, dx: number): void {
  b.hitWall = 0;
  if (dx === 0) return;
  b.x += dx;
  const top = tileAt(b.y);
  const bottom = tileAt(b.y + b.h - 1);
  const col = dx > 0 ? tileAt(b.x + b.w - 1) : tileAt(b.x);
  for (let row = top; row <= bottom; row++) {
    if (!tiles.isSolid(col, row)) continue;
    b.x = dx > 0 ? tileToSub(col) - b.w : tileToSub(col + 1);
    b.vx = 0;
    b.hitWall = dx > 0 ? 1 : -1;
    return;
  }
}

/**
 * Moves the body `dy` sub-pixels up or down. Down, it lands on a solid tile, or on a one-way tile
 * its feet were above before the move. Up, a solid tile over its head puts it back under that tile;
 * `stopRise` (the `ceiling-bump` rule) also ends the rise there, and `bumped` names the tile hit
 * (the one over its centre first).
 */
export function moveY(b: Body, tiles: TileGrid, dy: number, stopRise: boolean): void {
  const prevBottom = b.y + b.h;
  b.onGround = false;
  b.bumped = null;
  if (dy === 0) return;
  b.y += dy;
  const left = tileAt(b.x);
  const right = tileAt(b.x + b.w - 1);
  if (dy > 0) {
    const row = tileAt(b.y + b.h - 1);
    const rowTop = tileToSub(row);
    for (let col = left; col <= right; col++) {
      const c = tiles.collisionAt(col, row);
      if (c === 'solid' || (c === 'one-way' && prevBottom <= rowTop)) {
        b.y = rowTop - b.h;
        b.vy = 0;
        b.onGround = true;
        return;
      }
    }
    return;
  }
  const row = tileAt(b.y);
  const centre = tileAt(b.x + (b.w >> 1));
  const hit = [centre, left, right].find((col) => tiles.isSolid(col, row));
  if (hit === undefined) return;
  b.y = tileToSub(row + 1);
  b.bumped = { col: hit, row };
  if (stopRise) b.vy = 0;
}
