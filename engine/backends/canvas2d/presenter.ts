import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import { transformed, translucent, type Renderer } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import {
  cameraShake,
  cameraView,
  cameraZoom,
  CameraFollower,
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
  /**
   * Keep the camera inside the map; a map smaller than the picture is centred (default: the skin's
   * `camera.clamp`, else true).
   */
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

/**
 * Where world pixels land on the picture this frame: a world point (wx, wy) is drawn at
 * (`round(wx * zoom) - x`, `round(wy * zoom) - y`). `x`/`y` are the camera's top-left in picture
 * pixels (whole, shake included).
 */
interface View {
  x: number;
  y: number;
  zoom: number;
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
  /** Camera state (presentation only): never in a kit, a frame or a hash. */
  private readonly camera: CameraFollower;

  constructor(
    target: Renderer | Ctx,
    private readonly skin: Skin,
    private readonly sheet: SheetLookup,
    opts: SkinnedPresenterOptions = {},
  ) {
    this.r = isRenderer(target) ? target : new CanvasRenderer(target);
    this.opts = opts;
    this.size = opts.size;
    this.camera = new CameraFollower({ clamp: (opts.clamp ?? skin.camera?.clamp) !== false });
  }

  resize(size: ScreenSize): void {
    this.size = { width: size.width, height: size.height };
  }

  present(frame: Frame): void {
    const r = this.r;
    const size = this.size ?? frame.size;
    this.takeEvents(frame);
    this.updateMap(frame);
    const view = this.cameraView(frame, size);

    r.clear(this.opts.background ?? '#000');
    this.drawMap(view);
    for (const e of depthOrder(frame.entities)) this.drawEntity(e, view);
    this.drawEffects(frame.frame, view, size);
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
    const sizes = this.effects.filter((a) => a.effect.kind === 'shake').map((a) => a.effect.size ?? 2);
    return cameraShake(frame, sizes);
  }

  private drawEffects(tick: number, view: View, size: ScreenSize): void {
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
        const drawn = Math.max(1, Math.round(side * view.zoom));
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2;
          const px = a.x + Math.cos(angle) * age - side / 2;
          const py = a.y + Math.sin(angle) * age - side / 2;
          r.rect(
            Math.round(px * view.zoom) - view.x,
            Math.round(py * view.zoom) - view.y,
            drawn,
            drawn,
            color,
          );
        }
      }
    }
  }

  // ---- Camera ----

  /**
   * The zoom and the picture pixel at the top-left, with shake added (in picture pixels). The
   * framing (follow, deadzone, lerp, clamp) is `CameraFollower` in `@engine/core/present`, shared
   * with the 3D backend; it frames the zoomed view (`cameraView`: the picture size over `zoom`,
   * in world pixels), so clamping keeps that view inside the map.
   */
  private cameraView(frame: Frame, size: ScreenSize): View {
    const zoom = cameraZoom(frame, this.skin.camera);
    const map = this.mapVisible ? (this.shown?.map ?? null) : null;
    const cam = this.camera.update(frame, this.skin.camera, cameraView(size, zoom), map);
    return { x: Math.round(cam.x * zoom) + this.shake(frame), y: Math.round(cam.y * zoom), zoom };
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
      this.drawTiles(surface.renderer, map, { x: 0, y: 0, zoom: 1 });
      const frames = new Map([['map', { x: 0, y: 0, w, h }]]);
      cache = { id: `map:${map.id}@${map.version}`, image: surface.image, frames };
    }
    this.shown = { map, cache };
  }

  /** Copies the cached map (scaled by the zoom), or draws its tiles where there is no cache. */
  private drawMap(view: View): void {
    if (!this.shown || !this.mapVisible) return;
    const cache = this.shown.cache;
    if (!cache) this.drawTiles(this.r, this.shown.map, view);
    else if (view.zoom === 1) this.r.sprite(cache, 'map', -view.x, -view.y);
    else this.r.sprite(cache, 'map', -view.x, -view.y, false, false, 0, view.zoom);
  }

  /**
   * Draws the map's tiles and then its layers; a tile the skin does not list is left empty. Each
   * tile spans from its own corner to the next one's (both rounded), so tiles meet without gaps
   * at any zoom.
   */
  private drawTiles(r: Renderer, map: DeepReadonly<PresentMap>, view: View): void {
    const tiles = this.skin.tiles ?? {};
    const defaults = this.skin.sheets;
    const ts = map.tileSize;
    const { zoom } = view;
    const at = (n: number) => Math.round(n * ts * zoom);
    for (const grid of [map.tiles, ...(map.layers ?? []).map((l) => l.tiles)]) {
      for (let row = 0; row < grid.length; row++) {
        const line = grid[row]!;
        for (let col = 0; col < line.length; col++) {
          const key = String(line[col]);
          if (!Object.hasOwn(tiles, key)) continue;
          const entry = tiles[key]!;
          const x = at(col) - view.x;
          const y = at(row) - view.y;
          const sheetId = entry.sheet ?? defaults?.sheet;
          const sheet = sheetId === undefined ? null : this.sheet(sheetId, defaults?.palette);
          if (entry.frame !== undefined && sheet?.frames.has(entry.frame)) {
            if (zoom === 1) r.sprite(sheet, entry.frame, x, y);
            else r.sprite(sheet, entry.frame, x, y, false, false, 0, zoom);
          } else {
            const color = entry.fallbackColor ?? entry.color ?? defaults?.fallbackColor;
            if (color !== undefined) r.rect(x, y, at(col + 1) - view.x - x, at(row + 1) - view.y - y, color);
          }
        }
      }
    }
  }

  // ---- Entities ----

  private drawEntity(e: DeepReadonly<PresentEntity>, view: View): void {
    const r = this.r;
    const { zoom } = view;
    const sf = resolveSkinFrame(this.skin, e);
    const sheet = sf.sheet === null || sf.frame === null ? null : this.sheet(sf.sheet, sf.palette);
    const rect = sf.frame === null ? undefined : sheet?.frames.get(sf.frame);
    // The drawn size in picture pixels: the sprite's or box's size times the zoom.
    const scaled = (n: number) => (zoom === 1 ? n : Math.max(1, Math.round(n * zoom)));
    const w = scaled(rect?.w ?? sf.size?.w ?? e.w);
    const h = scaled(rect?.h ?? sf.size?.h ?? e.h);
    const x = Math.round((e.x + (sf.offset?.x ?? 0)) * zoom) - view.x;
    const y = Math.round((e.y + (sf.offset?.y ?? 0)) * zoom) - view.y;
    const draw = (to: Renderer, dx: number, dy: number) => {
      if (rect && sheet) {
        if (zoom === 1) to.sprite(sheet, sf.frame!, dx, dy, sf.flipX);
        else to.sprite(sheet, sf.frame!, dx, dy, sf.flipX, false, 0, zoom);
      } else to.rect(dx, dy, w, h, sf.fallbackColor);
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
