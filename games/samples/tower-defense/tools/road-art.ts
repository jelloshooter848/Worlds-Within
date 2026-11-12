import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { encodePng } from '@engine/core/content/png';

/**
 * Makes The Winding Road's cut sheet (Engine 0.16 part E, E7): `assets/kenney-tower-defense/
 * road-art.png`, cut and put together from the pack's own sheets (Kenney's "Tower Defense
 * (top-down)", CC0; `assets/CREDITS.md`), `tilesheet-24.png` and `tilesheet-16.png` (the pack's
 * 64 px tiles box-filtered to 24 and 16 px, the files part F scaled for the mini siege). The pack
 * draws a tower as a base and a turret in two tiles, an enemy tank as a hull and a turret, and has
 * no road edges, so this script lays them together:
 *
 * - towers, 24 px, drawn facing up (the skin turns them to their target): a base per level (1:
 *   the small diamond plate, 2: the octagon, 3: the octagon with its plate) under a turret per type
 *   and level (arrow: the gun, the rocket, the twin rockets; cannon: the square cannon, the round
 *   cannon, the heavy twin; frost: the pack's shields and green turret in ice blue), each with a
 *   `-fire` copy whose turret sits 1 px back (the recoil);
 * - `ghost-<type>`: the level 1 tower at 55% alpha, for placing;
 * - enemies, 24 px, drawn facing right: `runner-0/1` (the pack's green soldier and its mirror
 *   across the way it walks, the step) and `brute-0/1` (the green tank's hull and turret, the
 *   second 1 px on, the treads' jolt), each with an ice-blue `-slow` copy;
 * - 16 px ground: `grass-0` to `grass-3` (the grass, with a bush, a rock or a plant),
 *   `road` and `road-<open sides>` for every set of open sides (the pack's dirt with a dark kerb
 *   on each side that meets grass; a skin's `join`), `cave` (the entry: dirt with the pack's dark
 *   crater), `gate` (the exit: dirt with its target plate) and `blank` (clear, for the shot
 *   entities: the skin flies projectiles instead).
 *
 * Run it with
 *
 *     pnpm exec tsx games/samples/tower-defense/tools/road-art.ts
 *
 * The same input gives the same bytes (`encodePng` writes stored deflate blocks), and
 * `assets.test.ts` checks the committed file against this script and the skin's `road` frames
 * against `ROAD_FRAMES`.
 */

/** The pack's sheets and the sheet made from them, relative to the game folder. */
export const PACK_24 = 'assets/kenney-tower-defense/tilesheet-24.png';
export const PACK_16 = 'assets/kenney-tower-defense/tilesheet-16.png';
export const ROAD_SHEET = 'assets/kenney-tower-defense/road-art.png';

/** The pack's sheets are 23 tiles across (13 down); tile n is at column n % 23, row n / 23. */
const PACK_COLS = 23;

/** An RGBA picture. */
interface Picture {
  w: number;
  h: number;
  px: Uint8Array;
}

/** A frame of the made sheet: its rectangle and, for a 24 px sprite, its anchor (`center`). */
export interface RoadFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  anchor?: 'center';
}

/** The three tower types, the tower levels and the turrets (pack tile numbers) per type. */
export const TOWER_TYPES = ['arrow', 'cannon', 'frost'] as const;
export const LEVELS = [1, 2, 3] as const;
const BASES = [183, 181, 180];
const TURRETS: Record<(typeof TOWER_TYPES)[number], readonly number[]> = {
  arrow: [203, 206, 205],
  cannon: [227, 226, 250],
  frost: [229, 228, 249],
};
/** The enemy kinds (pack tiles: a soldier; a tank's hull and turret). */
export const ENEMY_KINDS = ['runner', 'brute'] as const;
const SOLDIER = 245;
const HULL = 268;
const HULL_TURRET = 291;
/** The ground (16 px pack tiles). */
const GRASS = 157;
const DIRT = 158;
const DECOR = [131, 135, 134];
const CRATER = 19;
const PLATE = 18;

/** Ice blue, the frost tower's and a slowed enemy's colour. */
const ICE = [124, 216, 252] as const;
/** The road's kerb where it meets grass: the pack's dirt, darker. */
const KERB = [128, 82, 44] as const;

/** The open sides of a cell, in `join` key order. */
const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** Every set of open sides as a `join` key ('' for none), in a fixed order. */
export const SIDE_KEYS: readonly string[] = Array.from({ length: 16 }, (_, n) =>
  SIDES.filter((_, i) => (n >> i) & 1).join(' '),
);

/** A frame name's form of a key: `road-top-left`, `road` for none. */
export const roadFrame = (key: string) => (key === '' ? 'road' : `road-${key.replace(/ /g, '-')}`);

/** The 24 px frames, in sheet order. */
const BIG: readonly string[] = [
  ...TOWER_TYPES.flatMap((t) => LEVELS.flatMap((l) => [`${t}-${l}`, `${t}-${l}-fire`])),
  ...TOWER_TYPES.map((t) => `ghost-${t}`),
  ...ENEMY_KINDS.flatMap((k) => [`${k}-0`, `${k}-1`, `${k}-slow-0`, `${k}-slow-1`]),
];
/** The 16 px frames, in sheet order. */
const SMALL: readonly string[] = [
  'grass-0',
  'grass-1',
  'grass-2',
  'grass-3',
  ...SIDE_KEYS.map(roadFrame),
  'cave',
  'gate',
  'blank',
];

/** The made sheet: 24 px frames 12 to a row, then 16 px frames 18 to a row. */
const BIG_COLS = 12;
const SMALL_COLS = 18;
const BIG_ROWS = Math.ceil(BIG.length / BIG_COLS);
export const ROAD_SIZE = { w: 288, h: BIG_ROWS * 24 + Math.ceil(SMALL.length / SMALL_COLS) * 16 };

/** Every frame of the made sheet by name (the skin's `images.road.frames`). */
export const ROAD_FRAMES: Readonly<Record<string, RoadFrame>> = Object.fromEntries([
  ...BIG.map((name, i) => [
    name,
    { x: (i % BIG_COLS) * 24, y: Math.floor(i / BIG_COLS) * 24, w: 24, h: 24, anchor: 'center' as const },
  ]),
  ...SMALL.map((name, i) => [
    name,
    { x: (i % SMALL_COLS) * 16, y: BIG_ROWS * 24 + Math.floor(i / SMALL_COLS) * 16, w: 16, h: 16 },
  ]),
]);

/** Reads an 8-bit RGBA, non-interlaced PNG (the pack's sheets), every filter. */
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

/** Pack tile `n` of a sheet of `size` px tiles. */
function tile(sheet: Picture, size: number, n: number): Picture {
  return crop(sheet, (n % PACK_COLS) * size, Math.floor(n / PACK_COLS) * size, size, size);
}

/** Draws `src` onto `dst` at (x, y), over what is there (alpha blended), at `alpha`. */
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

/** `p` stacked: each layer pasted at its offset onto a clear picture of `p`'s size. */
function stack(size: number, layers: readonly (readonly [Picture, number, number])[]): Picture {
  const out = blank(size, size);
  for (const [p, x, y] of layers) paste(out, p, x, y);
  return out;
}

/** `p` mirrored top to bottom. */
function flipY(p: Picture): Picture {
  const out = blank(p.w, p.h);
  for (let j = 0; j < p.h; j++)
    out.px.set(p.px.subarray((p.h - 1 - j) * p.w * 4, (p.h - j) * p.w * 4), j * p.w * 4);
  return out;
}

/** `p` in shades of `rgb`: each pixel's luminance times the colour (a little brightened). */
function tint(p: Picture, rgb: readonly number[]): Picture {
  const out = crop(p, 0, 0, p.w, p.h);
  for (let i = 0; i < out.px.length; i += 4) {
    const l = (0.3 * out.px[i]! + 0.59 * out.px[i + 1]! + 0.11 * out.px[i + 2]!) / 255;
    for (let c = 0; c < 3; c++) out.px[i + c] = Math.min(255, Math.round(l * rgb[c]! * 1.35));
  }
  return out;
}

function fill(p: Picture, x: number, y: number, w: number, h: number, rgb: readonly number[]): void {
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) p.px.set([rgb[0]!, rgb[1]!, rgb[2]!, 255], (j * p.w + i) * 4);
}

/** A road cell: the pack's dirt with a one-pixel kerb on each side open to grass. */
function road(dirt: Picture, key: string): Picture {
  const out = crop(dirt, 0, 0, 16, 16);
  const open = key.split(' ');
  if (open.includes('top')) fill(out, 0, 0, 16, 1, KERB);
  if (open.includes('bottom')) fill(out, 0, 15, 16, 1, KERB);
  if (open.includes('left')) fill(out, 0, 0, 1, 16, KERB);
  if (open.includes('right')) fill(out, 15, 0, 1, 16, KERB);
  return out;
}

/** The made sheet's PNG bytes from the pack's 24 px and 16 px sheets' bytes. */
export function roadArt(pack24: Uint8Array, pack16: Uint8Array): Uint8Array {
  const big = readRgbaPng(pack24);
  const small = readRgbaPng(pack16);
  const t24 = (n: number) => tile(big, 24, n);
  const t16 = (n: number) => tile(small, 16, n);
  const sheet = blank(ROAD_SIZE.w, ROAD_SIZE.h);
  const at = (name: string, p: Picture, alpha = 1) =>
    paste(sheet, p, ROAD_FRAMES[name]!.x, ROAD_FRAMES[name]!.y, alpha);

  for (const type of TOWER_TYPES)
    for (const [i, level] of LEVELS.entries()) {
      const turret = type === 'frost' ? tint(t24(TURRETS[type][i]!), ICE) : t24(TURRETS[type][i]!);
      const base = t24(BASES[i]!);
      at(
        `${type}-${level}`,
        stack(24, [
          [base, 0, 0],
          [turret, 0, 0],
        ]),
      );
      at(
        `${type}-${level}-fire`,
        stack(24, [
          [base, 0, 0],
          [turret, 0, 1],
        ]),
      );
      if (level === 1)
        at(
          `ghost-${type}`,
          stack(24, [
            [base, 0, 0],
            [turret, 0, 0],
          ]),
          0.55,
        );
    }
  const soldier = t24(SOLDIER);
  const tank = stack(24, [
    [t24(HULL), 0, 0],
    [t24(HULL_TURRET), 0, 0],
  ]);
  const enemies: Record<(typeof ENEMY_KINDS)[number], readonly [Picture, Picture]> = {
    runner: [soldier, flipY(soldier)],
    brute: [tank, stack(24, [[tank, 1, 0]])],
  };
  for (const kind of ENEMY_KINDS)
    for (const [i, p] of enemies[kind].entries()) {
      at(`${kind}-${i}`, p);
      at(`${kind}-slow-${i}`, tint(p, ICE));
    }

  const grass = t16(GRASS);
  at('grass-0', grass);
  for (const [i, n] of DECOR.entries())
    at(
      `grass-${i + 1}`,
      stack(16, [
        [grass, 0, 0],
        [t16(n), 0, 0],
      ]),
    );
  const dirt = t16(DIRT);
  for (const key of SIDE_KEYS) at(roadFrame(key), road(dirt, key));
  at(
    'cave',
    stack(16, [
      [dirt, 0, 0],
      [t16(CRATER), 0, 0],
    ]),
  );
  at(
    'gate',
    stack(16, [
      [dirt, 0, 0],
      [t16(PLATE), 0, 0],
    ]),
  );
  return encodePng(sheet.w, sheet.h, sheet.px);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
  writeFileSync(file(ROAD_SHEET), roadArt(readFileSync(file(PACK_24)), readFileSync(file(PACK_16))));
  console.log(`wrote ${file(ROAD_SHEET)}`);
}
