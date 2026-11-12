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

const MATRICES: Record<DitherSize, Uint8Array> = {
  4: Uint8Array.from(bayer(4)),
  8: Uint8Array.from(bayer(8)),
};

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
  /**
   * `w * h` alpha bytes, 0-255, each a multiple of `255 / levels` rounded. Shared: every fill with
   * the same bytes gets the same array (see {@link ditheredRadial}), wherever it is drawn, so never
   * write to it; a backend may key what it makes from the bytes on this array.
   */
  alpha: Uint8Array;
}

/**
 * How finely the falloff is looked up per pixel: the stops' alpha is tabled at `FALLOFF_STEPS`
 * even steps of the distance from the centre to the radius (a step is under 0.05 px for a radius
 * of 160), so each pixel does one square root and one table read, not a scan through the stops.
 */
const FALLOFF_STEPS = 4096;

/**
 * The stops' alpha (clamped, times `levels`) at `FALLOFF_STEPS + 1` even distances from 0 to 1:
 * {@link stopsAlpha} walked once in order, so building it costs the steps plus the stops.
 */
function falloffTable(stops: readonly FalloffStop[], levels: number): Float64Array {
  const out = new Float64Array(FALLOFF_STEPS + 1);
  if (stops.length === 0) return out;
  const clamp = (a: number) => Math.min(1, Math.max(0, a));
  let i = 1;
  for (let k = 0; k <= FALLOFF_STEPS; k++) {
    const d = k / FALLOFF_STEPS;
    let a: number;
    if (d <= stops[0]!.at) a = stops[0]!.alpha;
    else {
      while (i < stops.length && d > stops[i]!.at) i++;
      if (i >= stops.length) a = stops[stops.length - 1]!.alpha;
      else {
        const p = stops[i - 1]!;
        const q = stops[i]!;
        a = q.at === p.at ? q.alpha : p.alpha + ((d - p.at) / (q.at - p.at)) * (q.alpha - p.alpha);
      }
    }
    out[k] = clamp(a) * levels;
  }
  return out;
}

/**
 * Which falloff table step each pixel of a fill's box reads: the step at the pixel centre's
 * distance (`FALLOFF_STEPS`: beyond the radius), row by row over `w` x `h` pixels. It depends only
 * on the radius and where the centre sits in the box, not on the stops or the box's place, so a
 * light that moves by whole pixels (the camera scrolling) or whose falloff changes in place (a
 * flash fading, a flicker) reuses it and only reads its table again.
 */
interface FillGeometry {
  index: Uint16Array;
  w: number;
}

/** A box bigger than this many pixels (a light far bigger than the picture) is cut to the picture, not kept whole. */
const GEOMETRY_MAX_PIXELS = 1 << 18;

/** A small cache of recently used values by key, oldest first, holding at most `limit` bytes in all. */
class Recent<T> {
  private readonly map = new Map<string, { value: T; bytes: number }>();
  private total = 0;
  constructor(private readonly limit: number) {}
  get(key: string): T | undefined {
    const e = this.map.get(key);
    if (e === undefined) return undefined;
    // Most recently used goes last, so what is drawn every frame outlives what changes each frame.
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }
  set(key: string, value: T, bytes: number): void {
    this.map.set(key, { value, bytes });
    this.total += bytes;
    for (const [k, e] of this.map) {
      if (this.total <= this.limit || this.map.size <= 1) break;
      this.map.delete(k);
      this.total -= e.bytes;
    }
  }
}

/**
 * How many bytes of dithered fills' alpha `ditheredRadial` keeps: a frame's worth many times over,
 * so the few Bayer phases a scrolling camera steps a light through (and a stepped flicker's
 * steps) are all kept.
 */
export const DITHER_CACHE_BYTES = 24 * 1024 * 1024;
const alphaCache = new Recent<Uint8Array>(DITHER_CACHE_BYTES);
const geometryCache = new Recent<FillGeometry>(DITHER_CACHE_BYTES);

/** The table steps of the pixels of a `w` x `h` box whose fill's centre is (cx, cy) from its corner. */
function fillGeometry(cx: number, cy: number, radius: number, w: number, h: number): FillGeometry {
  const index = new Uint16Array(w * h);
  const scale = FALLOFF_STEPS / radius;
  for (let j = 0; j < h; j++) {
    const dy = j + 0.5 - cy;
    const dy2 = dy * dy;
    let o = j * w;
    for (let i = 0; i < w; i++, o++) {
      const dx = i + 0.5 - cx;
      const t = Math.sqrt(dx * dx + dy2) * scale;
      // `t` is 0 or more, so `| 0` is the floor.
      index[o] = t >= FALLOFF_STEPS ? FALLOFF_STEPS : (t + 0.5) | 0;
    }
  }
  return { index, w };
}

/**
 * The pixels of a radial fill round (`g.x`, `g.y`) dithered by `dither`: for each picture pixel
 * of `g.box` (default the circle's bounding square), the stops' alpha at the pixel's centre's
 * distance (from a table of `FALLOFF_STEPS` steps), quantized as {@link ditherValue} at the
 * pixel's own picture position. With `bounds` (the target's size) it is null when the box is
 * wholly outside them, and a huge box (over `GEOMETRY_MAX_PIXELS`, a light far bigger than the
 * picture) is cut to them; any other box is kept whole, past the picture's edge, so a light the
 * camera scrolls across the edge keeps its bytes (the backend's drawing cuts it). Null too when
 * nothing is left to draw (no radius, an empty box). Pure in effect: the same fill gives the
 * same bytes.
 *
 * It runs for every light twice a frame, so it keeps recent fills' bytes (up to
 * `DITHER_CACHE_BYTES`) by what they depend on, none of it the fill's place in the picture: the
 * dither, radius and stops, where the centre sits in the box, where a cut box sits in the whole
 * one, and the stamp's corner modulo the Bayer size. So a steady light, and one the camera
 * scrolls (moved by whole pixels), gets the very same `alpha` array in a new stamp at its new
 * place (a backend may key what it made on it) once each Bayer phase has been seen. Any other
 * fill reuses its box's table steps ({@link FillGeometry}) when one of the same radius and
 * centre in its box was made lately, and only reads its falloff table and the Bayer matrix again.
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
  // `gx`, `gy`, `gw`, `gh`: the whole box in picture pixels (and the geometry's).
  let gx = Math.floor(box.x);
  let gy = Math.floor(box.y);
  let gw = Math.ceil(box.x + box.w) - gx;
  let gh = Math.ceil(box.y + box.h) - gy;
  let x0 = gx;
  let y0 = gy;
  let x1 = gx + gw;
  let y1 = gy + gh;
  if (bounds !== undefined) {
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(bounds.width, x1);
    y1 = Math.min(bounds.height, y1);
  }
  let w = x1 - x0;
  let h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  // Kept whole unless huge; then the cut box is the stamp and the geometry too.
  if (gw * gh > GEOMETRY_MAX_PIXELS) [gx, gy, gw, gh] = [x0, y0, w, h];
  else [x0, y0, w, h] = [gx, gy, gw, gh];
  const size = dither.size;
  const levels = Math.max(1, Math.floor(dither.levels));
  const where = `${g.x - gx} ${g.y - gy} ${g.radius} ${gw} ${gh}`;
  const mx0 = ((x0 % size) + size) % size;
  const my0 = ((y0 % size) + size) % size;
  // Everything the bytes depend on, in the box's own terms: the same key, the same bytes.
  let key = `${size} ${levels} ${where} ${x0 - gx} ${y0 - gy} ${w} ${h} ${mx0} ${my0}`;
  for (const s of g.stops) key += ` ${s.at}:${s.alpha}`;
  let alpha = alphaCache.get(key);
  if (alpha === undefined) {
    let geometry = geometryCache.get(where);
    if (geometry === undefined) {
      geometry = fillGeometry(g.x - gx, g.y - gy, g.radius, gw, gh);
      geometryCache.set(where, geometry, gw * gh * 2);
    }
    alpha = ditherFill(
      geometry,
      falloffTable(g.stops, levels),
      levels,
      size,
      x0 - gx,
      y0 - gy,
      w,
      h,
      mx0,
      my0,
    );
    alphaCache.set(key, alpha, w * h);
  }
  return { x: x0, y: y0, w, h, alpha };
}

/**
 * The alpha bytes of the `w` x `h` part at (`ox`, `oy`) of a fill's box: each pixel's table step
 * read from `geometry`, quantized against the Bayer matrix of side `size` starting at column
 * `mx0`, row `my0` (the part's corner's phase in the picture).
 */
function ditherFill(
  geometry: FillGeometry,
  table: Float64Array,
  levels: number,
  size: DitherSize,
  ox: number,
  oy: number,
  w: number,
  h: number,
  mx0: number,
  my0: number,
): Uint8Array {
  const { index } = geometry;
  const byte = Uint8Array.from({ length: levels + 1 }, (_, k) => Math.round((k / levels) * 255));
  const matrix = MATRICES[size];
  // `v - low > (rank + 0.5) / n²` (`ditherValue`) as `(v - low) * n² - 0.5 > rank`.
  const n2 = size * size;
  const alpha = new Uint8Array(w * h);
  let my = my0;
  for (let j = 0; j < h; j++) {
    const row = my * size;
    let src = (oy + j) * geometry.w + ox;
    let o = j * w;
    let mx = mx0;
    for (let i = 0; i < w; i++, o++, src++) {
      const v = table[index[src]!]!;
      // `v` is 0 or more, so `| 0` is the floor.
      const low = v | 0;
      const step = (v - low) * n2 - 0.5 > matrix[row + mx]! ? low + 1 : low;
      alpha[o] = byte[step > levels ? levels : step]!;
      if (++mx === size) mx = 0;
    }
    if (++my === size) my = 0;
  }
  return alpha;
}
