import { ease, isEaseName, type EaseName } from '../fx/ease';
import { fogShade, fogState, type ResolvedFogLook } from '../present/fog';
import type { DeepReadonly, PresentBox, PresentEntity, PresentFog, PresentMap } from '../present/types';
import type { Box } from './nine-slice';
import type { UiFill } from './paint';

/**
 * HUD widget maths (Engine 0.16 T6): how a status value maps to a bar's fill, how a counter rolls
 * to a new number, and a minimap's boxes from the map's tiles and the frame's entities. Pure.
 */

/** The share of `max` that `value` is, clamped to 0..1 (0 when `max` is not above 0). */
export function barRatio(value: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value / max));
}

/**
 * The filled px of a bar `width` px wide showing `value` of `max`: rounded, but never empty while
 * the value is above 0 and never full until it reaches `max`.
 */
export function barFill(value: number, max: number, width: number): number {
  const ratio = barRatio(value, max);
  if (ratio <= 0 || width <= 0) return 0;
  if (ratio >= 1) return width;
  return Math.min(width - 1, Math.max(1, Math.round(ratio * width)));
}

/** How a counter rolls to a new value. */
export interface RollSpec {
  ticks: number;
  ease?: string;
}

/** The ease a roll uses when it names none. */
export const ROLL_DEFAULT_EASE: EaseName = 'cubicOut';

/**
 * A number that rolls to each new value over `ticks` display frames instead of jumping
 * (presentation state only, one per counter). The first value shows at once.
 */
export class CounterRoll {
  private from = 0;
  private to: number | null = null;
  private start = 0;

  constructor(private readonly spec: RollSpec) {}

  /** The number to show at `clock` (a frame count that only goes up) for the value `target`. */
  shown(target: number, clock: number): number {
    if (this.to === null) {
      this.from = target;
      this.to = target;
      this.start = clock;
    } else if (target !== this.to) {
      this.from = this.at(clock);
      this.to = target;
      this.start = clock;
    }
    return this.at(clock);
  }

  /** Whether the number is still on its way at `clock`. */
  rolling(clock: number): boolean {
    return this.to !== null && this.from !== this.to && clock - this.start < this.spec.ticks;
  }

  private at(clock: number): number {
    const to = this.to ?? 0;
    const name =
      this.spec.ease !== undefined && isEaseName(this.spec.ease) ? this.spec.ease : ROLL_DEFAULT_EASE;
    const t = (clock - this.start) / this.spec.ticks;
    return Math.round(this.from + (to - this.from) * ease(name, t));
  }
}

/** A minimap: its box, tile colours, background, entity dots and px per tile. */
export interface MinimapSpec {
  box: Box;
  tiles: Readonly<Record<string, string>>;
  back?: string;
  dots: readonly { kind?: string; tag?: string; color: string; size?: number }[];
  scale?: number;
  /** The fog's look: with it a frame's fog is drawn over the tiles (Engine 0.16 part D). */
  fog?: ResolvedFogLook;
  /** Tag -> dot colour, over a dot entry's own colour (the first tag of the table an entity has). */
  teams?: Readonly<Record<string, string>>;
  /** The camera view's outline colour: with it the shown world box is outlined. */
  view?: string;
}

/** What a minimap reads besides the map and the entities (Engine 0.16 part D). */
export interface MinimapExtras {
  /** The frame's fog, drawn when the spec has a `fog` look. */
  fog?: DeepReadonly<PresentFog> | null;
  /** The world box the picture shows (the camera's view), outlined when the spec has a `view`. */
  view?: PresentBox | null;
}

/** A minimap dot's side when it gives none. */
export const MINIMAP_DOT = 2;

/** Px per tile that fits the whole map in the box (at most 4). */
export function minimapScale(map: { cols: number; rows: number }, box: { w: number; h: number }): number {
  if (map.cols <= 0 || map.rows <= 0) return 1;
  return Math.min(4, box.w / map.cols, box.h / map.rows);
}

/**
 * The minimap's fills: the background, then each tile with a colour, then a dot for each entity
 * a dot entry matches (by kind or tag; the first entry that matches wins), centred on the entity
 * and kept inside the box. Tile `c` spans `floor(c * scale)` to `floor((c + 1) * scale)`, so at a
 * scale under 1 a tile whose span is empty is skipped (the last tile of each px shows) and runs of one colour on a row
 * are one fill. Everything is cut to the box.
 */
export function minimapDraws(
  spec: MinimapSpec,
  map: DeepReadonly<PresentMap> | null,
  entities: readonly DeepReadonly<PresentEntity>[],
  extras: MinimapExtras = {},
): UiFill[] {
  const { box } = spec;
  const out: UiFill[] = [];
  if (spec.back !== undefined) out.push({ kind: 'fill', ...box, color: spec.back });
  if (map === null) return out;
  const scale = spec.scale ?? minimapScale(map, box);
  const span = (n: number) => Math.floor(n * scale);
  const rows = map.tiles as readonly (string | readonly number[])[];
  for (let r = 0; r < rows.length; r++) {
    const y0 = span(r);
    const y1 = Math.min(span(r + 1), box.h);
    if (y1 <= y0) continue;
    const line = rows[r]!;
    let run: UiFill | null = null;
    for (let c = 0; c < line.length; c++) {
      const x0 = span(c);
      if (x0 >= box.w) break;
      const x1 = Math.min(span(c + 1), box.w);
      if (x1 <= x0) continue;
      const key = String(line[c]);
      const color = Object.hasOwn(spec.tiles, key) ? spec.tiles[key] : undefined;
      if (color === undefined) {
        run = null;
        continue;
      }
      if (run !== null && run.color === color && run.x + run.w === box.x + x0) run.w += x1 - x0;
      else {
        run = { kind: 'fill', x: box.x + x0, y: box.y + y0, w: x1 - x0, h: y1 - y0, color };
        out.push(run);
      }
    }
  }
  if (spec.fog !== undefined && extras.fog != null) out.push(...minimapFog(spec.fog, extras.fog, box, span));
  const ts = map.tileSize;
  for (const e of entities) {
    const dot = spec.dots.find((d) => (d.kind !== undefined ? d.kind === e.kind : e.tags.includes(d.tag!)));
    if (dot === undefined) continue;
    const size = dot.size ?? MINIMAP_DOT;
    const cx = ((e.x + e.w / 2) / ts) * scale;
    const cy = ((e.y + e.h / 2) / ts) * scale;
    const x = Math.min(box.w - size, Math.max(0, Math.round(cx - size / 2)));
    const y = Math.min(box.h - size, Math.max(0, Math.round(cy - size / 2)));
    out.push({
      kind: 'fill',
      x: box.x + x,
      y: box.y + y,
      w: size,
      h: size,
      color: teamColor(spec, e) ?? dot.color,
    });
  }
  if (spec.view !== undefined && extras.view != null)
    out.push(...minimapView(spec.view, extras.view, box, scale / ts));
  return out;
}

/** The colour `spec.teams` gives an entity: the first tag of the table it has, or undefined. */
function teamColor(spec: MinimapSpec, e: DeepReadonly<PresentEntity>): string | undefined {
  if (spec.teams === undefined) return undefined;
  for (const [tag, color] of Object.entries(spec.teams)) if (e.tags.includes(tag)) return color;
  return undefined;
}

/**
 * The fog over a minimap's tiles: each unexplored or explored cell's span (the tiles' own spans)
 * as a fill at its shade's alpha, a row's run of one state merged, cut to the box.
 */
function minimapFog(
  look: ResolvedFogLook,
  fog: DeepReadonly<PresentFog>,
  box: Box,
  span: (n: number) => number,
): UiFill[] {
  const out: UiFill[] = [];
  for (let r = 0; r < fog.rows; r++) {
    const y0 = span(r);
    const y1 = Math.min(span(r + 1), box.h);
    if (y1 <= y0) continue;
    let run: UiFill | null = null;
    let runState: string | null = null;
    for (let c = 0; c < fog.cols; c++) {
      const x0 = span(c);
      if (x0 >= box.w) break;
      const x1 = Math.min(span(c + 1), box.w);
      if (x1 <= x0) continue;
      const state = fogState(fog, c, r);
      const shade = fogShade(look, state);
      if (shade === null || shade.alpha <= 0) {
        run = null;
        continue;
      }
      if (run !== null && runState === state && run.x + run.w === box.x + x0) run.w += x1 - x0;
      else {
        run = { kind: 'fill', x: box.x + x0, y: box.y + y0, w: x1 - x0, h: y1 - y0, color: shade.color };
        if (shade.alpha < 1) run.alpha = shade.alpha;
        runState = state;
        out.push(run);
      }
    }
  }
  return out;
}

/** A one-px outline of the world box `view` on the minimap (`k` minimap px per world px), cut to the box. */
function minimapView(color: string, view: PresentBox, box: Box, k: number): UiFill[] {
  const x0 = Math.max(0, Math.floor(view.x * k));
  const y0 = Math.max(0, Math.floor(view.y * k));
  const x1 = Math.min(box.w, Math.ceil((view.x + view.w) * k));
  const y1 = Math.min(box.h, Math.ceil((view.y + view.h) * k));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return [];
  const fill = (x: number, y: number, fw: number, fh: number): UiFill => ({
    kind: 'fill',
    x: box.x + x,
    y: box.y + y,
    w: fw,
    h: fh,
    color,
  });
  const out = [fill(x0, y0, w, 1)];
  if (h > 1) out.push(fill(x0, y1 - 1, w, 1));
  if (h > 2) out.push(fill(x0, y0 + 1, 1, h - 2));
  if (h > 2 && w > 1) out.push(fill(x1 - 1, y0 + 1, 1, h - 2));
  return out;
}

/**
 * The world point under picture point (`x`, `y`) on a minimap (Engine 0.16 part D), for a page's
 * click or tap: the inverse of the minimap's tile spans (world px, unrounded), or null when the
 * point is outside the box or the drawn map. Pure.
 */
export function minimapPointToWorld(
  spec: { box: Box; scale?: number },
  map: { cols: number; rows: number; tileSize: number },
  x: number,
  y: number,
): { x: number; y: number } | null {
  const { box } = spec;
  const lx = x - box.x;
  const ly = y - box.y;
  if (lx < 0 || ly < 0 || lx >= box.w || ly >= box.h) return null;
  const scale = spec.scale ?? minimapScale(map, box);
  if (!(scale > 0)) return null;
  const wx = (lx / scale) * map.tileSize;
  const wy = (ly / scale) * map.tileSize;
  if (wx >= map.cols * map.tileSize || wy >= map.rows * map.tileSize) return null;
  return { x: wx, y: wy };
}

/** A clock's day bar (Engine 0.16 F4): the colours, tick marks and marker a skin gives it. */
export interface DayBarSpec {
  /** Where no band covers the bar (default {@link DAY_BAR_BACK}). */
  back?: string;
  /** Colours along the day, each from its hour to the next band's (the last to midnight). */
  bands?: readonly { hour: number; color: string }[];
  /** Hours with a one-px tick mark. */
  marks?: readonly number[];
  /** The tick marks' colour (default `#000000`). */
  markColor?: string;
  /** The marker at the time now (default {@link DAY_BAR_MARKER}). */
  marker?: string;
}

/** A day bar's colour where no band covers it, when the skin gives none. */
export const DAY_BAR_BACK = '#203050';

/** A day bar's marker colour when the skin gives none. */
export const DAY_BAR_MARKER = '#fcfcfc';

/** The px of a day bar `width` wide at `hour` (0 at the left edge, midnight at the right). */
export function dayBarX(hour: number, width: number): number {
  return Math.min(width - 1, Math.max(0, Math.round((hour / 24) * (width - 1))));
}

/**
 * A day bar's fills in `box` (Engine 0.16 F4): the back, each band from its hour to the next's,
 * the tick marks, and the marker at `fraction` of the day (0 up to 1) one px wide, standing a px
 * above and below the bar; no marker when `fraction` is null. Pure.
 */
export function dayBarDraws(spec: DayBarSpec, box: Box, fraction: number | null): UiFill[] {
  if (box.w <= 0 || box.h <= 0) return [];
  const out: UiFill[] = [{ kind: 'fill', ...box, color: spec.back ?? DAY_BAR_BACK }];
  const bands = spec.bands ?? [];
  bands.forEach((band, i) => {
    const from = dayBarX(band.hour, box.w);
    const to = i + 1 < bands.length ? dayBarX(bands[i + 1]!.hour, box.w) : box.w;
    if (to > from)
      out.push({ kind: 'fill', x: box.x + from, y: box.y, w: to - from, h: box.h, color: band.color });
  });
  for (const hour of spec.marks ?? [])
    out.push({
      kind: 'fill',
      x: box.x + dayBarX(hour, box.w),
      y: box.y,
      w: 1,
      h: box.h,
      color: spec.markColor ?? '#000000',
    });
  if (fraction !== null && Number.isFinite(fraction)) {
    const x = box.x + dayBarX(Math.min(1, Math.max(0, fraction)) * 24, box.w);
    out.push({ kind: 'fill', x, y: box.y - 1, w: 1, h: box.h + 2, color: spec.marker ?? DAY_BAR_MARKER });
  }
  return out;
}
