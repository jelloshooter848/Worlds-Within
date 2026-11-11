import type { SpriteDef } from '@engine/core/gfx/pixelart';
import type {
  Facing,
  PresentEntity,
  PresentEvent,
  PresentFrame,
  PresentMap,
  SkinFile,
} from '@engine/core/present';
import { Rng } from '@engine/core/rng';

// The 2D feature benchmark's scene (Engine 0.16 T13, item 320; the 0.9 RTS benchmark grown into a
// feature test). It starts from a real frame of a sample game (the RTS skirmish or the tower
// defense, played to a busy tick by `games.ts`) and its real `canvas2d` skin, and adds what the
// 0.16 presentation features cost on top:
//
// - many units: `units` copies of the frame's own units (their kinds, skins, palettes and
//   animations) walking in eight directions over the whole map, the RTS ones with health bars;
// - particles: a dust trail on every unit (normal blending), braziers with additive glowing
//   flames and normal smoke, spark bursts (additive, glowing) and blasts, 2000+ alive at once;
// - three parallax layers (a gradient sky and two repeating frames) behind the map;
// - tinting: the skins' palette swaps (the TD's `hit` look, the RTS enemy palette), a colour
//   tween on every hit unit and a full-screen tint on each blast;
// - glow and additive blending on kinds (braziers, wisps over every tenth unit);
// - a UI kit HUD (panel, text in the game's font, bar, counter and minimap) beside the skin's own;
// - camera effects: a trauma shake on each blast, a zoom punch and a flash every 150 frames, over
//   a camera panning round the map at the case's zoom.
//
// Everything is from one seed, so a case draws the same frames on every run. `plain` cases draw
// the same units on the game's own skin with none of the additions (the cost of the features).
// The extra art (`FX_SHEET`) is original text pixel art made here.

export const FX_SHEET = 'bench-fx';

/** Palette: `.` is transparent, `0`-`9` and `a`-`f` index these colours. */
export const FX_PALETTE: readonly string[] = [
  '#000000',
  '#202020', // 1 outline
  '#7c7c7c', // 2 iron
  '#d82800', // 3 ember
  '#f87858', // 4 flame
  '#fcbc3c', // 5 gold
  '#fce0a8', // 6 pale
  '#fcfcfc', // 7 white
  '#a4e4fc', // 8 ice
  '#3cbcfc', // 9 sky
  '#005858', // a panel
  '#00a8a8', // b panel light
  '#5c94fc', // c cloud shade
  '#007800', // d hill
  '#00a800', // e hill light
  '#503000', // f trunk
];

/** Draws a `w` x `h` frame by asking `at(x, y)` for each pixel's character. */
function paint(w: number, h: number, at: (x: number, y: number) => string): string[] {
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => at(x, y)).join(''));
}

/** The extra frames: a brazier, a wisp, a spark, a HUD panel and two parallax strips. */
export function fxSheet(): SpriteDef {
  const frames: Record<string, string[]> = {
    // A 12 x 16 iron brazier on a pole, coals glowing in the bowl.
    brazier: paint(12, 16, (x, y) => {
      if (y <= 1) return x >= 3 && x <= 8 ? (x % 2 === 0 ? '4' : '5') : '.';
      if (y <= 4) return x >= 1 && x <= 10 ? (y === 2 ? '3' : x === 1 || x === 10 ? '1' : '2') : '.';
      if (y === 5) return x >= 3 && x <= 8 ? '1' : '.';
      if (y < 15) return x === 5 || x === 6 ? '2' : '.';
      return x >= 3 && x <= 8 ? '1' : '.';
    }),
    // A 7 x 7 soft orb (drawn additively).
    wisp: paint(7, 7, (x, y) => {
      const d = (x - 3) ** 2 + (y - 3) ** 2;
      return d <= 1 ? '7' : d <= 4 ? '8' : d <= 9 ? '9' : '.';
    }),
    spark: paint(3, 3, (x, y) => (x === 1 && y === 1 ? '7' : x === 1 || y === 1 ? '5' : '.')),
    'hud-panel': paint(9, 9, (x, y) =>
      x === 0 || y === 0 || x === 8 || y === 8 ? '1' : x === 1 || y === 1 ? 'b' : 'a',
    ),
    // 64-px strips that repeat without a seam.
    clouds: paint(64, 20, (x, y) => {
      const blob = (cx: number, cy: number, r: number) => ((x - cx) / r) ** 2 + ((y - cy) / (r * 0.6)) ** 2;
      const d = Math.min(blob(12, 12, 10), blob(24, 9, 8), blob(46, 13, 9), blob(56, 10, 6));
      return d <= 0.7 ? '7' : d <= 1 ? 'c' : '.';
    }),
    hills: paint(64, 32, (x, y) => {
      const top =
        14 + Math.round(6 * Math.sin((2 * Math.PI * x) / 64) + 3 * Math.sin((4 * Math.PI * x) / 64));
      if (y < top) return '.';
      if (y === top) return '1';
      return (x + y) % 9 === 0 ? 'e' : y > 28 && x % 16 === 3 ? 'f' : 'd';
    }),
  };
  return { palette: FX_SHEET, frames };
}

/** The features a case can switch off one by one (`FeatureCase.without`). */
export const FEATURE_NAMES = ['glow', 'add', 'particles', 'parallax', 'hud', 'camera'] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];

/** The two sample maps the bench draws. */
export type FeatureMap = 'rts' | 'td';

/** What the feature skin needs from the game: its font and how its units look. */
export interface FeatureGameInfo {
  map: FeatureMap;
  /** The game's UI font (a `font` content file) for the HUD's text and counter. */
  font: string;
  /** The HUD's heading. */
  title: string;
  /** The picture's width (the minimap's panel stands at its right edge). */
  width: number;
  /** The map's size in tiles (the minimap's scale). */
  cols: number;
  rows: number;
}

/** The UI kit items `featureSkin` adds after the game's own HUD items. */
export const BENCH_HUD_ITEMS = 6;

const MINIMAP_COLORS = ['#7c7c7c', '#ac7c00', '#00a800', '#0058f8', '#fce0a8', '#d82800', '#fcfcfc'];

/**
 * The game's skin with every 0.16 feature added (a new object; `skin` is not changed): the
 * emitters, kinds and events below, the three parallax layers and a UI kit HUD on top of the
 * game's own HUD items. Unit kinds (`unitKinds`) get the dust trail; tower and hero kinds a glow.
 */
export function featureSkin(skin: SkinFile, info: FeatureGameInfo, unitKinds: readonly string[]): SkinFile {
  const out = structuredClone(skin) as SkinFile & Record<string, unknown>;
  const kinds = out.kinds as Record<string, Record<string, unknown>>;
  for (const kind of unitKinds) {
    if (kinds[kind]) kinds[kind] = { ...kinds[kind], emit: 'bench-trail' };
  }
  for (const [name, entry] of Object.entries(kinds)) {
    if (/^(tower|unit:hero|building:town-centre)/.test(name)) entry.glow = { color: '#fcbc3c', radius: 3 };
    if (/^shot:/.test(name)) entry.blend = 'add';
  }
  kinds['bench-brazier'] = {
    sheet: FX_SHEET,
    frames: { idle: 'brazier' },
    emit: ['bench-flame', 'bench-smoke'],
    glow: { color: '#f87858', radius: 6 },
  };
  kinds['bench-wisp'] = {
    sheet: FX_SHEET,
    frames: { idle: 'wisp' },
    blend: 'add',
    glow: { color: '#a4e4fc', radius: 4 },
  };
  out.emitters = {
    ...(out.emitters as Record<string, unknown> | undefined),
    'bench-trail': {
      rate: 0.15,
      life: [24, 36],
      speed: [0.1, 0.3],
      angle: [240, 300],
      anchor: 'feet',
      shape: { box: { w: 8, h: 2 } },
      gravity: -0.004,
      size: [2, 3, 3],
      color: ['#fce0a8', '#bcbcbc'],
      alpha: [0.7, 0],
    },
    'bench-flame': {
      rate: 2,
      life: [14, 24],
      speed: [0.3, 0.8],
      angle: [250, 290],
      anchor: 'top',
      offset: { x: 0, y: 1 },
      shape: { circle: 3 },
      gravity: -0.03,
      size: [3, 3, 1],
      color: ['#fce0a8', '#fcbc3c', '#d82800'],
      alpha: [1, 0.9, 0],
      blend: 'add',
      glow: 3,
      max: 64,
    },
    'bench-smoke': {
      rate: 0.6,
      life: [40, 60],
      speed: [0.2, 0.4],
      angle: [255, 285],
      anchor: 'top',
      offset: { x: 0, y: -3 },
      gravity: -0.004,
      drag: 0.01,
      size: [2, 4, 7],
      color: ['#7c7c7c', '#bcbcbc'],
      alpha: [
        { at: 0, value: 0 },
        { at: 0.15, value: 0.5 },
        { at: 1, value: 0 },
      ],
      max: 48,
    },
    'bench-sparks': {
      burst: 14,
      life: [10, 18],
      speed: [1, 2.4],
      angle: [0, 360],
      drag: 0.06,
      gravity: 0.08,
      size: [2, 2, 1],
      color: ['#fcfcfc', '#fcbc3c', '#d82800'],
      alpha: [1, 1, 0],
      blend: 'add',
      glow: 2,
    },
    'bench-glints': {
      burst: 4,
      life: [16, 24],
      speed: [0.3, 0.7],
      angle: [240, 300],
      frame: 'spark',
      sheet: FX_SHEET,
      size: 1,
      alpha: [1, 0],
      blend: 'add',
    },
    'bench-blast': {
      burst: 48,
      life: [20, 34],
      speed: [0.6, 2.2],
      angle: [0, 360],
      drag: 0.08,
      size: [4, 6, 8],
      color: ['#fcbc3c', '#7c7c7c', '#202020'],
      alpha: [1, 0.6, 0],
    },
    'bench-ring': {
      burst: 24,
      life: 14,
      speed: 2.5,
      angle: [0, 360],
      even: true,
      drag: 0.15,
      size: [3, 1],
      color: '#fcfcfc',
      alpha: [0.8, 0],
      blend: 'add',
    },
  };
  out.events = {
    ...(out.events as Record<string, unknown> | undefined),
    'bench-hit': {
      emit: ['bench-sparks', 'bench-glints'],
      tween: { prop: 'color', from: '#fcfcfc', to: '#d82800', frames: 12, amount: 0.6 },
    },
    'bench-blast': {
      emit: ['bench-blast', 'bench-ring'],
      shake: { amount: 4, ticks: 20 },
      effect: { kind: 'tint', color: '#f87858', ticks: 10 },
    },
    'bench-punch': {
      zoom: { to: 1.25, ticks: 10, ease: 'cubicOut', hold: 20, back: 10 },
      flash: { color: '#fcfcfc', alpha: 0.4, ticks: 8 },
    },
  };
  out.parallax = [
    { gradient: ['#0c0c3c', '#3058e8', '#3cbcfc', '#a4e4fc'], bands: 12, factor: 0 },
    { frame: 'clouds', sheet: FX_SHEET, factor: { x: 0.2, y: 0.05 }, y: 16 },
    { frame: 'hills', sheet: FX_SHEET, factor: { x: 0.5, y: 0.1 }, y: 150 },
  ];
  const tiles = Object.keys((skin.tiles ?? {}) as Record<string, unknown>);
  const width = info.width;
  // The minimap: whole px per tile, at most 80 x 48.
  const scale = Math.max(1, Math.floor(Math.min(80 / info.cols, 48 / info.rows)));
  const mini = { w: info.cols * scale, h: info.rows * scale };
  const hud: unknown[] = [
    ...((skin.hud ?? []) as unknown[]),
    { as: 'panel', x: 4, y: 16, w: 92, h: 30, sheet: FX_SHEET, frame: 'hud-panel', slice: 2 },
    {
      as: 'text',
      x: 9,
      y: 20,
      font: info.font,
      format: info.title,
      color: '#fcfcfc',
      shadow: '#000000',
    },
    {
      status: 'benchHp',
      as: 'bar',
      x: 9,
      y: 31,
      w: 40,
      h: 6,
      max: 'benchHpMax',
      color: '#00a800',
      back: '#000000',
      low: { below: 0.34, color: '#d82800' },
    },
    {
      status: 'benchHits',
      as: 'counter',
      x: 54,
      y: 30,
      font: info.font,
      digits: 4,
      color: '#fcbc3c',
      shadow: '#000000',
      tween: { ticks: 12, color: '#fcfcfc' },
    },
    {
      as: 'panel',
      x: width - mini.w - 10,
      y: 16,
      w: mini.w + 6,
      h: mini.h + 6,
      sheet: FX_SHEET,
      frame: 'hud-panel',
      slice: 2,
    },
    {
      as: 'minimap',
      x: width - mini.w - 7,
      y: 19,
      w: mini.w,
      h: mini.h,
      scale,
      tiles: Object.fromEntries(tiles.map((t, i) => [t, MINIMAP_COLORS[i % MINIMAP_COLORS.length]!])),
      back: '#000000',
      dots: [
        ...unitKinds.map((kind, i) => ({ kind, color: i % 2 === 0 ? '#fcfcfc' : '#d82800', size: 1 })),
        { kind: 'bench-brazier', color: '#fcbc3c', size: 2 },
      ],
    },
  ];
  out.hud = hud as NonNullable<SkinFile['hud']>;
  return out;
}

/**
 * `skin` (a feature skin) with some features taken out again (a new object): `glow` drops every
 * kind's and emitter's glow, `add` draws additive kinds and emitters normally, `particles` drops
 * every emitter (kinds' `emit`, events' `emit`), `parallax` the layers, `hud` the UI kit items
 * (the game's own HUD stays) and `camera` the shake, zoom punch and flash.
 */
export function withoutFeatures(skin: SkinFile, without: readonly FeatureName[]): SkinFile {
  const out = structuredClone(skin) as SkinFile & Record<string, unknown>;
  const off = new Set(without);
  const kinds = out.kinds as Record<string, Record<string, unknown>>;
  const emitters = (out.emitters ?? {}) as Record<string, Record<string, unknown>>;
  const events = (out.events ?? {}) as Record<string, Record<string, unknown>>;
  for (const entry of [...Object.values(kinds), ...Object.values(emitters)]) {
    if (off.has('glow')) delete entry.glow;
    if (off.has('add') && entry.blend === 'add') delete entry.blend;
    if (off.has('particles')) delete entry.emit;
  }
  for (const entry of Object.values(events)) {
    if (off.has('particles')) delete entry.emit;
    if (off.has('camera')) {
      delete entry.shake;
      delete entry.zoom;
      delete entry.flash;
    }
  }
  if (off.has('particles')) out.emitters = {};
  if (off.has('parallax')) delete out.parallax;
  if (off.has('hud')) out.hud = (out.hud ?? []).slice(0, -BENCH_HUD_ITEMS);
  return out;
}

/** One case: a map, its unit count, the camera's zoom and whether the 0.16 features are on. */
/** The 2D backend a case is drawn with (Engine 0.16 T13b-6): Canvas2D or PixiJS (WebGL). */
export type FeatureBackend = 'canvas2d' | 'pixi';

export interface FeatureCase {
  map: FeatureMap;
  /** Default `canvas2d`. The scene and skin are the same on both. */
  backend?: FeatureBackend;
  units: number;
  zoom: number;
  /** Default true; false draws the game's own skin with the same units and nothing added. */
  features?: boolean;
  /** Features switched off again (with `features`), to see what each one costs. */
  without?: readonly FeatureName[];
  seed?: number;
}

/** The busy frame of a real game the scene starts from (`games.ts`). */
export interface FeatureBase {
  frame: PresentFrame;
  /** The kinds the scene copies as walking units (each needs a `walk` look in the skin). */
  unitKinds: readonly string[];
  /** A health bar kind drawn under every unit, when the game has one. */
  barKind?: string;
}

/** The eight directions, as `[dx, dy, facing]`, one world px per frame on each axis. */
const DIRS: readonly (readonly [number, number, Facing])[] = [
  [0, -1, 'up'],
  [1, -1, 'up-right'],
  [1, 0, 'right'],
  [1, 1, 'down-right'],
  [0, 1, 'down'],
  [-1, 1, 'down-left'],
  [-1, 0, 'left'],
  [-1, -1, 'up-left'],
];

/** Braziers stand on a grid over the map, this many. */
export const BRAZIERS = 16;
/** A spark burst and colour tween on one unit every this many frames. */
export const HIT_EVERY = 2;
/** A blast (smoke, ring, shake, tint) every this many frames. */
export const BLAST_EVERY = 40;
/** A zoom punch and flash every this many frames, at this offset. */
export const PUNCH_EVERY = 150;
export const PUNCH_AT = 140;
/** Frames a screenshot draws before it is taken: a blast just started, a zoom punch held. */
export const SHOT_FRAMES = 163;
/** The panning camera goes round the map once in this many frames. */
export const PAN_PERIOD = 900;

/**
 * Makes the frames of one case in order. `next()` steps every unit one frame (a new direction
 * every 30 to 89 frames, turning back at the map's edge) and returns the frame: the base frame's
 * other entities (buildings, towers, resources), the units (and their bars), and with features
 * the braziers, the wisps and this frame's events. The full map comes on the first frame and a
 * `{ id, version }` reference after.
 */
export class FeatureScene {
  private readonly rng: Rng;
  private readonly map: PresentMap;
  private readonly fixed: PresentEntity[];
  private readonly templates: PresentEntity[];
  private readonly bar: { e: PresentEntity; dx: number; dy: number } | null;
  private readonly x: Int32Array;
  private readonly y: Int32Array;
  private readonly dir: Uint8Array;
  private readonly timer: Int32Array;
  private hits = 0;
  private tick = 0;

  constructor(
    private readonly base: FeatureBase,
    readonly opts: FeatureCase,
  ) {
    const map = base.frame.map;
    if (!map || !('tiles' in map)) throw new Error('the base frame has no full map');
    this.map = map;
    this.rng = new Rng(opts.seed ?? 1);
    const isUnit = (e: PresentEntity) => base.unitKinds.includes(e.kind);
    this.templates = base.unitKinds.map((kind) => {
      const e = base.frame.entities.find((x) => x.kind === kind);
      if (!e) throw new Error(`the base frame has no ${kind} to copy`);
      return e;
    });
    const unitIds = new Set(base.frame.entities.filter(isUnit).map((e) => e.id));
    // Keep buildings, towers and the rest; drop the game's own units and their bars and overlays.
    this.fixed = base.frame.entities.filter(
      (e) => !isUnit(e) && e.kind !== base.barKind && ![...unitIds].some((id) => e.id.startsWith(`${id}/`)),
    );
    const barEntity = base.barKind
      ? base.frame.entities.find((e) => e.kind === base.barKind && e.id.includes('/'))
      : undefined;
    const owner = barEntity && base.frame.entities.find((e) => e.id === barEntity.id.split('/')[0]);
    this.bar = barEntity
      ? { e: barEntity, dx: owner ? barEntity.x - owner.x : 0, dy: owner ? barEntity.y - owner.y : 17 }
      : null;
    const n = opts.units;
    this.x = new Int32Array(n);
    this.y = new Int32Array(n);
    this.dir = new Uint8Array(n);
    this.timer = new Int32Array(n);
    const { w, h } = this.area();
    for (let i = 0; i < n; i++) {
      this.x[i] = this.rng.int(w - 16);
      this.y[i] = this.rng.int(h - 16);
      this.dir[i] = this.rng.int(8);
      this.timer[i] = 30 + this.rng.int(60);
    }
  }

  private area(): { w: number; h: number } {
    return { w: this.map.cols * this.map.tileSize, h: this.map.rows * this.map.tileSize };
  }

  get features(): boolean {
    return this.opts.features !== false;
  }

  next(): PresentFrame {
    const t = this.tick++;
    if (t > 0) this.step();
    const { w, h } = this.area();
    const angle = (2 * Math.PI * t) / PAN_PERIOD;
    const camX = Math.round(w / 2 + (w / 4) * Math.cos(angle));
    const camY = Math.round(h / 2 + (h / 4) * Math.sin(angle));
    const entities: PresentEntity[] = [...this.fixed];
    for (let i = 0; i < this.opts.units; i++) {
      const { fx: _fx, ...template } = this.templates[i % this.templates.length]!;
      const x = this.x[i]!;
      const y = this.y[i]!;
      // Every fifth unit wears the `hit` tag: the TD skin's palette swap (a tint by look).
      const tags = template.tags.filter((tag) => tag !== 'hit');
      entities.push({
        ...template,
        tags: i % 5 === 0 ? [...tags, 'hit'] : tags,
        id: `bench-u${i}`,
        x,
        y,
        facing: DIRS[this.dir[i]!]![2],
        anim: { state: 'walk', t: t + i },
      });
      if (this.bar) {
        const state = `hp-${1 + (i % 8)}`;
        entities.push({
          ...this.bar.e,
          id: `bench-u${i}/hp`,
          x: x + this.bar.dx,
          y: y + this.bar.dy,
          anim: { state, t: 0 },
        });
      }
      if (this.features && i % 10 === 0) {
        entities.push({
          id: `bench-w${i}`,
          kind: 'bench-wisp',
          x: x + 4,
          y: y - 12 + Math.round(2 * Math.sin((t + i) / 8)),
          w: 7,
          h: 7,
          facing: 'down',
          anim: { state: 'idle', t: 0 },
          tags: [],
          layer: 30,
        });
      }
    }
    const events: PresentEvent[] = [];
    if (this.features) {
      const cols = 4;
      for (let b = 0; b < BRAZIERS; b++) {
        const bx = Math.round(((b % cols) + 0.5) * (w / cols)) - 6;
        const by = Math.round((Math.floor(b / cols) + 0.5) * (h / (BRAZIERS / cols))) - 8;
        entities.push({
          id: `bench-b${b}`,
          kind: 'bench-brazier',
          x: bx,
          y: by,
          w: 12,
          h: 16,
          facing: 'down',
          anim: { state: 'idle', t: 0 },
          tags: [],
          layer: 9,
        });
      }
      if (this.opts.units > 0 && t % HIT_EVERY === 0) {
        events.push({ type: 'bench-hit', entity: `bench-u${(t * 7919) % this.opts.units}` });
        this.hits++;
      }
      if (t > 0 && t % BLAST_EVERY === 0) {
        // Blasts land in view: near the camera's target.
        events.push({
          type: 'bench-blast',
          x: camX - 24 + ((t * 37) % 48),
          y: camY - 16 + ((t * 53) % 32),
        });
      }
      if (t % PUNCH_EVERY === PUNCH_AT) events.push({ type: 'bench-punch' });
    }
    const hp = 10 - (Math.floor(t / 30) % 10);
    return {
      frame: t,
      size: this.base.frame.size,
      entities,
      map: t === 0 ? this.map : { id: this.map.id, version: this.map.version },
      events,
      status: { ...this.base.frame.status, benchHp: hp, benchHpMax: 10, benchHits: this.hits },
      camera: { x: camX, y: camY, zoom: this.opts.zoom },
    };
  }

  private step(): void {
    const { w, h } = this.area();
    for (let i = 0; i < this.opts.units; i++) {
      if (--this.timer[i]! <= 0) {
        this.dir[i] = this.rng.int(8);
        this.timer[i] = 30 + this.rng.int(60);
      }
      let [dx, dy] = DIRS[this.dir[i]!]!;
      const nx = this.x[i]! + dx;
      const ny = this.y[i]! + dy;
      if (nx < 0 || nx > w - 16 || ny < 0 || ny > h - 16) {
        this.dir[i] = (this.dir[i]! + 4) % 8;
        [dx, dy] = DIRS[this.dir[i]!]!;
      }
      this.x[i] = this.x[i]! + dx;
      this.y[i] = this.y[i]! + dy;
    }
  }
}

/** The most particles the bench's presenter keeps alive (the presenter's default is 1024). */
export const BENCH_MAX_PARTICLES = 6000;
