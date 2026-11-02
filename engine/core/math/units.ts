/**
 * Integer units, NES style.
 *
 * - Positions are stored in subpixels: 1 px = 256 sub (SUB).
 * - Velocities and accelerations are stored in 1/4096 px per frame (VEL), so the
 *   SMB1 hex constants (speed in 1/16 px/f, force in 1/4096 px/f²) drop in unchanged.
 * - Each frame a body moves by `velToSub(v)` subpixels, i.e. v >> 4.
 *
 * Everything is a 32-bit integer so simulations are deterministic and replayable.
 */
export const SUB_SHIFT = 8;
export const SUB = 1 << SUB_SHIFT; // 256 subpixels per pixel
export const VEL_SHIFT = 12;
export const VEL = 1 << VEL_SHIFT; // 4096 velocity units per px/frame
export const TILE = 16;
export const TILE_SHIFT = 4;
export const TILE_SUB = TILE * SUB; // 4096 subpixels per tile
export const TILE_SUB_SHIFT = SUB_SHIFT + TILE_SHIFT; // 12

/** Pixels (integer) to subpixels. */
export const px = (n: number): number => n * SUB;
/** Subpixels to whole pixels, floored (arithmetic shift matches the NES). */
export const toPx = (s: number): number => s >> SUB_SHIFT;
/** Velocity units (1/4096 px/f) to subpixels moved this frame (1/256 px), floored. */
export const velToSub = (v: number): number => v >> (VEL_SHIFT - SUB_SHIFT);
/** px/frame as a float to velocity units. */
export const vel = (pxPerFrame: number): number => Math.round(pxPerFrame * VEL);
/** Velocity units to px/frame (float, for display). */
export const velToPxf = (v: number): number => v / VEL;
/** Tile column/row for a subpixel coordinate. */
export const tileAt = (s: number): number => s >> TILE_SUB_SHIFT;
/** Subpixel coordinate of the left/top edge of a tile. */
export const tileToSub = (t: number): number => t << TILE_SUB_SHIFT;

export const sign = (n: number): -1 | 0 | 1 => (n > 0 ? 1 : n < 0 ? -1 : 0);
export const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);
export const absMin = (n: number, cap: number): number => (Math.abs(n) > cap ? sign(n) * cap : n);
