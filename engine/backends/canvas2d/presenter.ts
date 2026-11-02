import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import { transformed, translucent, type Renderer } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import {
  isFullMap,
  resolveSkinFrame,
  type DeepReadonly,
  type PresentEntity,
  type PresentFrame,
  type PresentMap,
  type Presenter,
  type SkinFile,
} from '@engine/core/present';
import { CanvasRenderer } from './renderer';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Skin = DeepReadonly<SkinFile>;
type Frame = DeepReadonly<PresentFrame>;
type Effect = NonNullable<NonNullable<SkinFile['events']>[string]['effect']>;

/** A surface the map is drawn onto once per version, then copied to the screen each frame. */
export interface MapSurface {
  /** Draws onto the surface. */
  renderer: Renderer;
  /** What the screen copies from (null in tests: the copy is still a recorded `sprite` call). */
  image: CanvasImageSource | null;
}

export interface SkinnedPresenterOptions {
  /** The picture size to frame the camera in; the frame's own `size` when left out. */
  size?: ScreenSize;
  /** Called once for each event this frame whose skin entry names a sound (wire it to the audio). */
  onSound?: (id: string) => void;
  /** The background colour, filled first each frame (default `#000`). */
  background?: string;
  /** The bitmap font for HUD numbers and text when an item names none (default `font`). */
  font?: string;
  /** Keep the camera inside the map; a map smaller than the picture is centred (default true). */
  clamp?: boolean;
  /** Skip `flash` effects (the player's reduced-flashing setting). */
  reduceFlashing?: boolean;
  /**
   * Makes a surface for the cached map, or null to draw the tiles every frame. The default makes
   * an offscreen canvas where the browser has one, and is null in Node.
   */
  mapSurface?: (width: number, height: number) => MapSurface | null;
}

/** Ticks an effect lasts when the skin gives none. */
const EFFECT_TICKS: Record<Effect['kind'], number> = { flash: 2, particles: 12, shake: 8, tint: 6 };

const EMPTY_FONT: SpriteSheet = { id: 'missing-font', image: null, frames: new Map() };

/** One event effect still showing: where it is (world pixels) and the frame it began on. */
interface ActiveEffect {
  effect: DeepReadonly<Effect>;
  x: number;
  y: number;
  start: number;
}

/** The map being shown and its cached drawing. */
interface ShownMap {
  map: DeepReadonly<PresentMap>;
  /** The cached picture, or null when the tiles are drawn every frame. */
  cache: SpriteSheet | null;
}

function isRenderer(target: Renderer | Ctx): target is Renderer {
  return typeof (target as Partial<Renderer>).sprite === 'function';
}

/** The default map surface: an offscreen canvas where there is one, else none. */
function defaultMapSurface(width: number, height: number): MapSurface | null {
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(width, height);
  else if (typeof document !== 'undefined') {
    canvas = Object.assign(document.createElement('canvas'), { width, height });
  } else return null;
  const ctx = canvas.getContext('2d') as Ctx | null;
  return ctx ? { renderer: new CanvasRenderer(ctx), image: canvas } : null;
}

/**
 * The Canvas2D backend's `Presenter`: draws any `PresentFrame` through a skin. Each frame it fills
 * the background, frames the camera, copies the map (drawn once per map id and version), draws the
 * entities by `layer`, then list order, starts and draws event effects, and draws the HUD
 * from `frame.status`. Sounds go to `onSound`; nothing here plays audio or knows a game or kit.
 * It never changes the frame or the skin.
 */
export class SkinnedCanvasPresenter implements Presenter {
  private readonly r: Renderer;
  private readonly opts: SkinnedPresenterOptions;
  private size: ScreenSize | undefined;
  private shown: ShownMap | null = null;
  /** False on a frame with no `map`: nothing is drawn, but the cache is kept for a later reference. */
  private mapVisible = false;
  private effects: ActiveEffect[] = [];
  /** The last frame whose events were handled, so a frame shown twice plays its sounds once. */
  private lastEvents: number | null = null;
  /** Camera state (presentation only): the top-left in whole world pixels, without shake. */
  private cam: { x: number; y: number } | null = null;
  /** The frame number and map id the camera was last framed for. */
  private camFrame: number | null = null;
  private camMap: string | null = null;

  constructor(
    target: Renderer | Ctx,
    private readonly skin: Skin,
    private readonly sheet: SheetLookup,
    opts: SkinnedPresenterOptions = {},
  ) {
    this.r = isRenderer(target) ? target : new CanvasRenderer(target);
    this.opts = opts;
    this.size = opts.size;
  }

  resize(size: ScreenSize): void {
    this.size = { width: size.width, height: size.height };
  }

  present(frame: Frame): void {
    const r = this.r;
    const size = this.size ?? frame.size;
    this.takeEvents(frame);
    this.updateMap(frame);
    const cam = this.cameraOffset(frame, size);

    r.clear(this.opts.background ?? '#000');
    this.drawMap(cam.x, cam.y);
    for (const e of depthOrder(frame.entities)) this.drawEntity(e, cam.x, cam.y);
    this.drawEffects(frame.frame, cam.x, cam.y, size);
    this.drawHud(frame);
  }

  // ---- Events ----

  private takeEvents(frame: Frame): void {
    this.effects = this.effects.filter((a) => {
      const age = frame.frame - a.start;
      return age >= 0 && age < (a.effect.ticks ?? EFFECT_TICKS[a.effect.kind]);
    });
    if (this.lastEvents === frame.frame) return;
    this.lastEvents = frame.frame;
    const events = this.skin.events ?? {};
    for (const ev of frame.events) {
      if (!Object.hasOwn(events, ev.type)) continue;
      const entry = events[ev.type]!;
      if (entry.sound !== undefined) this.opts.onSound?.(entry.sound);
      if (entry.effect === undefined) continue;
      const at = ev.entity === undefined ? undefined : frame.entities.find((e) => e.id === ev.entity);
      const x = ev.x ?? (at ? at.x + at.w / 2 : 0);
      const y = ev.y ?? (at ? at.y + at.h / 2 : 0);
      this.effects.push({ effect: entry.effect, x, y, start: frame.frame });
    }
  }

  /** Shake from the frame's camera hint and from shake effects, as a whole-pixel offset. */
  private shake(frame: Frame): number {
    let strength = frame.camera?.shake ?? 0;
    for (const a of this.effects) if (a.effect.kind === 'shake') strength += a.effect.size ?? 2;
    if (strength <= 0) return 0;
    return Math.round(strength) * (frame.frame % 2 === 0 ? 1 : -1);
  }

  private drawEffects(tick: number, camX: number, camY: number, size: ScreenSize): void {
    const r = this.r;
    for (const a of this.effects) {
      const { effect } = a;
      const ticks = effect.ticks ?? EFFECT_TICKS[effect.kind];
      const color = effect.color ?? '#fcfcfc';
      const age = tick - a.start;
      if (effect.kind === 'flash') {
        if (!this.opts.reduceFlashing) r.rect(0, 0, size.width, size.height, color);
      } else if (effect.kind === 'tint') {
        translucent(r, 0.4 * (1 - age / ticks), () => r.rect(0, 0, size.width, size.height, color));
      } else if (effect.kind === 'particles') {
        const count = effect.count ?? 6;
        const side = Math.max(1, Math.round(effect.size ?? 2));
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2;
          const px = a.x + Math.cos(angle) * age - camX - side / 2;
          const py = a.y + Math.sin(angle) * age - camY - side / 2;
          r.rect(Math.round(px), Math.round(py), side, side, color);
        }
      }
    }
  }

  // ---- Camera ----

  /**
   * The world pixel at the picture's top-left, with shake added. See `frameCamera` for the
   * framing; a frame shown twice (the same `frame` number) does not move the camera again.
   */
  private cameraOffset(frame: Frame, size: ScreenSize): { x: number; y: number } {
    if (this.cam === null || this.camFrame !== frame.frame) {
      this.cam = this.frameCamera(frame, size);
      this.camFrame = frame.frame;
    }
    return { x: this.cam.x + this.shake(frame), y: this.cam.y };
  }

  /**
   * One frame of camera framing, in whole pixels (top-left of the picture).
   *
   * - Target: the hint's `follow` entity (by id) when it is in the frame, else the hint's `x`/`y`,
   *   else the skin's `camera.follow` (an entity id, else a kind), else none (the map's top-left).
   *   An entity's target point is its box centre.
   * - `deadzone` and `lerp`: the hint's own, else the skin's, else none (0x0) and 1.
   * - Deadzone: a `w` x `h` box round the picture's centre the target moves in without
   *   scrolling; past its edge the camera moves just enough to put the target back on the edge.
   * - Lerp: the camera closes `lerp` of the gap to that position each frame, in whole pixels and
   *   1/256 fixed point (at least 1 px while there is a gap, so it always arrives); 1 snaps, 0
   *   holds still. The first frame, a new map id and a frame with no target always snap.
   * - Clamp (unless `clamp` is false): the view stays inside the hint's `bounds`, else the map;
   *   an area smaller than the picture is centred on that axis.
   */
  private frameCamera(frame: Frame, size: ScreenSize): { x: number; y: number } {
    const hint = frame.camera;
    const skinCam = this.skin.camera;
    const center = this.cameraTarget(frame);
    const mapId = this.mapVisible ? (this.shown?.map.id ?? null) : null;
    const prev = this.cam;
    const snap = prev === null || center === null || mapId !== this.camMap;
    this.camMap = mapId;

    const deadzone = hint?.deadzone ?? skinCam?.deadzone ?? { w: 0, h: 0 };
    const lerp = lerpStep(hint?.lerp ?? skinCam?.lerp ?? 1);
    const area = this.clampArea(frame);
    const axis = (
      target: number | undefined,
      from: number | undefined,
      view: number,
      dz: number,
      start: number,
      extent: number,
    ) => {
      // The camera that would centre the target, then the deadzone's pull on it.
      let want = target === undefined ? 0 : Math.round(target - view / 2);
      if (!snap && from !== undefined && target !== undefined) {
        const offset = target - view / 2 - from;
        const half = dz / 2;
        if (offset > half) want = Math.round(target - view / 2 - half);
        else if (offset < -half) want = Math.round(target - view / 2 + half);
        else want = from;
      }
      if (area) want = clampAxis(want, start, extent, view);
      let at = snap || from === undefined ? want : approach(from, want, lerp);
      if (area) at = clampAxis(at, start, extent, view);
      return at;
    };
    return {
      x: axis(center?.x, prev?.x, size.width, deadzone.w, area?.x ?? 0, area?.w ?? 0),
      y: axis(center?.y, prev?.y, size.height, deadzone.h, area?.y ?? 0, area?.h ?? 0),
    };
  }

  /** The world point to keep in view (see `frameCamera`), or null when there is none. */
  private cameraTarget(frame: Frame): { x: number; y: number } | null {
    const centre = (e: DeepReadonly<PresentEntity>) => ({ x: e.x + e.w / 2, y: e.y + e.h / 2 });
    const hint = frame.camera;
    if (hint) {
      const followed =
        hint.follow === undefined ? undefined : frame.entities.find((e) => e.id === hint.follow);
      return followed ? centre(followed) : { x: hint.x, y: hint.y };
    }
    const follow = this.skin.camera?.follow;
    if (follow === undefined) return null;
    const target =
      frame.entities.find((e) => e.id === follow) ?? frame.entities.find((e) => e.kind === follow);
    return target ? centre(target) : null;
  }

  /** The world box the view is kept inside, or null when nothing clamps it. */
  private clampArea(frame: Frame): { x: number; y: number; w: number; h: number } | null {
    if (this.opts.clamp === false) return null;
    const bounds = frame.camera?.bounds;
    if (bounds) return { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
    const map = this.mapVisible ? this.shown?.map : undefined;
    return map ? { x: 0, y: 0, w: map.cols * map.tileSize, h: map.rows * map.tileSize } : null;
  }

  // ---- Map ----

  /** Keeps the full map last sent, and redraws its cache when the id or version changes. */
  private updateMap(frame: Frame): void {
    const map = frame.map;
    this.mapVisible = map !== undefined;
    if (map === undefined) return;
    const same = this.shown && this.shown.map.id === map.id && this.shown.map.version === map.version;
    if (same) return;
    if (!isFullMap(map)) {
      // A reference to a map never sent: nothing to draw until it comes.
      this.shown = null;
      return;
    }
    const w = map.cols * map.tileSize;
    const h = map.rows * map.tileSize;
    const surface = (this.opts.mapSurface ?? defaultMapSurface)(w, h);
    let cache: SpriteSheet | null = null;
    if (surface) {
      this.drawTiles(surface.renderer, map, 0, 0);
      const frames = new Map([['map', { x: 0, y: 0, w, h }]]);
      cache = { id: `map:${map.id}@${map.version}`, image: surface.image, frames };
    }
    this.shown = { map, cache };
  }

  private drawMap(camX: number, camY: number): void {
    if (!this.shown || !this.mapVisible) return;
    if (this.shown.cache) this.r.sprite(this.shown.cache, 'map', -camX, -camY);
    else this.drawTiles(this.r, this.shown.map, camX, camY);
  }

  /** Draws the map's tiles and then its layers; a tile the skin does not list is left empty. */
  private drawTiles(r: Renderer, map: DeepReadonly<PresentMap>, camX: number, camY: number): void {
    const tiles = this.skin.tiles ?? {};
    const defaults = this.skin.sheets;
    const ts = map.tileSize;
    for (const grid of [map.tiles, ...(map.layers ?? []).map((l) => l.tiles)]) {
      for (let row = 0; row < grid.length; row++) {
        const line = grid[row]!;
        for (let col = 0; col < line.length; col++) {
          const key = String(line[col]);
          if (!Object.hasOwn(tiles, key)) continue;
          const entry = tiles[key]!;
          const x = col * ts - camX;
          const y = row * ts - camY;
          const sheetId = entry.sheet ?? defaults?.sheet;
          const sheet = sheetId === undefined ? null : this.sheet(sheetId, defaults?.palette);
          if (entry.frame !== undefined && sheet?.frames.has(entry.frame)) r.sprite(sheet, entry.frame, x, y);
          else {
            const color = entry.fallbackColor ?? entry.color ?? defaults?.fallbackColor;
            if (color !== undefined) r.rect(x, y, ts, ts, color);
          }
        }
      }
    }
  }

  // ---- Entities ----

  private drawEntity(e: DeepReadonly<PresentEntity>, camX: number, camY: number): void {
    const r = this.r;
    const sf = resolveSkinFrame(this.skin, e);
    const sheet = sf.sheet === null || sf.frame === null ? null : this.sheet(sf.sheet, sf.palette);
    const rect = sf.frame === null ? undefined : sheet?.frames.get(sf.frame);
    const w = rect?.w ?? sf.size?.w ?? e.w;
    const h = rect?.h ?? sf.size?.h ?? e.h;
    const x = Math.round(e.x + (sf.offset?.x ?? 0) - camX);
    const y = Math.round(e.y + (sf.offset?.y ?? 0) - camY);
    const draw = (to: Renderer, dx: number, dy: number) => {
      if (rect && sheet) to.sprite(sheet, sf.frame!, dx, dy, sf.flipX);
      else to.rect(dx, dy, w, h, sf.fallbackColor);
    };
    const fx = e.fx;
    const sx = fx?.squashX ?? 1;
    const sy = fx?.squashY ?? 1;
    const turn = fx?.rotate ?? 0;
    const body = () => {
      // Squash, stretch and turns pivot on the bottom centre, so feet stay on the ground.
      if (sx !== 1 || sy !== 1 || turn !== 0) {
        transformed(r, x + w / 2, y + h, (turn * Math.PI) / 180, sx, sy, (l) => draw(l, -w / 2, -h));
      } else draw(r, x, y);
    };
    translucent(r, fx?.alpha ?? 1, body);
  }

  // ---- HUD ----

  private drawHud(frame: Frame): void {
    const r = this.r;
    const defaults = this.skin.sheets;
    for (const item of this.skin.hud ?? []) {
      if (!Object.hasOwn(frame.status, item.status)) continue;
      const value = frame.status[item.status]!;
      if (item.as === 'number' || item.as === 'text') {
        const font = this.sheet(item.font ?? this.opts.font ?? 'font') ?? EMPTY_FONT;
        r.text(font, String(value), item.x, item.y);
        continue;
      }
      const count =
        item.as === 'hearts'
          ? typeof value === 'number'
            ? Math.max(0, Math.floor(value))
            : 0
          : value
            ? 1
            : 0;
      const sheetId = item.sheet ?? defaults?.sheet;
      const sheet = sheetId === undefined ? null : this.sheet(sheetId, defaults?.palette);
      const rect = item.frame === undefined ? undefined : sheet?.frames.get(item.frame);
      const step = (rect?.w ?? 8) + 1;
      for (let i = 0; i < count; i++) {
        if (rect && sheet) r.sprite(sheet, item.frame!, item.x + i * step, item.y);
        else r.rect(item.x + i * step, item.y, 8, 8, defaults?.fallbackColor ?? '#ff00ff');
      }
    }
  }
}

/** Entities by `layer` (0 when absent), keeping list order on ties (a stable sort), as `PresentFrame` says. */
function depthOrder(entities: readonly DeepReadonly<PresentEntity>[]): DeepReadonly<PresentEntity>[] {
  return [...entities].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));
}

/**
 * The whole-pixel top-left on one axis that keeps a `view`-wide picture inside the area from
 * `start`, `extent` wide; an area narrower than the picture is centred.
 */
function clampAxis(at: number, start: number, extent: number, view: number): number {
  if (extent <= view) return Math.round(start + (extent - view) / 2);
  return Math.min(Math.max(at, Math.ceil(start)), Math.floor(start + extent - view));
}

/** Lerp as a fraction of 256 (fixed point): 256 snaps, 0 holds; any positive lerp moves. */
function lerpStep(lerp: number): number {
  if (lerp >= 1) return 256;
  if (lerp <= 0) return 0;
  return Math.max(1, Math.round(lerp * 256));
}

/** One frame of lerp from `from` to `to` (whole pixels): `step`/256 of the gap, at least 1 px. */
function approach(from: number, to: number, step: number): number {
  const gap = to - from;
  if (gap === 0 || step >= 256) return to;
  if (step === 0) return from;
  const move = Math.trunc((gap * step) / 256);
  return from + (move === 0 ? Math.sign(gap) : move);
}
