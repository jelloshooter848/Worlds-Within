/**
 * Shared units of the top-down kit: one room is one screen of 16×11 tiles of 16 px (256×176)
 * under a 64-px HUD, and everything moves in whole pixels in room-local coordinates
 * (0,0 = the room's top-left tile).
 */
export const TILE = 16;
export const ROOM_COLS = 16;
export const ROOM_ROWS = 11;
export const ROOM_W = ROOM_COLS * TILE;
export const ROOM_H = ROOM_ROWS * TILE;
/** The HUD band above the play area; the room is drawn from this y down. */
export const HUD_H = 64;

export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];
/** A room edge. */
export type Side = 'n' | 'e' | 's' | 'w';

export const DIR_VEC: Readonly<Record<Dir, { dx: -1 | 0 | 1; dy: -1 | 0 | 1 }>> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export const OPPOSITE: Readonly<Record<Dir, Dir>> = { up: 'down', down: 'up', left: 'right', right: 'left' };
export const SIDE_DIR: Readonly<Record<Side, Dir>> = { n: 'up', e: 'right', s: 'down', w: 'left' };
export const DIR_SIDE: Readonly<Record<Dir, Side>> = { up: 'n', right: 'e', down: 's', left: 'w' };
export const OPPOSITE_SIDE: Readonly<Record<Side, Side>> = { n: 's', s: 'n', e: 'w', w: 'e' };

export function isHorizontal(d: Dir): boolean {
  return d === 'left' || d === 'right';
}

/** An axis-aligned box in room pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function centre(b: Box): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** The main direction from `from` to `to` (the larger axis wins; ties go vertical). */
export function dirToward(from: Box, to: Box): Dir {
  const a = centre(from);
  const b = centre(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

/** Positive modulo (for alignment checks on negative coordinates during a doorway walk). */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}
