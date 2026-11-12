import type { SheetLookup } from '../assets/sheet-lookup';
import {
  CameraFx,
  layoutParallax,
  lightDither,
  lightStops,
  REST_STATE,
  SkinLighting,
  SkinParticles,
  TweenSet,
  type CameraFxSettings,
  type CameraFxState,
  type LightingLayout,
  type ParticleView,
  type TweenState,
} from '../fx';
import { blended, glowing, radialFilled, transformed, translucent, type Renderer } from '../gfx/renderer';
import type { ScreenSize } from '../gfx/screen';
import { anchorOffset, type SpriteSheet } from '../gfx/spritesheet';
import {
  cameraArea,
  cameraShake,
  cameraTarget,
  cameraView,
  cameraZoom,
  CameraFollower,
  fogBoxes,
  resolveFogLook,
  FrameEventClock,
  isFullMap,
  layoutHud,
  resolveSkinEvent,
  resolveSkinFrame,
  resolveSkinKind,
  resolveTileFrame,
  skinBackground,
  skinLabels,
  themedSkin,
  type DeepReadonly,
  type HudFrameSize,
  type PresentBox,
  type PresentEntity,
  type PresentEvent,
  type PresentFrame,
  type PresentMap,
  type Presenter,
  type SkinFile,
  zoomAbout,
  screenScaleAt,
  screenScalePivot,
  skinOutlineColor,
  skinTeamColor,
  skinSoundCue,
  type SoundCue,
  projectileFlight,
  projectilePlace,
  PROJECTILE_DEFAULT_COLOR,
  PROJECTILE_DEFAULT_SIZE,
  PROJECTILE_MAX,
  type SkinProjectile,
} from '../present';
import { layoutLabels, paintUi, SkinHud, type FontLookup, type UiDraw } from '../ui';
import { RecolorCache, type ImageRecolor, type RecolorSpec } from './recolor';
import type { MapSurface, SurfaceFactory } from './surface';
import { RendererUiPainter, type GlyphTint } from './ui-painter';

type Skin = DeepReadonly<SkinFile>;
type Frame = DeepReadonly<PresentFrame>;
type Effect = NonNullable<NonNullable<SkinFile['events']>[string]['effect']>;

export interface SkinnedPresenterOptions {
  /** The picture size to frame the camera in; the frame's own `size` when left out. */
  size?: ScreenSize;
  /** Called once for each event this frame whose skin entry names a sound (wire it to the audio). */
  onSound?: (id: string, cue?: SoundCue) => void;
  /**
   * The background colour, filled first each frame, when it is not the skin's (default the skin's
   * `background`, else `#000`: `skinBackground`, gap G36).
   */
  background?: string;
  /** The bitmap font for HUD numbers and text when an item names none (default `font`). */
  font?: string;
  /**
   * The game's `font` content files (`contentFonts(content)`, `@engine/core/ui`; Engine 0.16 T6),
   * for HUD text in a font file and the UI kit's widgets.
   */
  fonts?: FontLookup;
  /**
   * Makes a surface for one font's glyphs in one colour (default none: each glyph's ink runs are
   * drawn as boxes; Canvas2D's `SkinnedCanvasPresenter` passes an offscreen canvas).
   */
  glyphSurface?: SurfaceFactory;
  /**
   * Tints one white strip per font instead of drawing a strip per colour (the UI painter's
   * `tintGlyphs`; Engine 0.16 T13b: the PixiJS presenter passes its sprite tint). Default none.
   */
  tintGlyphs?: GlyphTint;
  /**
   * Keep the camera inside the map; a map smaller than the picture is centred (default: the skin's
   * `camera.clamp`, else true).
   */
  clamp?: boolean;
  /**
   * The player's reduced-flashing setting: skip `flash` effects and event `flash`es, and draw
   * additive (bright) particles with normal blending, half as strong and without glow.
   */
  reduceFlashing?: boolean;
  /** The player's screen-shake setting, 0 (no shake) to 1 (full, the default). */
  shakeScale?: number;
  /** Keep trauma-shake offsets fractional (default false: whole picture px, for pixel art). */
  subPixelShake?: boolean;
  /**
   * Called once for each event this frame whose skin entry asks for a `hitPause`, with its ticks
   * (wire it to the browser shell's `hitPause`, which holds the game's ticks; Engine 0.16 T4).
   */
  onHitPause?: (ticks: number) => void;
  /** The seed particles draw from (`fxRng`; default 0). Any seed gives the same picture each time. */
  seed?: number;
  /**
   * The most live particles at once across every emitter (default `PARTICLE_SYSTEM_MAX`, 1024,
   * from `@engine/core/fx`; Engine 0.16 T13, for a scene that needs more, such as the feature
   * benchmark's 2000+). A spawn over it is skipped.
   */
  maxParticles?: number;
  /**
   * Makes a surface for the cached map, or null to draw the tiles every frame (default none, so
   * tiles are drawn every frame; Canvas2D's `SkinnedCanvasPresenter` passes an offscreen canvas
   * where the browser has one).
   */
  mapSurface?: SurfaceFactory;
  /**
   * Makes the picture-sized surface the skin's `lighting` darkness is drawn on (the light map,
   * Engine 0.16 part C T4), or null for none: the darkness is then a flat translucent box and the
   * lights only glow. Default none; Canvas2D's `SkinnedCanvasPresenter` passes an offscreen canvas
   * where the browser has one (null in Node).
   */
  lightSurface?: SurfaceFactory;
  /**
   * Makes a recoloured copy of a sheet image, for a kind's `outline` (its silhouette) and `team`
   * colour (Engine 0.16 part D, D4); each sheet and colour is recoloured once and kept. Default
   * none: sprites are drawn without outline or team colour (boxes still get both). Both 2D
   * backends pass `canvasRecolor` (`@engine/core/assets/canvas-recolor`).
   */
  recolor?: ImageRecolor;
}

/** Where an outline's silhouette is drawn round a sprite: one picture pixel each way. */
const OUTLINE_STEPS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

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

/** A projectile in flight (Engine 0.16 E6): its look, its flight in world px and its event's frame. */
interface Flight {
  look: DeepReadonly<SkinProjectile>;
  from: { x: number; y: number };
  to: { x: number; y: number };
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

/**
 * The skinned `Presenter` every 2D backend draws through (Engine 0.16 T13b: moved out of Canvas2D's
 * `SkinnedCanvasPresenter`, so the PixiJS presenter draws every feature through the same code):
 * draws any `PresentFrame` through a skin onto a core `Renderer`. Each frame it fills the
 * background (the skin's `background`, unless the `background` option overrides it), frames the
 * camera, draws the parallax, copies the map (drawn once per map id and version onto a
 * `mapSurface`, or tiles every frame without one), draws the entities by `layer`, then list order,
 * the particles, starts and draws event effects and camera flashes, and draws the HUD from
 * `frame.status`. Sounds go to `onSound`; nothing here plays audio or knows a game, kit or backend.
 * It never changes the frame or the skin.
 */
export class SkinnedPresenter implements Presenter {
  private readonly r: Renderer;
  private readonly opts: SkinnedPresenterOptions;
  private size: ScreenSize | undefined;
  /** The size of the frame being drawn (the picture when no `size` option or `resize` gives one). */
  private frameSize: ScreenSize = { width: 0, height: 0 };
  private shown: ShownMap | null = null;
  /** The skin as each map id shows it (`look`). */
  private readonly looks = new Map<string, Skin>();
  /** False on a frame with no `map`: nothing is drawn, but the cache is kept for a later reference. */
  private mapVisible = false;
  private effects: ActiveEffect[] = [];
  /** Projectiles in flight (Engine 0.16 E6), in the order their events came. */
  private flights: Flight[] = [];
  /** The last frame whose events were handled, so a frame shown twice plays its sounds once. */
  private lastEvents: number | null = null;
  /** Camera state (presentation only): never in a kit, a frame or a hash. */
  private readonly camera: CameraFollower;
  /** Running tweens by entity id (skin `events.<type>.tween` and `kinds.<kind>.spawnTween`). */
  private readonly tweens = new Map<string, TweenSet>();
  /** The entity ids the last frame showed, so a new one gets its kind's `spawnTween`. */
  private seen = new Set<string>();
  /** The last frame number presented: a lower one is a new level (tweens start over). */
  private lastFrame: number | null = null;
  /** Frame events of the skin's cycles (`events: { "<frame>": "<type>" }`), presenter state only. */
  private readonly frameEvents = new FrameEventClock();
  /** The skin's particles (`emitters`, events' `emit`, kinds' `emit`, old `particles` effects). */
  private readonly particles: SkinParticles;
  /** Camera effects from events' `shake`, `zoom` and `flash` (Engine 0.16 T4). */
  private readonly cameraFx: CameraFx;
  /** The player's flashing and shake settings (`effectSettings` changes them). */
  private settings: CameraFxSettings;
  /**
   * The camera effects' clock: one tick per `present` call, so shakes, zoom punches and flashes
   * go on while the frame number stands still (a hit-pause, the pause between levels).
   */
  private fxClock = -1;
  /** Where the camera's target (the followed entity) was on the picture last frame (T5's iris). */
  private focusPoint: { x: number; y: number } | null = null;
  /** The skin's HUD through the UI kit (Engine 0.16 T6), used when it has a UI item. */
  private readonly hud: SkinHud;
  private readonly uiPainter: RendererUiPainter;
  /** Whether the HUD is drawn (`showHud`; the shell hides it under the title). */
  private hudShown = true;
  /** The skin's `lighting` (Engine 0.16 part C T4): darkness, lights, flicker, vignette. */
  private readonly lighting: SkinLighting;
  /** The skin's `fog` look, defaults filled (Engine 0.16 part D, D3). */
  private readonly fogLook: ReturnType<typeof resolveFogLook>;
  /** The world box the picture showed this frame (shake aside), for a minimap's `view`. */
  private viewBox: PresentBox | null = null;
  /** The light map's surface and its size (made on the first lit frame, again on a resize). */
  private lightMap: { surface: MapSurface | null; w: number; h: number } | null = null;
  /** Sheets recoloured for outlines and team colours, once per sheet and colour (D4). */
  private readonly recolored: RecolorCache;

  constructor(
    target: Renderer,
    private readonly skin: Skin,
    private readonly sheet: SheetLookup,
    opts: SkinnedPresenterOptions = {},
  ) {
    this.r = target;
    this.opts = opts;
    this.size = opts.size;
    this.camera = new CameraFollower({ clamp: (opts.clamp ?? skin.camera?.clamp) !== false });
    this.particles = new SkinParticles(skin, {
      ...(opts.seed !== undefined && { seed: opts.seed }),
      ...(opts.maxParticles !== undefined && { max: opts.maxParticles }),
    });
    this.cameraFx = new CameraFx({
      ...(opts.seed !== undefined && { seed: opts.seed }),
      ...(opts.subPixelShake !== undefined && { subPixel: opts.subPixelShake }),
    });
    this.settings = {
      ...(opts.reduceFlashing !== undefined && { reduceFlashing: opts.reduceFlashing }),
      ...(opts.shakeScale !== undefined && { shakeScale: opts.shakeScale }),
    };
    this.lighting = new SkinLighting(skin, opts.seed !== undefined ? { seed: opts.seed } : {});
    this.fogLook = resolveFogLook(skin.fog);
    this.recolored = new RecolorCache(opts.recolor);
    this.hud = new SkinHud(skin, {
      ...(opts.fonts !== undefined && { fonts: opts.fonts }),
      ...(opts.font !== undefined && { font: opts.font }),
    });
    this.uiPainter = new RendererUiPainter(this.r, sheet, opts.fonts, {
      ...(opts.glyphSurface !== undefined && { glyphSurface: opts.glyphSurface }),
      ...(opts.tintGlyphs !== undefined && { tintGlyphs: opts.tintGlyphs }),
    });
  }

  resize(size: ScreenSize): void {
    this.size = { width: size.width, height: size.height };
  }

  /**
   * Changes the player's presentation settings from the next frame (a settings screen): reduced
   * flashing and the shake scale. Fields left out keep their value.
   */
  effectSettings(settings: CameraFxSettings): void {
    this.settings = { ...this.settings, ...settings };
  }

  /**
   * Whether the skin's HUD is drawn from the next frame (Engine 0.16 part C T1: the shell hides it
   * while the title, or a screen opened from it, shows over the waiting game).
   */
  showHud(shown: boolean): void {
    this.hudShown = shown;
  }

  /** How many particles are alive now (after the last `present`; Engine 0.16 T13). */
  get particleCount(): number {
    return this.particles.system.count;
  }

  /**
   * The camera's target (the followed entity's centre, else the hint's point) on the picture as
   * the last frame drew it, in picture px (zoom and shake included), or null (Engine 0.16 T5: the
   * point an iris transition closes on).
   */
  focus(): { x: number; y: number } | null {
    return this.focusPoint === null ? null : { ...this.focusPoint };
  }

  present(frame: Frame): void {
    const r = this.r;
    const size = this.size ?? frame.size;
    this.frameSize = frame.size;
    this.fxClock++;
    this.restartOnNewLevel(frame);
    this.takeEvents(frame);
    this.landProjectiles(frame);
    this.particles.update(frame.frame, frame.entities, this.shownMap(frame));
    this.updateTweens(frame);
    this.updateMap(frame);
    this.cameraFx.update(this.fxClock);
    const fx = this.cameraFx.state(this.fxClock, this.settings);
    const view = this.cameraView(frame, size, fx);
    const target = cameraTarget(frame, this.skin.camera);
    this.focusPoint =
      target === null
        ? null
        : { x: Math.round(target.x * view.zoom) - view.x, y: Math.round(target.y * view.zoom) - view.y };

    // The shown map's look (a skin's `themes`, Engine 0.16 part B T7): its sky and parallax.
    const look = this.look(this.shown?.map.id ?? frame.map?.id);
    r.clear(this.opts.background ?? skinBackground(look));
    this.drawParallax(look, view, size);
    this.drawMap(view);
    this.drawLightProps(view, frame.frame);
    for (const e of depthOrder(frame.entities)) this.drawEntity(e, view, frame.frame);
    this.drawProjectiles(view, frame.frame);
    this.drawParticles(view);
    // The light map darkens the world; the world labels go over it, readable in the dark.
    this.drawLighting(frame, view, size);
    this.drawLabels(frame, view, size);
    // Fog of war (part D) covers the world and its labels, so nothing unseen is named.
    this.drawFog(frame, view, size);
    this.drawEffects(frame.frame, size);
    for (const f of fx.flashes) translucent(r, f.alpha, () => r.rect(0, 0, size.width, size.height, f.color));
    if (this.hudShown) this.drawHud(frame);
  }

  // ---- Events ----

  private takeEvents(frame: Frame): void {
    this.effects = this.effects.filter((a) => {
      const age = frame.frame - a.start;
      return age >= 0 && age < (a.effect.ticks ?? EFFECT_TICKS[a.effect.kind]);
    });
    if (this.lastEvents === frame.frame) return;
    this.lastEvents = frame.frame;
    // The frame's events, then the skin's frame events (a footstep on a run cycle's frame),
    // which run through the same `events` entries but never go into the frame.
    for (const ev of [...frame.events, ...this.frameEvents.next(this.skin, frame.entities)]) {
      this.lighting.event(ev, frame.entities, frame.frame);
      const entry = resolveSkinEvent(this.skin.events, ev);
      if (entry === undefined) continue;
      if (entry.sound !== undefined) this.opts.onSound?.(entry.sound, skinSoundCue(entry, frame.frame));
      if (entry.hitPause !== undefined) this.opts.onHitPause?.(entry.hitPause.ticks);
      if (entry.tween !== undefined && ev.entity !== undefined)
        this.tweensOf(ev.entity).add(entry.tween, frame.frame);
      this.particles.event(entry, ev, frame.entities, frame.frame);
      this.cameraFx.event(entry, this.fxClock);
      if (entry.projectile !== undefined) this.launch(entry.projectile, ev, frame.frame);
      if (entry.effect === undefined || entry.effect.kind === 'particles') continue;
      const at = ev.entity === undefined ? undefined : frame.entities.find((e) => e.id === ev.entity);
      const x = ev.x ?? (at ? at.x + at.w / 2 : 0);
      const y = ev.y ?? (at ? at.y + at.h / 2 : 0);
      this.effects.push({ effect: entry.effect, x, y, start: frame.frame });
    }
  }

  // ---- Projectiles (Engine 0.16 E6) ----

  /**
   * Starts a projectile for an event: in flight from the event's `fromX`/`fromY` to its `x`/`y`
   * from this frame, or, with no flight to show (no points, or `PROJECTILE_MAX` in the air), its
   * impact at once at the event's `x`/`y`.
   */
  private launch(look: DeepReadonly<SkinProjectile>, ev: DeepReadonly<PresentEvent>, frame: number): void {
    const flight = projectileFlight(ev);
    if (flight !== null && this.flights.length < PROJECTILE_MAX) {
      this.flights.push({ look, ...flight, start: frame });
      return;
    }
    const x = typeof ev.x === 'number' ? ev.x : flight?.to.x;
    const y = typeof ev.y === 'number' ? ev.y : flight?.to.y;
    if (x !== undefined && y !== undefined) this.impact(look, x, y, frame);
  }

  /**
   * Lands every projectile whose flight is over by this frame (`ticks` frames after its event; a
   * frame skipped past it lands it all the same), each once: its impact's emitters where it
   * lands, its sound and its shake. A frame number that went back (a new level) drops them all.
   */
  private landProjectiles(frame: Frame): void {
    const flying: Flight[] = [];
    for (const f of this.flights) {
      const age = frame.frame - f.start;
      if (age < 0) continue;
      if (age >= f.look.ticks) this.impact(f.look, f.to.x, f.to.y, frame.frame);
      else flying.push(f);
    }
    this.flights = flying;
  }

  private impact(look: DeepReadonly<SkinProjectile>, x: number, y: number, frame: number): void {
    const hit = look.impact;
    if (hit === undefined) return;
    if (hit.sound !== undefined) this.opts.onSound?.(hit.sound, { frame });
    if (hit.emit !== undefined) this.particles.event({ emit: hit.emit }, { type: 'impact', x, y }, [], frame);
    if (hit.shake !== undefined) this.cameraFx.shake(hit.shake, this.fxClock);
  }

  /**
   * The projectiles in flight (after the entities, under the particles): each one's frame centred
   * on its place at the zoom, turned to the way it flies with `turn`, or a square of `size` world
   * px in its `color` (also when its sheet lacks the frame).
   */
  private drawProjectiles(view: View, tick: number): void {
    const r = this.r;
    const { zoom } = view;
    for (const f of this.flights) {
      const at = projectilePlace(f.look, f.from, f.to, tick - f.start);
      if (at === null) continue;
      const cx = Math.round(at.x * zoom) - view.x;
      const cy = Math.round(at.y * zoom) - view.y;
      const look = f.look;
      const id = look.frame === undefined ? undefined : (look.sheet ?? this.skin.sheets?.sheet);
      const sheet = id === undefined ? null : this.sheet(id, look.palette ?? this.skin.sheets?.palette);
      const rect = look.frame === undefined ? undefined : sheet?.frames.get(look.frame);
      if (sheet && rect) {
        const w = Math.max(1, Math.round(rect.w * zoom));
        const h = Math.max(1, Math.round(rect.h * zoom));
        const draw = (to: Renderer, x: number, y: number) =>
          zoom === 1
            ? to.sprite(sheet, look.frame!, x, y)
            : to.sprite(sheet, look.frame!, x, y, false, false, 0, zoom);
        const angle = Math.round(at.angle);
        if (look.turn === true && angle !== 0)
          transformed(r, cx, cy, (angle * Math.PI) / 180, 1, 1, (l) =>
            draw(l, -Math.floor(w / 2), -Math.floor(h / 2)),
          );
        else draw(r, cx - Math.floor(w / 2), cy - Math.floor(h / 2));
        continue;
      }
      const side = Math.max(1, Math.round((look.size ?? PROJECTILE_DEFAULT_SIZE) * zoom));
      const half = Math.floor(side / 2);
      r.rect(cx - half, cy - half, side, side, look.color ?? PROJECTILE_DEFAULT_COLOR);
    }
  }

  /** How many projectiles are in flight (for tests and the fx lab). */
  get projectileCount(): number {
    return this.flights.length;
  }

  // ---- Tweens ----

  /**
   * A frame number lower than the last one is a new level (a kit's world starts again at 0, often
   * with the same entity ids): tweens and the ids seen are dropped before the frame's events, as
   * particles, camera effects and frame events treat it, so a tween started late in one level
   * never freezes at its start on the next and spawn tweens play again.
   */
  private restartOnNewLevel(frame: Frame): void {
    if (this.lastFrame !== null && frame.frame < this.lastFrame) {
      this.tweens.clear();
      this.seen = new Set();
    }
    this.lastFrame = frame.frame;
  }

  private tweensOf(id: string): TweenSet {
    let set = this.tweens.get(id);
    if (set === undefined) this.tweens.set(id, (set = new TweenSet()));
    return set;
  }

  /**
   * Starts `spawnTween` on entities new this frame, drops ended tweens and those of entities gone
   * from the frame. Tweens are presenter state only: they never touch the frame.
   */
  private updateTweens(frame: Frame): void {
    const ids = new Set<string>();
    for (const e of frame.entities) {
      ids.add(e.id);
      if (this.seen.has(e.id)) continue;
      const spawn = this.skin.kinds[e.kind]?.spawnTween;
      if (spawn !== undefined) this.tweensOf(e.id).add(spawn, frame.frame);
    }
    this.seen = ids;
    for (const [id, set] of this.tweens) {
      set.update(frame.frame);
      if (set.size === 0 || !ids.has(id)) this.tweens.delete(id);
    }
  }

  /**
   * Shake from the frame's camera hint and from old `shake` effects, as a whole-pixel offset,
   * scaled by the player's shake setting.
   */
  private shake(frame: Frame): number {
    const sizes = this.effects.filter((a) => a.effect.kind === 'shake').map((a) => a.effect.size ?? 2);
    const scale = Math.min(1, Math.max(0, this.settings.shakeScale ?? 1));
    return Math.round(cameraShake(frame, sizes) * scale) + 0;
  }

  private drawEffects(tick: number, size: ScreenSize): void {
    const r = this.r;
    for (const a of this.effects) {
      const { effect } = a;
      const ticks = effect.ticks ?? EFFECT_TICKS[effect.kind];
      const color = effect.color ?? '#fcfcfc';
      const age = tick - a.start;
      if (effect.kind === 'flash') {
        if (!this.settings.reduceFlashing) r.rect(0, 0, size.width, size.height, color);
      } else if (effect.kind === 'tint') {
        translucent(r, 0.4 * (1 - age / ticks), () => r.rect(0, 0, size.width, size.height, color));
      }
    }
  }

  // ---- Particles ----

  /**
   * The live particles in world space (after the entities): squares `size` px on a side (rounded,
   * at least 1; none at 0) centred on each particle, or its sprite `frame` scaled by `size`, at its
   * `alpha`, through `blended` for `add` (the canvas's `lighter`) and `glowing` for `glow`.
   */
  private drawParticles(view: View): void {
    const r = this.r;
    const list = this.particles.particles(this.settings.reduceFlashing ? { reduceFlashing: true } : {});
    let i = 0;
    while (i < list.length) {
      // One blend scope for each run of particles with the same blend.
      const blend = list[i]!.blend;
      let j = i;
      while (j < list.length && list[j]!.blend === blend) j++;
      const run = list.slice(i, j);
      blended(r, blend, () => {
        for (const p of run)
          glowing(r, p.color, p.glow, () => translucent(r, p.alpha, () => this.drawParticle(p, view)));
      });
      i = j;
    }
  }

  private drawParticle(p: ParticleView, view: View): void {
    const r = this.r;
    const { zoom } = view;
    if (p.size <= 0 || p.alpha <= 0) return;
    if (p.frame !== undefined) {
      const id = p.sheet ?? this.skin.sheets?.sheet;
      const sheet = id === undefined ? null : this.sheet(id, this.skin.sheets?.palette);
      const rect = sheet?.frames.get(p.frame);
      if (sheet && rect) {
        const scale = p.size * zoom;
        const x = Math.round((p.x - (rect.w * p.size) / 2) * zoom) - view.x;
        const y = Math.round((p.y - (rect.h * p.size) / 2) * zoom) - view.y;
        if (scale === 1) r.sprite(sheet, p.frame, x, y);
        else r.sprite(sheet, p.frame, x, y, false, false, 0, scale);
        return;
      }
    }
    const side = Math.max(1, Math.round(p.size));
    const drawn = Math.max(1, Math.round(side * zoom));
    r.rect(
      Math.round((p.x - side / 2) * zoom) - view.x,
      Math.round((p.y - side / 2) * zoom) - view.y,
      drawn,
      drawn,
      p.color,
    );
  }

  // ---- Lighting (Engine 0.16 part C T4) ----

  /** The full map the presenter shows this frame, or null. */
  private shownMap(frame: Frame): DeepReadonly<PresentMap> | null {
    if (frame.map === undefined) return null;
    if (isFullMap(frame.map)) return frame.map;
    const shown = this.shown?.map;
    return shown !== undefined && shown.id === frame.map.id && shown.version === frame.map.version
      ? shown
      : null;
  }

  /** The placed lights' sprites (a wall torch), in world space, over the map and under the entities. */
  private drawLightProps(view: View, tick: number): void {
    if (this.lighting.spec?.maps === undefined || !this.mapVisible) return;
    const r = this.r;
    const map = this.shown?.map ?? null;
    for (const d of this.lighting.props(map, tick)) {
      const id = d.sheet ?? this.skin.sheets?.sheet;
      const sheet = id === undefined ? null : this.sheet(id, this.skin.sheets?.palette);
      if (!sheet) continue;
      const x = Math.round(d.x * view.zoom) - view.x;
      const y = Math.round(d.y * view.zoom) - view.y;
      if (view.zoom === 1) r.sprite(sheet, d.frame, x, y);
      else r.sprite(sheet, d.frame, x, y, false, false, 0, view.zoom);
    }
  }

  /**
   * The skin's lighting over the picture (after the entities and particles, before effects and
   * the HUD): the darkness drawn on the light map with each light erased out of it as a radial
   * gradient (`lightStops`: smooth or in `bands`; dithered by picture pixel with the skin's
   * `dither`, `lightDither`), the map laid over the picture at the darkness
   * level, then each light's colour added (`add`), then the vignette.
   */
  private drawLighting(frame: Frame, view: View, size: ScreenSize): void {
    if (this.lighting.spec === undefined) return;
    const map = this.mapVisible ? (this.shown?.map ?? null) : null;
    const layout = this.lighting.layout({
      frame: frame.frame,
      entities: frame.entities,
      map,
      view,
      size,
      ...(this.settings.reduceFlashing !== undefined && { reduceFlashing: this.settings.reduceFlashing }),
    });
    if (layout === null) return;
    const r = this.r;
    if (layout.darkness !== null) this.drawDarkness(layout, size);
    const dither = lightDither(layout);
    for (const l of layout.lights) {
      if (l.glow <= 0) continue;
      radialFilled(r, {
        x: l.x,
        y: l.y,
        radius: l.radius,
        color: l.color,
        stops: lightStops(l.glow, layout.bands, layout.dither),
        mode: 'add',
        ...(dither && { dither }),
      });
    }
    const v = layout.vignette;
    if (v !== null) {
      const cx = size.width / 2;
      const cy = size.height / 2;
      radialFilled(r, {
        x: cx,
        y: cy,
        radius: Math.hypot(cx, cy),
        color: v.color,
        stops: [
          { at: 0, alpha: 0 },
          { at: v.inner, alpha: 0 },
          { at: 1, alpha: v.strength },
        ],
        mode: 'normal',
        box: { x: 0, y: 0, w: size.width, h: size.height },
      });
    }
  }

  /** The darkness with the lights cut out of it, on the light map (or a flat box without one). */
  private drawDarkness(layout: LightingLayout, size: ScreenSize): void {
    const r = this.r;
    const dark = layout.darkness!;
    let lm = this.lightMap;
    if (lm === null || lm.w !== size.width || lm.h !== size.height) {
      const surface = this.opts.lightSurface?.(size.width, size.height) ?? null;
      lm = { surface, w: size.width, h: size.height };
      this.lightMap = lm;
    }
    const surface = lm.surface;
    if (surface === null) {
      translucent(r, dark.level, () => r.rect(0, 0, size.width, size.height, dark.color));
      return;
    }
    const s = surface.renderer;
    s.clear(dark.color);
    const dither = lightDither(layout);
    for (const l of layout.lights) {
      if (l.intensity <= 0) continue;
      radialFilled(s, {
        x: l.x,
        y: l.y,
        radius: l.radius,
        color: '#000000',
        stops: lightStops(l.intensity, layout.bands, layout.dither),
        mode: 'erase',
        ...(dither && { dither }),
      });
    }
    const sheet: SpriteSheet = {
      id: 'light-map',
      image: surface.image,
      frames: new Map([['light', { x: 0, y: 0, w: size.width, h: size.height }]]),
    };
    translucent(r, dark.level, () => r.sprite(sheet, 'light', 0, 0));
  }

  // ---- Fog of war (Engine 0.16 part D, D3) ----

  /**
   * The frame's `fog` over the map, the entities and the lighting, under effects and the HUD: the
   * skin's `fog` look as translucent boxes (`fogBoxes`), each from its corner to the next one's
   * (both rounded at the zoom) so cells meet without gaps; boxes off the picture are skipped. A
   * frame without `fog`, or with no map shown, draws nothing.
   */
  private drawFog(frame: Frame, view: View, size: ScreenSize): void {
    const fog = frame.fog;
    const map = this.mapVisible ? (this.shown?.map ?? null) : null;
    if (fog === undefined || map === null) return;
    const r = this.r;
    const { zoom } = view;
    for (const b of fogBoxes(fog, this.fogLook, map.tileSize)) {
      const x0 = Math.max(0, Math.round(b.x * zoom) - view.x);
      const y0 = Math.max(0, Math.round(b.y * zoom) - view.y);
      const x1 = Math.min(size.width, Math.round((b.x + b.w) * zoom) - view.x);
      const y1 = Math.min(size.height, Math.round((b.y + b.h) * zoom) - view.y);
      if (x1 <= x0 || y1 <= y0) continue;
      if (b.alpha >= 1) r.rect(x0, y0, x1 - x0, y1 - y0, b.color);
      else translucent(r, b.alpha, () => r.rect(x0, y0, x1 - x0, y1 - y0, b.color));
    }
  }

  // ---- Camera ----

  /**
   * The zoom and the picture pixel at the top-left, with shake added (in picture pixels). The
   * framing (follow, deadzone, lerp, clamp) is `CameraFollower` in `@engine/core/present`, shared
   * with the 3D backend; it frames the zoomed view (`cameraView`: the picture size over `zoom`,
   * in world pixels), so clamping keeps that view inside the map.
   */
  private cameraView(frame: Frame, size: ScreenSize, fx: CameraFxState): View {
    const base = cameraZoom(frame, this.skin.camera);
    const map = this.mapVisible ? (this.shown?.map ?? null) : null;
    const framed = this.camera.update(frame, this.skin.camera, cameraView(size, base), map);
    // A zoom punch zooms the framed view about its centre (kept inside the map when it zooms out).
    const area = cameraArea(frame, map, (this.opts.clamp ?? this.skin.camera?.clamp) !== false);
    const focus = cameraTarget(frame, this.skin.camera);
    const { cam } = zoomAbout(framed, cameraView(size, base), fx.zoom, area, focus);
    const zoom = base * fx.zoom;
    this.viewBox = { x: cam.x, y: cam.y, w: size.width / zoom, h: size.height / zoom };
    return {
      x: Math.round(cam.x * zoom) + this.shake(frame) + fx.shakeX,
      y: Math.round(cam.y * zoom) + fx.shakeY,
      zoom,
    };
  }

  // ---- Parallax ----

  /**
   * The skin's `parallax` layers behind the map (`layoutParallax`, shared with the 3D backend),
   * scrolled against the camera's top-left in picture px (zoom and shake included); frames are
   * drawn at scale 1 and gradients as flat boxes.
   */
  private drawParallax(look: Skin, view: View, size: ScreenSize): void {
    if (look.parallax === undefined) return;
    const r = this.r;
    const frameSize = (id: string, palette: string | undefined, name: string) =>
      this.sheet(id, palette)?.frames.get(name) ?? null;
    for (const d of layoutParallax(look, view, size, frameSize)) {
      if (d.kind === 'box') r.rect(d.x, d.y, d.w, d.h, d.color);
      else {
        const sheet = this.sheet(d.sheet, d.palette);
        if (sheet) r.sprite(sheet, d.frame, d.x, d.y);
      }
    }
  }

  // ---- Map ----

  /**
   * The skin as it looks on the map with id `mapId` (`themedSkin`: its `themes` entry for that
   * map laid over it), made once per map id.
   */
  private look(mapId: string | undefined): Skin {
    if (mapId === undefined) return this.skin;
    let look = this.looks.get(mapId);
    if (look === undefined) {
      look = themedSkin(this.skin, mapId);
      this.looks.set(mapId, look);
    }
    return look;
  }

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
    const surface = this.opts.mapSurface?.(w, h) ?? null;
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
   * at any zoom. A layer's tile whose frame has an `anchor` is placed by it on its cell (a
   * decoration prop larger than a tile; Engine 0.16 part C T1).
   */
  private drawTiles(r: Renderer, map: DeepReadonly<PresentMap>, view: View): void {
    const tiles = this.look(map.id).tiles ?? {};
    const defaults = this.skin.sheets;
    const ts = map.tileSize;
    const { zoom } = view;
    const at = (n: number) => Math.round(n * ts * zoom);
    const grids = [map.tiles, ...(map.layers ?? []).map((l) => l.tiles)];
    for (const [g, grid] of grids.entries()) {
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
          // A `join` entry (Engine 0.16 part B) picks its frame by the neighbours it joins.
          const frame = resolveTileFrame(entry, key, grid, col, row);
          const rect = frame === undefined ? undefined : sheet?.frames.get(frame);
          if (frame !== undefined && sheet && rect) {
            // On a layer (decoration, Engine 0.16 part C T1) a frame's anchor places it on its cell,
            // so a prop taller or wider than a tile stands on the cell's bottom centre.
            const a =
              g > 0 && rect.anchor !== undefined ? anchorOffset(rect.anchor, rect, { w: ts, h: ts }) : null;
            const ax = a === null ? x : Math.round((col * ts + a.x) * zoom) - view.x;
            const ay = a === null ? y : Math.round((row * ts + a.y) * zoom) - view.y;
            if (zoom === 1) r.sprite(sheet, frame, ax, ay);
            else r.sprite(sheet, frame, ax, ay, false, false, 0, zoom);
          } else {
            const color = entry.fallbackColor ?? entry.color ?? defaults?.fallbackColor;
            if (color !== undefined) r.rect(x, y, at(col + 1) - view.x - x, at(row + 1) - view.y - y, color);
          }
        }
      }
    }
  }

  // ---- Entities ----

  private drawEntity(e: DeepReadonly<PresentEntity>, view: View, tick: number): void {
    const r = this.r;
    const { zoom } = view;
    const tw: TweenState = this.tweens.get(e.id)?.state(tick) ?? REST_STATE;
    const sf = resolveSkinFrame(this.skin, e);
    const entry = resolveSkinKind(this.skin, e);
    // A kind's `hitFlash` (Engine 0.16 F8) draws the frame as a silhouette in its colour.
    const flash = entry?.hitFlash;
    const flashing =
      flash !== undefined &&
      e.tags.includes(flash.tag) &&
      (flash.blink === undefined || Math.floor(tick / flash.blink) % 2 === 0);
    const palette = flashing ? flash.color : sf.palette;
    const sheet = sf.sheet === null || sf.frame === null ? null : this.sheet(sf.sheet, palette);
    const rect = sf.frame === null ? undefined : sheet?.frames.get(sf.frame);
    // The drawn scale: the zoom, or for a `screenScale` look the zoom held in its range (D4).
    const scale = screenScaleAt(entry?.screenScale, zoom);
    // The drawn size in picture pixels: the sprite's or box's size times the scale.
    const scaled = (n: number) => (scale === 1 ? n : Math.max(1, Math.round(n * scale)));
    const w = scaled(rect?.w ?? sf.size?.w ?? e.w);
    const h = scaled(rect?.h ?? sf.size?.h ?? e.h);
    // A PNG sheet's frame anchor (Engine 0.16 T10) places it on the entity box; text sprites have none.
    const anchor = rect?.anchor === undefined ? null : anchorOffset(rect.anchor, rect, e, sf.flipX);
    const wx = e.x + tw.x + (sf.offset?.x ?? 0) + (anchor?.x ?? 0);
    const wy = e.y + tw.y + (sf.offset?.y ?? 0) + (anchor?.y ?? 0);
    // A world point at the zoom; a `screenScale` look keeps its box's pivot there and is laid out
    // round it at its own scale (at scale === zoom both are the plain `round(w * zoom)`).
    const pivot = scale === zoom ? null : screenScalePivot(entry?.screenScale?.anchor, e);
    const x = (pivot ? Math.round(pivot.x * zoom + (wx - pivot.x) * scale) : Math.round(wx * zoom)) - view.x;
    const y = (pivot ? Math.round(pivot.y * zoom + (wy - pivot.y) * scale) : Math.round(wy * zoom)) - view.y;
    // Outline and team colour (D4): recoloured copies of the sheet, made once and kept.
    const team = skinTeamColor(entry, e.tags);
    const outline = skinOutlineColor(entry, e.tags);
    // A hit flash's silhouette is not team-coloured over.
    const teamSpec: RecolorSpec | null =
      team === null || entry?.team === undefined || flashing
        ? null
        : entry.team.mask !== undefined
          ? { kind: 'mask', mask: entry.team.mask, color: team }
          : entry.team.hue !== undefined
            ? { kind: 'hue', min: entry.team.hue.min, max: entry.team.hue.max, color: team }
            : { kind: 'tint', color: team };
    const bodySheet = rect && sheet && teamSpec ? (this.recolored.get(sheet, teamSpec) ?? sheet) : sheet;
    const edge =
      rect && sheet && outline !== null
        ? this.recolored.get(sheet, { kind: 'silhouette', color: outline })
        : null;
    const sprite = (to: Renderer, from: SpriteSheet, dx: number, dy: number) => {
      if (scale === 1) to.sprite(from, sf.frame!, dx, dy, sf.flipX);
      else to.sprite(from, sf.frame!, dx, dy, sf.flipX, false, 0, scale);
    };
    const draw = (to: Renderer, dx: number, dy: number) => {
      if (rect && bodySheet) {
        if (edge) for (const [ox, oy] of OUTLINE_STEPS) sprite(to, edge, dx + ox, dy + oy);
        sprite(to, bodySheet, dx, dy);
      } else {
        if (outline !== null) to.rect(dx - 1, dy - 1, w + 2, h + 2, outline);
        to.rect(dx, dy, w, h, team ?? sf.fallbackColor);
      }
      // A colour tween's overlay over the drawn box.
      if (tw.color !== null && tw.colorAmount > 0)
        translucent(to, tw.colorAmount, () => to.rect(dx, dy, w, h, tw.color!));
    };
    // Tweens lay their offsets and factors on top of the frame's `fx` (never written back).
    const fx = e.fx;
    const sx = (fx?.squashX ?? 1) * tw.scaleX;
    const sy = (fx?.squashY ?? 1) * tw.scaleY;
    // Top-down art (`turnToFacing`, Engine 0.16 F8) is turned to the facing about its centre.
    const turning = entry?.turnToFacing;
    const facingTurn =
      turning === undefined || turning === false
        ? 0
        : FACING_TURN[e.facing] - FACING_TURN[turning === true ? 'right' : turning];
    const turn = (fx?.rotate ?? 0) + tw.rotate + facingTurn;
    const body = () => {
      if (turning !== undefined && turning !== false) {
        transformed(r, x + w / 2, y + h / 2, (turn * Math.PI) / 180, sx, sy, (l) => draw(l, -w / 2, -h / 2));
        return;
      }
      // Squash, stretch and turns pivot on the bottom centre, so feet stay on the ground.
      if (sx !== 1 || sy !== 1 || turn !== 0) {
        transformed(r, x + w / 2, y + h, (turn * Math.PI) / 180, sx, sy, (l) => draw(l, -w / 2, -h));
      } else draw(r, x, y);
    };
    // A kind's `ring` (2D, Engine 0.16 F8: a tower's range while placing) lies under the sprite.
    if (entry?.ring !== undefined) this.drawRing(entry.ring, e, view);
    // A kind's `blend` and `glow` (2D) wrap the whole drawing.
    const glow = entry?.glow;
    blended(r, entry?.blend ?? 'normal', () =>
      glowing(r, glow?.color ?? '#000', glow?.radius ?? 0, () =>
        translucent(r, Math.min(1, Math.max(0, (fx?.alpha ?? 1) * tw.alpha)), body),
      ),
    );
  }

  /**
   * A flat disc of `radius` world px (or, from Engine 0.16 E6, the number of the entity's `tag`
   * times `per`, `ringRadius`) centred on the entity's box, drawn as one-pixel rows (crisp
   * at any zoom) at the ring's `alpha`, with its `edge` (the rows' end pixels and the top and
   * bottom rows) opaque.
   */
  private drawRing(
    ring: NonNullable<DeepReadonly<SkinFile['kinds'][string]['ring']>>,
    e: DeepReadonly<PresentEntity>,
    view: View,
  ): void {
    const r = this.r;
    const world = ringRadius(ring, e.tags, this.shown?.map.tileSize);
    if (world === null) return;
    const cx = Math.round((e.x + e.w / 2) * view.zoom) - view.x;
    const cy = Math.round((e.y + e.h / 2) * view.zoom) - view.y;
    const radius = Math.max(1, Math.round(world * view.zoom));
    // Only the rows on the picture (a zoom punch can make a ring far larger than it).
    const height = (this.size ?? this.frameSize).height;
    const rows = discRows(radius, Math.max(-radius, -cy), Math.min(radius, height - 1 - cy));
    const alpha = ring.alpha ?? DEFAULT_RING_ALPHA;
    translucent(r, alpha, () => {
      for (const row of rows) r.rect(cx - row.half, cy + row.dy, row.half * 2, 1, ring.color);
    });
    if (ring.edge === undefined) return;
    // The rim: on each row the pixels the next row out does not cover (at least one each end).
    for (const row of rows) {
      const outer =
        row.dy === 0
          ? Math.max(discHalf(radius, -1), discHalf(radius, 1))
          : discHalf(radius, row.dy < 0 ? row.dy - 1 : row.dy + 1);
      const run = Math.min(row.half, Math.max(1, row.half - outer));
      r.rect(cx - row.half, cy + row.dy, run, 1, ring.edge);
      r.rect(cx + row.half - run, cy + row.dy, run, 1, ring.edge);
    }
  }

  // ---- Labels ----

  /**
   * The skin's `labels` over the entities (Engine 0.16 F8: the 3D backend's world-anchored labels
   * on a 2D skin, such as enemies' health bars): each label's anchor is the box's top centre,
   * centre or bottom centre on the picture, laid out by the UI kit's `layoutLabels` and painted
   * like the HUD; an anchor off the picture hides the label.
   */
  private drawLabels(frame: Frame, view: View, size: ScreenSize): void {
    const labels = this.skin.labels;
    if (labels === undefined) return;
    const draws: UiDraw[] = [];
    for (const e of frame.entities) {
      const list = skinLabels(labels, e.kind);
      if (list.length === 0) continue;
      const project = (anchor: 'top' | 'center' | 'bottom') => {
        const wy = anchor === 'top' ? e.y : anchor === 'center' ? e.y + e.h / 2 : e.y + e.h;
        const x = Math.round((e.x + e.w / 2) * view.zoom) - view.x;
        const y = Math.round(wy * view.zoom) - view.y;
        return x < 0 || x >= size.width || y < 0 || y >= size.height ? null : { x, y };
      };
      draws.push(...layoutLabels(list, e, frame.status, project, this.opts.fonts).draws);
    }
    if (draws.length > 0) paintUi(draws, this.uiPainter);
  }

  // ---- HUD ----

  /**
   * The HUD in picture pixels. A skin with a UI kit item (Engine 0.16 T6: a font file's text, a
   * bar, counter, panel or minimap) is laid out by `SkinHud` and painted by `RendererUiPainter`;
   * any other is `layoutHud` (`@engine/core/present`, shared with the 3D backend) drawn as before.
   */
  private drawHud(frame: Frame): void {
    const r = this.r;
    const frameSize: HudFrameSize = (id, palette, name) => this.sheet(id, palette)?.frames.get(name) ?? null;
    if (this.hud.usesUi) {
      const draws = this.hud.layout({
        status: frame.status,
        frameSize,
        map: this.mapVisible ? (this.shown?.map ?? null) : null,
        entities: frame.entities,
        clock: this.fxClock,
        fog: frame.fog ?? null,
        view: this.viewBox,
      });
      paintUi(draws, this.uiPainter);
      return;
    }
    const font = this.opts.font;
    for (const d of layoutHud(this.skin, frame.status, frameSize, font !== undefined ? { font } : {})) {
      if (d.kind === 'text') r.text(this.sheet(d.font) ?? EMPTY_FONT, d.text, d.x, d.y);
      else if (d.kind === 'box') r.rect(d.x, d.y, d.w, d.h, d.color);
      else {
        const sheet = this.sheet(d.sheet, d.palette);
        if (sheet) r.sprite(sheet, d.frame, d.x, d.y);
      }
    }
  }
}

/** A ring's fill opacity when the skin gives none. */
export const DEFAULT_RING_ALPHA = 0.25;

/** World px per unit of a ring's tag number when it gives no `per` and no map is shown. */
export const DEFAULT_RING_PER = 16;

/**
 * A ring's radius in world px for an entity's tags (Engine 0.16 E6): with `tag`, the number after
 * the first tag with that prefix times `per` (default `tileSize`, the shown map's, else
 * `DEFAULT_RING_PER`); else, or when no tag holds a positive number, its `radius`; null when it has
 * neither (no ring is drawn).
 */
export function ringRadius(
  ring: DeepReadonly<{ radius?: number; tag?: string; per?: number }>,
  tags: readonly string[],
  tileSize?: number,
): number | null {
  if (ring.tag !== undefined) {
    const tag = tags.find((t) => t.startsWith(ring.tag!));
    const rest = tag?.slice(ring.tag.length) ?? '';
    const n = rest.trim() === '' ? NaN : Number(rest);
    if (Number.isFinite(n) && n > 0) return n * (ring.per ?? tileSize ?? DEFAULT_RING_PER);
  }
  return ring.radius ?? null;
}

/** Degrees clockwise from facing right, for `turnToFacing` art (drawn facing right). */
const FACING_TURN: Readonly<Record<PresentEntity['facing'], number>> = {
  right: 0,
  'down-right': 45,
  down: 90,
  'down-left': 135,
  left: 180,
  'up-left': 225,
  up: 270,
  'up-right': 315,
};

/** Half a disc row's width at `dy` from its centre (whole px, at least 1), or 0 past the disc. */
function discHalf(radius: number, dy: number): number {
  if (dy < -radius || dy > radius) return 0;
  return Math.max(1, Math.round(Math.sqrt(radius * radius - dy * dy)));
}

/**
 * A disc of `radius` px as rows from `from` to `to` (offsets from the centre, within the disc):
 * each row's offset and half its width (whole px).
 */
function discRows(radius: number, from = -radius, to = radius): { dy: number; half: number }[] {
  const rows: { dy: number; half: number }[] = [];
  for (let dy = Math.max(-radius, from); dy <= Math.min(radius, to); dy++)
    rows.push({ dy, half: discHalf(radius, dy) });
  return rows;
}

/** Entities by `layer` (0 when absent), keeping list order on ties (a stable sort), as `PresentFrame` says. */
function depthOrder(entities: readonly DeepReadonly<PresentEntity>[]): DeepReadonly<PresentEntity>[] {
  return [...entities].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));
}
