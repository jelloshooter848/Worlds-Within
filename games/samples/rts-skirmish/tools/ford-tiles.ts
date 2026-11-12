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
 * is the pack's barracks at half alpha. The map's decoration (polish Q, Q6; `content/maps/
 * ford.decor.txt`) has its own frames below them: the pack's trees, bushes, stumps, logs and
 * rocks at half size with a soft shadow; pebbles from its small rocks at a quarter; a dirt patch
 * from its dirt tile; its grass tinted darker and lighter as round patches larger than a cell
 * (neighbouring patches overlap into one shape); and, laid in its colours, grass tufts, flowers,
 * mushrooms and bank reeds over a darker strip. Run it with
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

/**
 * A frame of the made sheet: its rectangle and, for a prop, its anchor (`bottom`; a grass patch,
 * larger than its cell, `center`).
 */
export interface FordFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  anchor?: 'bottom' | 'center';
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
  // The decoration's props (polish Q, Q6).
  cypressTall: [515, 256, 19, 46], // medievalEnvironment_02
  pineTall: [511, 314, 26, 48], // medievalEnvironment_04
  stump: [526, 499, 14, 15], // medievalEnvironment_05
  log: [384, 298, 36, 15], // medievalEnvironment_06
  stone: [531, 162, 18, 16], // medievalEnvironment_07
  rocks: [475, 140, 38, 32], // medievalEnvironment_09 (a rock and a small one)
  bush: [511, 410, 20, 23], // medievalEnvironment_13
  stoneBrown: [526, 458, 18, 16], // medievalEnvironment_14
  berries: [511, 233, 20, 23], // medievalEnvironment_20
} as const;
const DIRT_TILE = [320, 0] as const; // medievalTile_13 (bare dirt)

// The pack's colours for the laid pieces (read off its path and river tiles).
const PATH = [217, 162, 77];
const PATH_EDGE = [171, 120, 58];
const BANK = [22, 110, 60];
const FOAM = [240, 252, 252];
// The decoration's laid colours (polish Q, Q6): the pack's leaf greens, trunk brown, berry red,
// gold sparkle and foam white, and the tints its darker and lighter grass patches lay over the
// ground.
const LEAF_DARK = [17, 95, 50];
const LEAF = [27, 145, 77];
const LEAF_LIGHT = [96, 204, 120];
const TRUNK = [187, 128, 68];
const TRUNK_DARK = [130, 84, 44];
const BERRY = [210, 112, 76];
const SPARKLE = [255, 223, 153];
const SHADOW = [0, 0, 0];
const DARK_TINT = { rgb: [8, 70, 34], alpha: 0.16 };
const LIGHT_TINT = { rgb: [214, 236, 140], alpha: 0.22 };
const BANK_TINT = { rgb: [8, 70, 34], alpha: 0.26 };

/**
 * The grass patches' shapes (polish Q, Q6): each a 32 px frame centred on its cell, a union of
 * circles `[cx, cy, r]`, so the patches of neighbouring cells overlap into one rounded shape.
 */
const PATCH_SHAPES: readonly (readonly (readonly [number, number, number])[])[] = [
  [[16, 16, 12]],
  [
    [12, 14, 10],
    [21, 19, 9],
  ],
  [
    [16, 16, 9],
    [9, 19, 7],
    [23, 13, 7],
  ],
];

/** The decoration's 16 px frames on one row (the grass patches take the two rows above it). */
export const DECOR_SMALL = [
  'tuft-0',
  'tuft-1',
  'tuft-2',
  'flowers-0',
  'flowers-1',
  'flowers-2',
  'mushrooms-0',
  'mushrooms-1',
  'pebbles-0',
  'pebbles-1',
  'dirt-0',
  'dirt-1',
  'reeds-0',
  'reeds-1',
  'reeds-2',
] as const;

/**
 * The decoration's props, each `[name, w, h]`, standing on their cell's bottom centre, laid out
 * left to right in rows from y 160. The trees are the pack's at their own size, as the units are
 * (a pine about a unit and a half tall, a big tree two); the rest at half size, as the map's own
 * rocks and pines are.
 */
export const DECOR_PROPS: readonly (readonly [string, number, number])[] = [
  ['tree-0', 22, 50],
  ['tree-1', 30, 52],
  ['tree-2', 36, 52],
  ['pine-0', 22, 37],
  ['pine-1', 18, 36],
  ['pine-2', 30, 37],
  ['bush-0', 14, 14],
  ['bush-1', 14, 14],
  ['stump-0', 12, 10],
  ['log-0', 20, 10],
  ['rock-small-0', 12, 10],
  ['rock-small-1', 12, 10],
  ['boulder-0', 20, 18],
  ['boulder-1', 20, 18],
  ['boulder-2', 18, 16],
];

/** The made sheet's size. */
export const FORD_SIZE = { w: 256, h: 232 };

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
  // The decoration (polish Q, Q6), under the rest.
  PATCH_SHAPES.forEach((_, i) => {
    out[`grass-dark-${i}`] = { x: i * 32, y: 112, w: 32, h: 32, anchor: 'center' };
    out[`grass-light-${i}`] = { x: 96 + i * 32, y: 112, w: 32, h: 32, anchor: 'center' };
  });
  DECOR_SMALL.forEach((n, i) => cell(n, i, 9));
  let x = 0;
  let y = 160;
  let tallest = 0;
  for (const [name, w, h] of DECOR_PROPS) {
    if (x + w > FORD_SIZE.w) [x, y, tallest] = [0, y + tallest, 0];
    out[name] = { x, y, w, h, anchor: 'bottom' };
    x += w;
    tallest = Math.max(tallest, h);
  }
  return out;
})();

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

/** One pixel of `rgb` at (x, y) with `alpha` (0 to 1), over what is there. */
function dot(p: Picture, x: number, y: number, rgb: readonly number[], alpha = 1): void {
  const one = blank(1, 1);
  one.px.set([rgb[0]!, rgb[1]!, rgb[2]!, Math.round(alpha * 255)]);
  paste(p, one, x, y);
}

/** A flat ellipse of shadow centred on (cx, cy), `rx` by `ry`, at the pack's own soft alpha. */
function shadow(p: Picture, cx: number, cy: number, rx: number, ry: number): void {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++)
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) dot(p, x, y, SHADOW, 0.22);
}

/** The 4x4 ordered-dither thresholds (0 to 15), for a patch's fading edge. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * A grass patch (darker or lighter grass) in one of {@link PATCH_SHAPES}: the pack's grass with
 * `tint` laid over it, opaque (so overlapping patches never darken twice), its edge one pixel of
 * ordered dither.
 */
function patch(grass: Picture, shape: (typeof PATCH_SHAPES)[number], tint: typeof DARK_TINT): Picture {
  const out = blank(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const inside = Math.max(...shape.map(([cx, cy, r]) => r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)));
      if (inside < 0 || (inside < 1 && BAYER[(y % 4) * 4 + (x % 4)]! >= 8)) continue;
      const at = ((y % 16) * 16 + (x % 16)) * 4;
      const rgb = [0, 1, 2].map((c) =>
        Math.round(grass.px[at + c]! * (1 - tint.alpha) + tint.rgb[c]! * tint.alpha),
      );
      out.px.set([rgb[0]!, rgb[1]!, rgb[2]!, 255], (y * 32 + x) * 4);
    }
  }
  return out;
}

/** A grass tuft: a few blades in the pack's leaf greens, the base at (x, y). */
function tuft(p: Picture, x: number, y: number, wide: boolean): void {
  const blades = wide ? [-2, 0, 2] : [-1, 1];
  for (const b of blades) {
    const h = b === 0 ? 3 : 2;
    for (let j = 0; j < h; j++) dot(p, x + b + (j === h - 1 ? Math.sign(b) : 0), y - j, LEAF_DARK);
    dot(p, x + b + (h > 1 ? Math.sign(b) : 0), y - h, LEAF_LIGHT);
  }
}

/** A flower at (x, y): its colour as a little cross with a bright heart, a stem pixel under. */
function flower(p: Picture, x: number, y: number, rgb: readonly number[]): void {
  dot(p, x, y + 2, LEAF_DARK);
  for (const [i, j] of [
    [0, -1],
    [-1, 0],
    [1, 0],
    [0, 1],
  ] as const)
    dot(p, x + i, y + j, rgb);
  dot(p, x, y, SPARKLE);
}

/** A mushroom at (x, y) (its stem's foot): a berry-red cap with a white spot over a pale stem. */
function mushroom(p: Picture, x: number, y: number): void {
  dot(p, x, y, FOAM);
  dot(p, x, y - 1, FOAM);
  for (let i = -1; i <= 1; i++) dot(p, x + i, y - 2, BERRY);
  for (let i = -2; i <= 2; i++) dot(p, x + i, y - 3 + (Math.abs(i) === 2 ? 1 : 0), BERRY);
  dot(p, x, y - 3, FOAM);
}

/**
 * A clump of reeds at (x, y) (its foot): three blades, the middle one `h` tall, outlined in the
 * pack's dark leaf green, with a cattail head on the middle one when `head`.
 */
function reed(p: Picture, x: number, y: number, h: number, head: boolean): void {
  const blade = (bx: number, bh: number, lean: number) => {
    for (let j = 0; j < bh; j++) {
      const at = bx + (j >= bh - 2 ? lean : 0);
      dot(p, at - 1, y - j, LEAF_DARK);
      dot(p, at + 1, y - j, LEAF_DARK);
      dot(p, at, y - j, j < bh / 3 ? LEAF : LEAF_LIGHT);
    }
    dot(p, bx + lean, y - bh, LEAF_DARK);
  };
  blade(x - 2, h - 2, -1);
  blade(x + 2, h - 3, 1);
  blade(x, h, 0);
  if (head) {
    for (let j = 1; j <= 3; j++) {
      dot(p, x - 1, y - h - j + 1, LEAF_DARK);
      dot(p, x + 1, y - h - j + 1, LEAF_DARK);
      dot(p, x, y - h - j + 1, TRUNK);
    }
    dot(p, x, y - h - 3, TRUNK_DARK);
  }
}

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
  decor(sheet, pack, grass, prop);
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

/**
 * Lays the decoration's frames (polish Q, Q6) onto `sheet`: the grass patches for every set of
 * open sides, the small ground pieces and the props, each prop over a soft shadow.
 */
function decor(
  sheet: Picture,
  pack: Picture,
  grass: Picture,
  prop: (rect: readonly [number, number, number, number]) => Picture,
): void {
  const frame = (name: string) => FORD_FRAMES[name]!;
  // A prop at the pack's own size, its faint shadow dropped (`stand` lays its own).
  const whole = ([x, y, w, h]: readonly [number, number, number, number]) => {
    const p = crop(pack, x, y, w, h);
    for (let i = 3; i < p.px.length; i += 4) if (p.px[i]! < 128) p.px[i] = 0;
    return p;
  };
  const at = (name: string, p: Picture, dx = 0, dy = 0) =>
    paste(sheet, p, frame(name).x + dx, frame(name).y + dy);
  PATCH_SHAPES.forEach((shape, i) => {
    at(`grass-dark-${i}`, patch(grass, shape, DARK_TINT));
    at(`grass-light-${i}`, patch(grass, shape, LIGHT_TINT));
  });
  // The small ground pieces, drawn into a 16 px cell each.
  const piece = (name: string, draw: (p: Picture) => void) => {
    const p = blank(16, 16);
    draw(p);
    at(name, p);
  };
  piece('tuft-0', (p) => {
    tuft(p, 4, 6, true);
    tuft(p, 11, 12, false);
  });
  piece('tuft-1', (p) => {
    tuft(p, 10, 5, false);
    tuft(p, 5, 12, true);
    tuft(p, 13, 14, false);
  });
  piece('tuft-2', (p) => tuft(p, 8, 10, true));
  piece('flowers-0', (p) => {
    flower(p, 4, 4, FOAM);
    flower(p, 11, 7, FOAM);
    flower(p, 6, 11, SPARKLE);
  });
  piece('flowers-1', (p) => {
    flower(p, 10, 3, BERRY);
    flower(p, 4, 8, BERRY);
    flower(p, 12, 11, FOAM);
  });
  piece('flowers-2', (p) => {
    flower(p, 5, 4, SPARKLE);
    flower(p, 11, 9, BERRY);
    tuft(p, 4, 13, false);
  });
  piece('mushrooms-0', (p) => {
    shadow(p, 6, 11, 3, 1);
    mushroom(p, 6, 11);
    mushroom(p, 10, 13);
  });
  piece('mushrooms-1', (p) => mushroom(p, 8, 9));
  const pebble = (rect: readonly [number, number, number, number]) => {
    const [x, y, w, h] = rect;
    return shrink(crop(pack, x, y, w, h), 4, true);
  };
  piece('pebbles-0', (p) => {
    for (const [x, y] of [
      [3, 4],
      [10, 8],
      [5, 11],
    ] as const) {
      shadow(p, x + 2, y + 4, 2, 1);
      paste(p, pebble(PROP.stone), x, y);
    }
  });
  piece('pebbles-1', (p) => {
    shadow(p, 9, 7, 2, 1);
    paste(p, pebble(PROP.stoneBrown), 7, 3);
    shadow(p, 5, 13, 2, 1);
    paste(p, pebble(PROP.stone), 3, 9);
    dot(p, 12, 12, [155, 166, 166]);
    dot(p, 13, 12, [104, 109, 109]);
  });
  const dirt = shrink(crop(pack, DIRT_TILE[0], DIRT_TILE[1], 64, 64), 4, false);
  const blob = (rx: number, ry: number, cx: number, cy: number) => (p: Picture) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const r = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
        const edge = r > 0.7;
        if (r <= 1 && (!edge || BAYER[(y % 4) * 4 + (x % 4)]! < 8)) {
          const at = (y * 16 + x) * 4;
          p.px.set([dirt.px[at]!, dirt.px[at + 1]!, dirt.px[at + 2]!, edge ? 150 : 210], at);
        }
      }
  };
  piece('dirt-0', blob(6.5, 4.5, 8, 9));
  piece('dirt-1', (p) => {
    blob(4.5, 3, 6, 6)(p);
    blob(3.5, 2.5, 11, 12)(p);
  });
  // The bank's darker grass under the reeds: a patch's tint in a wavy band down the cell, so a
  // column of reed cells reads as one dark strip along the river.
  const bank = patch(grass, [[8, 8, 9]], BANK_TINT);
  const reeds = (spots: readonly (readonly [number, number, number, boolean])[]) => (p: Picture) => {
    paste(p, crop(bank, 0, 0, 16, 16), 0, 0);
    for (const [x, y, h, head] of spots) reed(p, x, y, h, head);
  };
  piece(
    'reeds-0',
    reeds([
      [4, 8, 6, true],
      [11, 15, 7, true],
    ]),
  );
  piece(
    'reeds-1',
    reeds([
      [11, 7, 5, false],
      [5, 14, 7, true],
    ]),
  );
  piece('reeds-2', reeds([[8, 12, 8, true]]));
  // The props, each standing on its frame's bottom centre over a soft shadow.
  const stand = (name: string, parts: readonly (readonly [Picture, number])[], shadowW: number) => {
    const f = frame(name);
    const p = blank(f.w, f.h);
    shadow(p, f.w / 2, f.h - 2, shadowW / 2, shadowW > 14 ? 2.5 : 1.5);
    // Each part's lowest drawn row (its trunk's or rock's foot) on the shadow's middle.
    for (const [part, dx] of parts) {
      let foot = part.h - 1;
      while (
        foot > 0 &&
        !part.px.subarray(foot * part.w * 4, (foot + 1) * part.w * 4).some((v, i) => i % 4 === 3 && v > 0)
      )
        foot--;
      paste(p, part, Math.round(f.w / 2 - part.w / 2 + dx), f.h - 2 - foot);
    }
    at(name, p);
  };
  stand('tree-0', [[whole(PROP.cypressTall), 0]], 16);
  stand('tree-1', [[whole(PROP.pineTall), 0]], 22);
  stand(
    'tree-2',
    [
      [whole(PROP.cypressTall), -7],
      [whole(PROP.pine), 8],
    ],
    30,
  );
  stand('pine-0', [[whole(PROP.pine), 0]], 16);
  stand('pine-1', [[whole(PROP.cypress), 0]], 12);
  stand(
    'pine-2',
    [
      [whole(PROP.cypress), -7],
      [whole(PROP.pine), 4],
    ],
    24,
  );
  stand('bush-0', [[prop(PROP.bush), 0]], 10);
  stand('bush-1', [[prop(PROP.berries), 0]], 10);
  stand('stump-0', [[prop(PROP.stump), 0]], 8);
  stand('log-0', [[prop(PROP.log), 0]], 18);
  stand('rock-small-0', [[prop(PROP.stone), 0]], 9);
  stand('rock-small-1', [[prop(PROP.stoneBrown), 0]], 9);
  stand('boulder-0', [[prop(PROP.rock), 0]], 16);
  stand('boulder-1', [[prop(PROP.rocks), 0]], 18);
  stand('boulder-2', [[prop(PROP.boulder), 0]], 16);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
  writeFileSync(file(FORD_SHEET), fordTiles(readFileSync(file(PACK_SHEET))));
  console.log(`wrote ${file(FORD_SHEET)}`);
}
