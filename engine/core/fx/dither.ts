/**
 * Ordered (Bayer) dithering of a radial falloff (docs/ROADMAP.md, Engine 0.16 polish P, C1): a
 * smooth light falloff quantized to a few alpha levels, each picture pixel rounded up or down by
 * a fixed threshold from its position in a 4x4 or 8x8 Bayer matrix. No RNG: the same fill always
 * gives the same bytes, wherever and however often it is drawn. Both 2D backends draw the bytes
 * {@link ditheredRadial} gives (`Renderer.gradient` with `dither`), so they draw the same pixels.
 */

/** A Bayer matrix's side: 4 (16 thresholds) or 8 (64). */
export type DitherSize = 4 | 8;

/** The Bayer matrix sizes a skin may ask for (`lighting.dither`; 0 is none). */
export const DITHER_SIZES: readonly DitherSize[] = [4, 8];

/** How a radial fill is dithered: the matrix's side and how many alpha steps it quantizes to. */
export interface RadialDither {
  size: DitherSize;
  /** Alpha steps from 0 to 1 (at least 1): each pixel is a multiple of `1 / levels`. */
  levels: number;
}

/** The Bayer matrix of side `n` (a power of 2), row by row: the ranks 0 to n² - 1. */
function bayer(n: number): number[] {
  if (n === 1) return [0];
  const h = n / 2;
  const m = bayer(h);
  const out = new Array<number>(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      // The classic recursion: each quarter is the half matrix times 4 plus 0, 2, 3 or 1.
      const q = (y < h ? 0 : 2) + (x < h ? 0 : 1);
      const add = [0, 2, 3, 1][q]!;
      out[y * n + x] = 4 * m[(y % h) * h + (x % h)]! + add;
    }
  return out;
}

const MATRICES: Record<DitherSize, readonly number[]> = { 4: bayer(4), 8: bayer(8) };

/** The Bayer rank (0 to size² - 1) at picture pixel (x, y), tiled over the picture. */
export function bayerRank(x: number, y: number, size: DitherSize): number {
  const mx = ((x % size) + size) % size;
  const my = ((y % size) + size) % size;
  return MATRICES[size][my * size + mx]!;
}

/** The threshold at picture pixel (x, y), in (0, 1): the rank's cell centre, `(rank + 0.5) / size²`. */
export function bayerThreshold(x: number, y: number, size: DitherSize): number {
  return (bayerRank(x, y, size) + 0.5) / (size * size);
}

/**
 * `value` (clamped to 0-1) quantized to a multiple of `1 / levels` at picture pixel (x, y): the
 * step below it, or the one above where its share of the way there passes the pixel's threshold.
 * 0 and 1 stay exactly 0 and 1; over a matrix's tile the steps average to the value.
 */
export function ditherValue(value: number, x: number, y: number, dither: RadialDither): number {
  const levels = Math.max(1, Math.floor(dither.levels));
  const v = Math.min(1, Math.max(0, value)) * levels;
  const low = Math.floor(v);
  const step = v - low > bayerThreshold(x, y, dither.size) ? low + 1 : low;
  return Math.min(levels, step) / levels;
}

/** One falloff stop: `at` 0 (centre) to 1 (radius), ascending; `alpha` 0-1. */
export interface FalloffStop {
  at: number;
  alpha: number;
}

/**
 * The stops' alpha `d` of the way from the centre to the radius: linear between stops, the first
 * stop's before it and the last's past it (as a canvas radial gradient), clamped to 0-1.
 */
export function stopsAlpha(stops: readonly FalloffStop[], d: number): number {
  if (stops.length === 0) return 0;
  const clamp = (a: number) => Math.min(1, Math.max(0, a));
  if (d <= stops[0]!.at) return clamp(stops[0]!.alpha);
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!;
    const b = stops[i]!;
    if (d <= b.at)
      return clamp(b.at === a.at ? b.alpha : a.alpha + ((d - a.at) / (b.at - a.at)) * (b.alpha - a.alpha));
  }
  return clamp(stops[stops.length - 1]!.alpha);
}

/** A dithered fill's pixels: the alpha byte of each pixel of the box at (x, y), row by row. */
export interface DitheredStamp {
  /** The top-left picture pixel (whole numbers). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** `w * h` alpha bytes, 0-255, each a multiple of `255 / levels` rounded. */
  alpha: Uint8Array;
}

/**
 * The pixels of a radial fill round (`g.x`, `g.y`) dithered by `dither`: for each picture pixel
 * of `g.box` (default the circle's bounding square), cut to `bounds` (the target's size) when
 * given, the stops' alpha at the pixel's centre's distance, quantized by {@link ditherValue} at
 * the pixel's own picture position. Null when nothing is left to draw (no radius, an empty box).
 * Pure: the same fill gives the same bytes.
 */
export function ditheredRadial(
  g: {
    x: number;
    y: number;
    radius: number;
    stops: readonly FalloffStop[];
    box?: { x: number; y: number; w: number; h: number } | undefined;
  },
  dither: RadialDither,
  bounds?: { width: number; height: number },
): DitheredStamp | null {
  if (!(g.radius > 0)) return null;
  const box = g.box ?? { x: g.x - g.radius, y: g.y - g.radius, w: g.radius * 2, h: g.radius * 2 };
  let x0 = Math.floor(box.x);
  let y0 = Math.floor(box.y);
  let x1 = Math.ceil(box.x + box.w);
  let y1 = Math.ceil(box.y + box.h);
  if (bounds !== undefined) {
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(bounds.width, x1);
    y1 = Math.min(bounds.height, y1);
  }
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  const alpha = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const py = y0 + j;
    const dy = py + 0.5 - g.y;
    for (let i = 0; i < w; i++) {
      const px = x0 + i;
      const d = Math.hypot(px + 0.5 - g.x, dy) / g.radius;
      const a = ditherValue(stopsAlpha(g.stops, d), px, py, dither);
      alpha[j * w + i] = Math.round(a * 255);
    }
  }
  return { x: x0, y: y0, w, h, alpha };
}
