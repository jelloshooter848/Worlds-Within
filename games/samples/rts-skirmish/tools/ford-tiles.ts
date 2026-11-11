import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { encodePng } from '@engine/core/content/png';

/**
 * Makes The River Ford's small sheet (Engine 0.16 part D, D7):
 * `assets/kenney-medieval-rts/ford-tiles.png`, cut and scaled from the pack's own sheet
 * (`medieval-rts-sheet.png`, Kenney's Medieval RTS, CC0; `assets/CREDITS.md`). The pack draws its
 * ground as 64 px tiles and the map's cells are 16 px, so the ground is the pack's tiles at a
 * quarter size; roads and river banks are laid in the pack's path and grass colours for every set
 * of open sides (a skin's `join`); rocks, trees and gold are the pack's props at half size; the
 * building sites are the pack's crates and plank floors cut out of their grass; the placing ghost
 * is the pack's barracks at half alpha. Run it with
 *
 *     pnpm exec tsx games/samples/rts-skirmish/tools/ford-tiles.ts
 *
 * The same input gives the same bytes (`encodePng` writes stored deflate blocks), and
 * `assets.test.ts` checks the committed file against this script and the skin's `ford` frames
 * against `FORD_FRAMES`.
 */

/** The pack's sheet and the sheet made from it, relative to the game folder. */
export const PACK_SHEET = 'assets/kenney-medieval-rts/medieval-rts-sheet.png';
export const FORD_SHEET = 'assets/kenney-medieval-rts/ford-tiles.png';

/** An RGBA picture. */
interface Picture {
  w: number;
  h: number;
  px: Uint8Array;
}

/** A frame of the made sheet: its rectangle and, for a prop, its anchor (`bottom`). */
export interface FordFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  anchor?: 'bottom';
}

/** The open sides of a cell, in `join` key order. */
const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** Every set of open sides as a `join` key ('' for none), in a fixed order. */
export const SIDE_KEYS: readonly string[] = Array.from({ length: 16 }, (_, n) =>
  SIDES.filter((_, i) => (n >> i) & 1).join(' '),
);

/** The inner corners of a cell, in `join` key order (`TILE_JOIN_WORDS`). */
const CORNERS = ['inner-top-left', 'inner-top-right', 'inner-bottom-right', 'inner-bottom-left'] as const;

/** Every non-empty set of open inner corners as a `join` key (a plaza cell with its sides joined). */
export const CORNER_KEYS: readonly string[] = Array.from({ length: 15 }, (_, n) =>
  CORNERS.filter((_, i) => ((n + 1) >> i) & 1).join(' '),
);

/** A frame name's form of a key: `road-top-left`, `road` for none. */
export const keyFrame = (prefix: string, key: string) =>
  key === '' ? prefix : `${prefix}-${key.replace(/ /g, '-')}`;

// Where the pieces are in the pack's sheet (its atlas, `medieval-rts-sheet-atlas.txt`).
const TILE = {
  grass: [128, 414], // medievalTile_58 (the plain grass, x y of its 64 x 64)
  grassAlt: [128, 478], // medievalTile_57
  water: [192, 256], // medievalTile_27
  crate: [192, 192], // medievalTile_53 (a small crate on grass)
  planks: [192, 128], // medievalTile_54 (fresh boards on it)
  floor: [192, 64], // medievalTile_55 (a large plank floor)
  floorNew: [192, 0], // medievalTile_56 (fresh boards)
} as const;
const PROP = {
  pine: [516, 514, 19, 33], // medievalEnvironment_03
  cypress: [534, 275, 14, 32], // medievalEnvironment_01
  rock: [479, 354, 32, 28], // medievalEnvironment_08
  boulder: [479, 422, 32, 28], // medievalEnvironment_15
  gold: [472, 35, 38, 35], // medievalEnvironment_12 (grey rock with gold)
  goldEmpty: [475, 140, 38, 32], // medievalEnvironment_09 (the same rock, bare)
  barracks: [431, 226, 44, 36], // medievalStructure_23
} as const;

// The pack's colours for the laid pieces (read off its path and river tiles).
const PATH = [217, 162, 77];
const PATH_EDGE = [171, 120, 58];
const BANK = [22, 110, 60];
const FOAM = [240, 252, 252];

/** The made sheet's frames, by name (the skin's `images.ford.frames`). */
export const FORD_FRAMES: Readonly<Record<string, FordFrame>> = (() => {
  const out: Record<string, FordFrame> = {};
  const cell = (name: string, col: number, row: number) =>
    (out[name] = { x: col * 16, y: row * 16, w: 16, h: 16 });
  ['grass-0', 'grass-1', 'rock-0', 'rock-1', 'trees-0', 'trees-1'].forEach((n, i) => cell(n, i, 0));
  SIDE_KEYS.forEach((k, i) => cell(keyFrame('road', k), i, 1));
  SIDE_KEYS.forEach((k, i) => cell(keyFrame('water', k), i, 2));
  CORNER_KEYS.forEach((k, i) => cell(keyFrame('road', k), i, 3));
  out['site-2x2'] = { x: 0, y: 64, w: 32, h: 32 };
  out['site-2x2-half'] = { x: 32, y: 64, w: 32, h: 32 };
  out['site-3x3'] = { x: 64, y: 64, w: 48, h: 48 };
  out['site-3x3-half'] = { x: 112, y: 64, w: 48, h: 48 };
  out['gold'] = { x: 160, y: 64, w: 19, h: 18, anchor: 'bottom' };
  out['gold-empty'] = { x: 180, y: 64, w: 19, h: 16, anchor: 'bottom' };
  out['ghost-barracks'] = { x: 200, y: 64, w: 44, h: 36, anchor: 'bottom' };
  return out;
})();

/** The made sheet's size. */
export const FORD_SIZE = { w: 256, h: 112 };

/** Reads an 8-bit RGBA, non-interlaced PNG (the pack's sheet), every filter. */
export function readRgbaPng(bytes: Uint8Array): Picture {
  const png = Buffer.from(bytes);
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  if (png[24] !== 8 || png[25] !== 6 || png[28] !== 0) throw new Error('readRgbaPng: not 8-bit RGBA');
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]!;
      const a = i >= 4 ? px[y * stride + i - 4]! : 0;
      const b = y > 0 ? px[(y - 1) * stride + i]! : 0;
      const c = i >= 4 && y > 0 ? px[(y - 1) * stride + i - 4]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const add = [0, a, b, (a + b) >> 1, paeth][filter];
      if (add === undefined) throw new Error(`readRgbaPng: filter ${filter}`);
      px[y * stride + i] = (x + add) & 0xff;
    }
  }
  return { w, h, px };
}

const blank = (w: number, h: number): Picture => ({ w, h, px: new Uint8Array(w * h * 4) });

function crop(p: Picture, x: number, y: number, w: number, h: number): Picture {
  const out = blank(w, h);
  for (let j = 0; j < h; j++)
    out.px.set(p.px.subarray(((y + j) * p.w + x) * 4, ((y + j) * p.w + x + w) * 4), j * w * 4);
  return out;
}

/**
 * `p` made `n` times smaller: each block's colour the alpha-weighted mean; its alpha the mean,
 * then (with `crisp`) clear below half and full above, so a prop keeps a hard edge.
 */
function shrink(p: Picture, n: number, crisp: boolean): Picture {
  const out = blank(Math.floor(p.w / n), Math.floor(p.h / n));
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const sum = [0, 0, 0, 0];
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const at = ((y * n + j) * p.w + x * n + i) * 4;
          const a = p.px[at + 3]!;
          for (let c = 0; c < 3; c++) sum[c]! += p.px[at + c]! * a;
          sum[3]! += a;
        }
      }
      const at = (y * out.w + x) * 4;
      const alpha = sum[3]! / (n * n);
      if (sum[3]! > 0) for (let c = 0; c < 3; c++) out.px[at + c] = Math.round(sum[c]! / sum[3]!);
      out.px[at + 3] = crisp ? (alpha >= 128 ? 255 : 0) : Math.round(alpha);
    }
  }
  return out;
}

/** Draws `src` onto `dst` at (x, y), over what is there (alpha blended). */
function paste(dst: Picture, src: Picture, x: number, y: number, alpha = 1): void {
  for (let j = 0; j < src.h; j++) {
    for (let i = 0; i < src.w; i++) {
      const dx = x + i;
      const dy = y + j;
      if (dx < 0 || dy < 0 || dx >= dst.w || dy >= dst.h) continue;
      const s = (j * src.w + i) * 4;
      const d = (dy * dst.w + dx) * 4;
      const a = (src.px[s + 3]! / 255) * alpha;
      if (a === 0) continue;
      const da = dst.px[d + 3]! / 255;
      const oa = a + da * (1 - a);
      for (let c = 0; c < 3; c++)
        dst.px[d + c] = Math.round((src.px[s + c]! * a + dst.px[d + c]! * da * (1 - a)) / oa);
      dst.px[d + 3] = Math.round(oa * 255);
    }
  }
}

function fill(p: Picture, x: number, y: number, w: number, h: number, rgb: readonly number[]): void {
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) p.px.set([rgb[0]!, rgb[1]!, rgb[2]!, 255], (j * p.w + i) * 4);
}

/** The pack's grass made clear: a crate or floor cut out of its tile. */
function withoutGrass(p: Picture): Picture {
  const out = crop(p, 0, 0, p.w, p.h);
  for (let i = 0; i < out.px.length; i += 4) {
    const [r, g, b] = [out.px[i]!, out.px[i + 1]!, out.px[i + 2]!];
    if (g > r + 40 && g > b + 20) out.px[i + 3] = 0;
  }
  return out;
}

const open = (key: string, side: (typeof SIDES)[number]) => key.split(' ').includes(side);

/**
 * A road cell: the path filling the cell but a grass margin on each open side, edged in the path's
 * dark tan; an open inner corner (a plaza's edge) is a grass notch, edged the same way.
 */
function road(grass: Picture, key: string): Picture {
  const out = crop(grass, 0, 0, 16, 16);
  const m = 4;
  const x0 = open(key, 'left') ? m : 0;
  const y0 = open(key, 'top') ? m : 0;
  const x1 = open(key, 'right') ? 16 - m : 16;
  const y1 = open(key, 'bottom') ? 16 - m : 16;
  fill(out, x0, y0, x1 - x0, y1 - y0, PATH_EDGE);
  fill(
    out,
    x0 + (x0 > 0 ? 1 : 0),
    y0 + (y0 > 0 ? 1 : 0),
    x1 - x0 - (x0 > 0 ? 1 : 0) - (x1 < 16 ? 1 : 0),
    y1 - y0 - (y0 > 0 ? 1 : 0) - (y1 < 16 ? 1 : 0),
    PATH,
  );
  const notch = (x: number, y: number, ex: number, ey: number) => {
    fill(out, Math.min(x, ex), Math.min(y, ey), m + 1, m + 1, PATH_EDGE);
    for (let j = 0; j < m; j++)
      for (let i = 0; i < m; i++) {
        const at = ((y + j) * 16 + x + i) * 4;
        out.px.set(grass.px.subarray(at, at + 4), at);
      }
  };
  const words = key.split(' ');
  if (words.includes('inner-top-left')) notch(0, 0, 0, 0);
  if (words.includes('inner-top-right')) notch(16 - m, 0, 16 - m - 1, 0);
  if (words.includes('inner-bottom-right')) notch(16 - m, 16 - m, 16 - m - 1, 16 - m - 1);
  if (words.includes('inner-bottom-left')) notch(0, 16 - m, 0, 16 - m - 1);
  return out;
}

/** A river cell: the pack's water with a bank (grass, then foam) on each side open to land. */
function water(base: Picture, key: string): Picture {
  const out = crop(base, 0, 0, 16, 16);
  for (const [side, colour, at] of [
    ...SIDES.map((s) => [s, FOAM, 1] as const),
    ...SIDES.map((s) => [s, BANK, 0] as const),
  ]) {
    if (!open(key, side)) continue;
    if (side === 'top') fill(out, 0, at, 16, 1, colour);
    if (side === 'bottom') fill(out, 0, 15 - at, 16, 1, colour);
    if (side === 'left') fill(out, at, 0, 1, 16, colour);
    if (side === 'right') fill(out, 15 - at, 0, 1, 16, colour);
  }
  return out;
}

/** The made sheet's PNG bytes from the pack's sheet's. */
export function fordTiles(packSheet: Uint8Array): Uint8Array {
  const pack = readRgbaPng(packSheet);
  const tile = ([x, y]: readonly [number, number]) => shrink(crop(pack, x, y, 64, 64), 4, false);
  const prop = ([x, y, w, h]: readonly [number, number, number, number]) =>
    shrink(crop(pack, x, y, w, h), 2, true);
  const sheet = blank(FORD_SIZE.w, FORD_SIZE.h);
  const at = (name: string, p: Picture, dx = 0, dy = 0) =>
    paste(sheet, p, FORD_FRAMES[name]!.x + dx, FORD_FRAMES[name]!.y + dy);
  const grass = tile(TILE.grass);
  at('grass-0', grass);
  at('grass-1', tile(TILE.grassAlt));
  at('rock-0', grass);
  at('rock-0', prop(PROP.rock), 0, 2);
  at('rock-1', tile(TILE.grassAlt));
  at('rock-1', prop(PROP.boulder), 0, 2);
  at('trees-0', grass);
  at('trees-0', prop(PROP.pine), -1, 0);
  at('trees-0', prop(PROP.pine), 7, 0);
  at('trees-1', tile(TILE.grassAlt));
  at('trees-1', prop(PROP.cypress), 1, 0);
  at('trees-1', prop(PROP.pine), 7, 0);
  const river = tile(TILE.water);
  for (const k of SIDE_KEYS) {
    at(keyFrame('road', k), road(grass, k));
    at(keyFrame('water', k), water(river, k));
  }
  for (const k of CORNER_KEYS) at(keyFrame('road', k), road(grass, k));
  const cut = ([x, y]: readonly [number, number], inset: number, size: number) =>
    withoutGrass(crop(pack, x + inset, y + inset, size, size));
  at('site-2x2', cut(TILE.crate, 16, 32));
  at('site-2x2-half', cut(TILE.planks, 16, 32));
  at('site-3x3', cut(TILE.floor, 8, 48));
  at('site-3x3-half', cut(TILE.floorNew, 8, 48));
  at('gold', prop(PROP.gold));
  at('gold-empty', prop(PROP.goldEmpty));
  const [bx, by, bw, bh] = PROP.barracks;
  paste(
    sheet,
    crop(pack, bx, by, bw, bh),
    FORD_FRAMES['ghost-barracks']!.x,
    FORD_FRAMES['ghost-barracks']!.y,
    0.5,
  );
  return encodePng(sheet.w, sheet.h, sheet.px);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
  writeFileSync(file(FORD_SHEET), fordTiles(readFileSync(file(PACK_SHEET))));
  console.log(`wrote ${file(FORD_SHEET)}`);
}
