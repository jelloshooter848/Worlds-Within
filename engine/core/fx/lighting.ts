import { resolveSkinEvent, type SkinFile } from '../present/skin';
import type { DeepReadonly, PresentEntity, PresentEvent, PresentMap, PresentMapPart } from '../present/types';
import type { ScreenSize } from '../gfx/screen';
import { lerpColor } from './color';
import type { DitherSize, RadialDither } from './dither';
import { anchorPoint } from './particles';
import { fxRng } from './rng';
import {
  LIGHT_DEFAULTS,
  LIGHT_DITHER_LEVELS,
  type AmbientSpec,
  type EventLight,
  type LightFlicker,
  type LightingSpec,
} from './schema';

/**
 * 2D lighting (docs/ROADMAP.md, Engine 0.16 part C T4): a skin's `lighting` block laid out once
 * per frame for a backend to draw. Pure and presentation only: it reads the frame, the shown map
 * and the skin, keeps the event flashes it started, and draws its flicker from `fxRng(seed,
 * step, 'light:<key>')`, so the same seed and frames give the same picture and no state moves.
 *
 * A backend draws the {@link LightingLayout} after the entities and particles and before the HUD:
 * the darkness over the whole picture with each light cutting a soft hole in it (a light map),
 * then each light's coloured glow added on top, then the vignette.
 */

type Skin = DeepReadonly<SkinFile>;
type Lighting = DeepReadonly<LightingSpec>;
type Entity = DeepReadonly<PresentEntity>;
type Map = DeepReadonly<PresentMap>;

/** The camera as a presenter frames it: the picture px at the world's origin's offset, and the zoom. */
export interface LightingView {
  /** The camera's top-left in picture px (zoom and shake included): world x is drawn at `round(x * zoom) - view.x`. */
  x: number;
  y: number;
  zoom: number;
}

/** One light as a backend draws it, in picture px. */
export interface LightDraw {
  /** A stable name (`<entity id>:<i>`, `<map id>:<i>`, `tile:<col>,<row>`, `event:<n>`). */
  key: string;
  x: number;
  y: number;
  radius: number;
  /** `#rrggbb` or `#rgb`. */
  color: string;
  /** How much darkness it clears at its centre (0-1). */
  intensity: number;
  /** How strongly its colour is added at its centre (0-1). */
  glow: number;
}

/** What a backend draws for a skin's lighting this frame, in picture px. */
export interface LightingLayout {
  /** The darkness over the picture where no light reaches, or null for none. */
  darkness: { color: string; level: number } | null;
  lights: LightDraw[];
  vignette: { color: string; strength: number; inner: number } | null;
  /** Flat steps in each light's falloff (0: smooth); with `dither`, the alpha steps dithered between. */
  bands: number;
  /** The Bayer matrix's side each falloff is dithered with (0: none; Engine 0.16 polish P, C1). */
  dither: 0 | DitherSize;
}

/** A placed light's sprite to draw this frame, in world px (top-left), before the entities. */
export interface LightPropDraw {
  sheet: string | undefined;
  frame: string;
  x: number;
  y: number;
}

/** One stop of a light's falloff: `at` 0 (centre) to 1 (radius), `alpha` how much it clears or adds. */
export interface LightStop {
  at: number;
  alpha: number;
}

/** The ticks a placed light's sprite frame shows when it gives none. */
export const LIGHT_SPRITE_TICKS = 8;
/** How many stops a smooth falloff has. */
export const LIGHT_SMOOTH_STOPS = 8;
/**
 * How many stops a dithered falloff has: finer than a plain smooth one, so the straight runs
 * between stops do not show through the dither as faint rings.
 */
export const LIGHT_DITHER_STOPS = 32;

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * The falloff of a light of `intensity` from its centre to its radius: smooth (`bands` 0: an
 * ease from full to nothing) or in `bands` flat steps, each band's value the curve's at its inner
 * edge, so a band's edges are hard (two stops at one place). The last stop is always 0 at 1.
 * With `dither` (a Bayer size, Engine 0.16 polish P) it is always the smooth ease, in
 * `LIGHT_DITHER_STOPS` stops: the steps come from dithering it (`lightDither`), not from stops.
 */
export function lightStops(intensity: number, bands = 0, dither = 0): LightStop[] {
  const fall = (t: number) => intensity * (1 - smoothstep(Math.min(1, Math.max(0, t))));
  if (bands <= 0 || dither > 0) {
    const n = dither > 0 ? LIGHT_DITHER_STOPS : LIGHT_SMOOTH_STOPS;
    return Array.from({ length: n + 1 }, (_, i) => ({ at: i / n, alpha: fall(i / n) }));
  }
  const out: LightStop[] = [];
  for (let i = 0; i < bands; i++) {
    const v = fall(i / bands);
    out.push({ at: i / bands, alpha: v }, { at: (i + 1) / bands, alpha: v });
  }
  out.push({ at: 1, alpha: 0 });
  return out;
}

/**
 * How a layout's falloffs are dithered (`RadialFill.dither`), or undefined for none: its Bayer
 * size, between `bands` alpha steps, or `LIGHT_DITHER_LEVELS` when it has no bands.
 */
export function lightDither(layout: { bands: number; dither: number }): RadialDither | undefined {
  if (layout.dither !== 4 && layout.dither !== 8) return undefined;
  return { size: layout.dither, levels: layout.bands > 0 ? layout.bands : LIGHT_DITHER_LEVELS };
}

/**
 * A flicker's value at presentation `step` for the light named `key`, in [-1, 1]: a random value
 * every `rate` steps (from `fxRng(seed, k, 'light:<key>')`), eased between, so the same seed, key
 * and step always flicker the same way and two lights never in step.
 */
export function flickerNoise(
  seed: number,
  key: string,
  step: number,
  rate: number = LIGHT_DEFAULTS.flickerRate,
): number {
  const k = Math.floor(step / rate);
  const u = (step - k * rate) / rate;
  const at = (n: number) => fxRng(seed, n, `light:${key}`).float() * 2 - 1;
  const a = at(k);
  const b = at(k + 1);
  return a + (b - a) * smoothstep(u);
}

/** A light's radius, intensity and glow with its flicker applied (`noise` in [-1, 1]). */
export function flickered(
  light: { radius: number; intensity: number; glow: number },
  flicker: DeepReadonly<LightFlicker> | undefined,
  noise: number,
  scale = 1,
): { radius: number; intensity: number; glow: number } {
  if (flicker === undefined || flicker.amount === 0) return light;
  const f = 1 + flicker.amount * scale * noise;
  return {
    radius: Math.max(0, light.radius * f),
    intensity: Math.min(1, Math.max(0, light.intensity * (1 + (f - 1) * 0.5))),
    glow: Math.min(1, Math.max(0, light.glow * f)),
  };
}

/** The darkness a map part takes: its map's entry, else the first matching tag's, else the skin's. */
export function ambientFor(
  lighting: Lighting,
  part: { id: string; tags?: readonly string[] | undefined },
): DeepReadonly<AmbientSpec> | undefined {
  const maps = lighting.maps ?? {};
  const own = Object.hasOwn(maps, part.id) ? maps[part.id]!.ambient : undefined;
  if (own !== undefined) return own;
  const tags = part.tags ?? [];
  for (const [tag, spec] of Object.entries(lighting.tags ?? {})) if (tags.includes(tag)) return spec;
  return lighting.ambient;
}

/** The parts a map is made of: its own `parts`, else the whole map as one. */
export function mapParts(map: Map): DeepReadonly<PresentMapPart>[] {
  if (map.parts !== undefined && map.parts.length > 0) return [...map.parts];
  return [
    { id: map.id, col: 0, row: 0, cols: map.cols, rows: map.rows, ...(map.tags && { tags: map.tags }) },
  ];
}

/**
 * The darkness over the picture: each part's ambient weighted by how much of the view it covers
 * (a room slide fades from one room's darkness to the next), or null when there is none.
 */
export function blendedDarkness(
  lighting: Lighting,
  map: Map | null,
  world: { x: number; y: number; w: number; h: number },
): { color: string; level: number } | null {
  const parts =
    map === null ? [{ id: '', tags: [] as string[], col: 0, row: 0, cols: 0, rows: 0 }] : mapParts(map);
  const ts = map?.tileSize ?? 1;
  let total = 0;
  const weighted: { spec: DeepReadonly<AmbientSpec> | undefined; w: number }[] = [];
  for (const p of parts) {
    const x0 = Math.max(world.x, p.col * ts);
    const y0 = Math.max(world.y, p.row * ts);
    const x1 = Math.min(world.x + world.w, (p.col + p.cols) * ts);
    const y1 = Math.min(world.y + world.h, (p.row + p.rows) * ts);
    const w = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    total += w;
    weighted.push({ spec: ambientFor(lighting, p), w });
  }
  // Nothing of the map in view: the first part's darkness.
  if (total === 0)
    weighted.forEach((x, i) => {
      x.w = i === 0 ? 1 : 0;
    });
  const sum = total === 0 ? 1 : total;
  let level = 0;
  let color: string | null = null;
  let seen = 0;
  for (const { spec, w } of weighted) {
    if (w === 0) continue;
    const l = spec?.level ?? 0;
    level += (l * w) / sum;
    const c = spec?.color ?? LIGHT_DEFAULTS.ambientColor;
    // A running weighted average of the colours.
    seen += w;
    color = color === null ? c : lerpColor(color, c, w / seen);
  }
  if (level <= 0 || color === null) return null;
  // Rounded, so one part's level comes out exactly as written.
  return { color, level: Math.min(1, Math.round(level * 1e6) / 1e6) };
}

/** An event flash running. */
interface Flash {
  light: DeepReadonly<EventLight>;
  x: number;
  y: number;
  start: number;
  key: string;
}

export interface SkinLightingOptions {
  /** The run's seed for the flicker (default 0). */
  seed?: number;
}

export interface LightingInput {
  /** The presentation frame number (flicker and flashes are timed by it). */
  frame: number;
  entities: readonly Entity[];
  /** The full map shown, or null. */
  map: Map | null;
  view: LightingView;
  size: ScreenSize;
  /** The player's reduced flashing: event flashes and flicker at half strength. */
  reduceFlashing?: boolean;
}

/**
 * A skin's lighting for one presenter (the part every 2D backend shares, as `SkinParticles` is):
 * `event` starts an event's flash, `layout` gives what to draw this frame, `props` the placed
 * lights' sprites. Presenter state only: it never writes to a frame or the skin.
 */
export class SkinLighting {
  private readonly seed: number;
  private flashes: Flash[] = [];
  private flashCount = 0;
  private tileCache: {
    id: string;
    version: number;
    points: { key: string; tile: string; col: number; row: number }[];
  } | null = null;

  constructor(
    private readonly skin: Skin,
    opts: SkinLightingOptions = {},
  ) {
    this.seed = opts.seed ?? 0;
  }

  /** The skin's `lighting` block, or undefined. */
  get spec(): Lighting | undefined {
    return this.skin.lighting;
  }

  /** How many event flashes are running (after the last `layout`). */
  get flashesRunning(): number {
    return this.flashes.length;
  }

  /**
   * Starts the flash the skin's `lighting.events` gives event `ev` (matched like the skin's
   * `events`: `type:value` keys first), at its `x`/`y`, else its entity's centre.
   */
  event(ev: DeepReadonly<PresentEvent>, entities: readonly Entity[], frame: number): void {
    const light = resolveSkinEvent(this.spec?.events, ev);
    if (light === undefined) return;
    const at = ev.entity === undefined ? undefined : entities.find((e) => e.id === ev.entity);
    const x = (ev.x ?? (at ? at.x + at.w / 2 : 0)) + (light.offset?.x ?? 0);
    const y = (ev.y ?? (at ? at.y + at.h / 2 : 0)) + (light.offset?.y ?? 0);
    this.flashes.push({ light, x, y, start: frame, key: `event:${this.flashCount++}` });
  }

  /** The placed lights' sprites on `map` at `frame`, in world px (each part's at its place). */
  props(map: Map | null, frame: number): LightPropDraw[] {
    const maps = this.spec?.maps;
    if (map === null || maps === undefined) return [];
    const out: LightPropDraw[] = [];
    for (const part of mapParts(map)) {
      if (!Object.hasOwn(maps, part.id)) continue;
      const ox = part.col * map.tileSize;
      const oy = part.row * map.tileSize;
      for (const light of maps[part.id]!.lights ?? []) {
        const s = light.sprite;
        if (s === undefined) continue;
        const ticks = s.ticks ?? LIGHT_SPRITE_TICKS;
        const i = Math.floor(Math.max(0, frame) / ticks) % s.frames.length;
        out.push({ sheet: s.sheet, frame: s.frames[i]!, x: ox + s.x, y: oy + s.y });
      }
    }
    return out;
  }

  /** What to draw this frame, or null when the skin has no lighting. */
  layout(input: LightingInput): LightingLayout | null {
    const lighting = this.spec;
    if (lighting === undefined) return null;
    const { frame, view, size } = input;
    const reduce = input.reduceFlashing === true ? 0.5 : 1;
    this.flashes = this.flashes.filter((f) => frame >= f.start && frame - f.start < f.light.ticks);
    const world = {
      x: view.x / view.zoom,
      y: view.y / view.zoom,
      w: size.width / view.zoom,
      h: size.height / view.zoom,
    };
    const lights: LightDraw[] = [];
    const add = (
      key: string,
      wx: number,
      wy: number,
      spec: {
        readonly radius: number;
        readonly color?: string | undefined;
        readonly intensity?: number | undefined;
        readonly glow?: number | undefined;
        readonly flicker?: DeepReadonly<LightFlicker> | undefined;
      },
      fade = 1,
    ) => {
      const base = {
        radius: spec.radius,
        intensity: (spec.intensity ?? LIGHT_DEFAULTS.intensity) * fade,
        glow: (spec.glow ?? LIGHT_DEFAULTS.glow) * fade,
      };
      const noise =
        spec.flicker === undefined
          ? 0
          : flickerNoise(this.seed, key, frame, spec.flicker.rate ?? LIGHT_DEFAULTS.flickerRate);
      const l = flickered(base, spec.flicker, noise, reduce);
      const radius = l.radius * view.zoom;
      const x = Math.round(wx * view.zoom) - view.x;
      const y = Math.round(wy * view.zoom) - view.y;
      if (radius <= 0 || (l.intensity <= 0 && l.glow <= 0)) return;
      if (x + radius < 0 || y + radius < 0 || x - radius > size.width || y - radius > size.height) return;
      lights.push({
        key,
        x,
        y,
        radius,
        color: spec.color ?? LIGHT_DEFAULTS.color,
        intensity: l.intensity,
        glow: l.glow,
      });
    };

    const map = input.map;
    // Placed lights, each part's at its place.
    if (map !== null && lighting.maps !== undefined) {
      for (const part of mapParts(map)) {
        if (!Object.hasOwn(lighting.maps, part.id)) continue;
        const ox = part.col * map.tileSize;
        const oy = part.row * map.tileSize;
        (lighting.maps[part.id]!.lights ?? []).forEach((l, i) =>
          add(`${part.id}:${i}`, ox + l.x, oy + l.y, l),
        );
      }
    }
    // Tile lights, at each matching tile's centre.
    if (map !== null && lighting.tiles !== undefined) {
      for (const p of this.tilePoints(map)) {
        const spec = lighting.tiles[p.tile]!;
        const cx = (p.col + 0.5) * map.tileSize + (spec.offset?.x ?? 0);
        const cy = (p.row + 0.5) * map.tileSize + (spec.offset?.y ?? 0);
        add(p.key, cx, cy, spec);
      }
    }
    // Entity lights by kind and state.
    if (lighting.kinds !== undefined) {
      for (const e of input.entities) {
        if (!Object.hasOwn(lighting.kinds, e.kind)) continue;
        const entry = lighting.kinds[e.kind]!;
        const list = 'radius' in entry ? [entry] : entry;
        list.forEach((spec, i) => {
          if (spec.states !== undefined && !spec.states.includes(e.anim.state)) return;
          const p = anchorPoint(e, spec.anchor ?? 'centre');
          add(`${e.id}:${i}`, p.x + (spec.offset?.x ?? 0), p.y + (spec.offset?.y ?? 0), spec);
        });
      }
    }
    // Event flashes, fading out over their ticks.
    for (const f of this.flashes) {
      const fade = (1 - (frame - f.start) / f.light.ticks) * reduce;
      add(f.key, f.x, f.y, f.light, fade);
    }

    const v = lighting.vignette;
    return {
      darkness: blendedDarkness(lighting, map, world),
      lights,
      vignette:
        v === undefined || v.strength <= 0
          ? null
          : {
              color: v.color ?? LIGHT_DEFAULTS.vignetteColor,
              strength: v.strength,
              inner: v.inner ?? LIGHT_DEFAULTS.vignetteInner,
            },
      bands: lighting.bands ?? 0,
      dither: lighting.dither ?? 0,
    };
  }

  /** Where the map's tiles with a light are (tiles, then layers), worked out once per map version. */
  private tilePoints(map: Map): { key: string; tile: string; col: number; row: number }[] {
    const c = this.tileCache;
    if (c !== null && c.id === map.id && c.version === map.version) return c.points;
    const known = this.spec?.tiles ?? {};
    const points: { key: string; tile: string; col: number; row: number }[] = [];
    const grids = [map.tiles, ...(map.layers ?? []).map((l) => l.tiles)];
    grids.forEach((grid, g) => {
      grid.forEach((line, row) => {
        for (let col = 0; col < line.length; col++) {
          const tile = String(line[col]);
          if (Object.hasOwn(known, tile)) points.push({ key: `tile:${g}:${col},${row}`, tile, col, row });
        }
      });
    });
    this.tileCache = { id: map.id, version: map.version, points };
    return points;
  }
}
