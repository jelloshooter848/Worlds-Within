import type { SpriteDef } from '@engine/gfx/pixelart';

/**
 * Turns a frame a quarter turn counter-clockwise: its top edge becomes its left edge. A wall or
 * door drawn for the north edge (outside at the top) becomes the west one (outside at the left).
 */
export function rotateCcw(rows: readonly string[]): string[] {
  const h = rows.length;
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const out: string[] = [];
  for (let y = 0; y < w; y++) {
    let line = '';
    for (let x = 0; x < h; x++) line += rows[x]?.[w - 1 - y] ?? '.';
    out.push(line);
  }
  return out;
}

/** North-edge frames the top-down renderer also needs for the west edge (east is that, mirrored). */
export const SIDE_FRAMES = [
  'wall',
  'wall-top',
  'door-open',
  'door-locked',
  'door-shut',
  'wall-cracked',
  'wall-hole',
] as const;

/**
 * Zelda's 32×32 doors through a two-tile wall: only a sheet for two-tile-walled rooms draws them
 * (their `-side` frames are derived when it does).
 */
export const THICK_SIDE_FRAMES = [
  'door-open-thick',
  'door-locked-thick',
  'door-shut-thick',
  'wall-cracked-thick',
  'wall-hole-thick',
] as const;

/**
 * 16-px doorway frames that a two-cell (north or south) doorway draws centred across its cells:
 * `<frame>-l` is wall-top's left half then the frame's left half, `<frame>-r` the frame's right
 * half then wall-top's right half.
 */
export const SPLIT_FRAMES = [
  'door-open',
  'door-locked',
  'door-shut',
  'wall-cracked',
  'wall-hole',
  'exit-0',
  'exit-1',
] as const;

/**
 * The tile sheet with the frames the top-down renderer derives: a `<frame>-side` for each of
 * SIDE_FRAMES and THICK_SIDE_FRAMES the sheet draws (rotated from the north frame) and the `-l` / `-r` halves of SPLIT_FRAMES, unless
 * the sheet already draws its own.
 */
export function withSideFrames(def: SpriteDef): SpriteDef {
  const frames: Record<string, readonly string[]> = { ...def.frames };
  for (const name of [...SIDE_FRAMES, ...THICK_SIDE_FRAMES]) {
    const north = def.frames[name];
    if (north && !frames[`${name}-side`]) frames[`${name}-side`] = rotateCcw(north);
  }
  const wall = def.frames['wall-top'];
  for (const name of SPLIT_FRAMES) {
    const f = def.frames[name];
    if (!f || !wall) continue;
    const half = (f[0]?.length ?? 16) >> 1;
    frames[`${name}-l`] ??= f.map((row, y) => (wall[y] ?? '').slice(0, half) + row.slice(0, half));
    frames[`${name}-r`] ??= f.map((row, y) => row.slice(half) + (wall[y] ?? '').slice(half));
  }
  return { ...def, frames };
}
