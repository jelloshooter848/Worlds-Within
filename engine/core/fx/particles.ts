import type { Rng } from '../rng';
import { lerpColor } from './color';
import { fxRng } from './rng';
import { EMITTER_DEFAULTS, type EmitterDef, type Keyframes } from './schema';

/**
 * Particles (docs/ROADMAP.md, Engine 0.16 part A, T3): a pure, fixed-step particle system for
 * presenters. Emitters are started at a point (`emit`, a skin event's `emit`) or attached to an
 * entity (`attach`, a skin kind's `emit`), and `update(frame)` steps every whole presentation frame
 * up to `frame`. Every draw comes from `fxRng(seed, frame, 'particles:<key>')`, one stream per
 * running emitter and frame, so the same seed and the same calls give the same particles, frame
 * for frame, on every machine; nothing here reads a clock, a world or a kit.
 *
 * A particle's position is a closed form of its age (start point, start velocity, `drag` and
 * `gravity`), so skipping frames or stepping one at a time lands in the same place.
 */

/** A world box (px, y down): where an emitter attached to an entity sits. */
export interface ParticleAnchorBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the system finds an entity by id this frame (undefined: gone). */
export type ParticleLocate = (id: string) => ParticleAnchorBox | undefined;

/** One particle as a backend draws it, at the system's frame. */
export interface ParticleView {
  /** The emitter's name. */
  emitter: string;
  /** Centre, world px (y down). */
  x: number;
  y: number;
  /** Side in world px. */
  size: number;
  /** `#rgb` / `#rrggbb`. */
  color: string;
  /** 0-1. */
  alpha: number;
  blend: 'normal' | 'add';
  glow: number;
  frame?: string;
  sheet?: string;
  /** Frames since birth, and the frames it lives. */
  age: number;
  life: number;
}

/** Most frames one `update` steps; a longer gap only steps the last ones (spawns before it are skipped). */
export const PARTICLE_CATCH_UP = 240;
/** The default cap on live particles across every emitter of one system. */
export const PARTICLE_SYSTEM_MAX = 1024;

interface Particle {
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
}

interface Emitter {
  key: string;
  name: string;
  def: EmitterDef;
  /** The emitter's point now (world px), before `offset`. */
  x: number;
  y: number;
  /** The entity it follows, or none. */
  follow: string | undefined;
  start: number;
  /** The first frame it no longer spawns on (Infinity for one attached to an entity). */
  until: number;
  /** Fractional spawns carried from `rate`. */
  carry: number;
  /** Stopped spawning (its entity went, or it was detached); removed once its particles die. */
  stopped: boolean;
  particles: Particle[];
}

export interface ParticleSystemOptions {
  /** The run's seed (any whole number; default 0). */
  seed?: number;
  /** The most live particles across every emitter (default {@link PARTICLE_SYSTEM_MAX}). */
  max?: number;
}

/** Where an emitter sits on an entity box (`anchor`). */
export function anchorPoint(box: ParticleAnchorBox, anchor: EmitterDef['anchor']): { x: number; y: number } {
  const x = box.x + box.w / 2;
  if (anchor === 'feet') return { x, y: box.y + box.h };
  if (anchor === 'top') return { x, y: box.y };
  return { x, y: box.y + box.h / 2 };
}

/** A keyframed value at `t` (0 at birth, 1 at the last frame of life); `lerp` blends two. */
export function keyframeAt<T>(keys: Keyframes<T>, t: number, lerp: (a: T, b: T, u: number) => T): T {
  if (!Array.isArray(keys)) return keys as T;
  const list = keys as readonly (T | { at: number; value: T })[];
  if (list.length === 0) throw new Error('keyframeAt: no keyframes');
  const stops = list.map((k, i) =>
    typeof k === 'object' && k !== null && 'at' in k
      ? k
      : { at: list.length === 1 ? 0 : i / (list.length - 1), value: k as T },
  );
  const tt = Math.min(1, Math.max(0, t));
  if (tt <= stops[0]!.at) return stops[0]!.value;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!;
    const b = stops[i]!;
    if (tt <= b.at) return b.at === a.at ? b.value : lerp(a.value, b.value, (tt - a.at) / (b.at - a.at));
  }
  return stops[stops.length - 1]!.value;
}

const lerpNumber = (a: number, b: number, u: number) => a + (b - a) * u;

/** A range field: the number itself, or a draw in [min, max] (one draw either way, so streams stay aligned). */
function drawRange(rng: Rng, v: number | readonly [number, number]): number {
  const u = rng.float();
  if (typeof v === 'number') return v;
  return v[0] + (v[1] - v[0]) * u;
}

/**
 * Sums over a particle's age `k` with drag factor `r` (1 - drag): `S` is how far a unit start
 * speed carries it (r + r^2 + ... + r^k), `G` how far a unit gravity does.
 */
function travel(k: number, r: number): { s: number; g: number } {
  if (r === 1) return { s: k, g: (k * (k + 1)) / 2 };
  const s = (r * (1 - r ** k)) / (1 - r);
  return { s, g: (k - s) / (1 - r) };
}

export class ParticleSystem {
  private readonly seed: number;
  private readonly max: number;
  private emitters: Emitter[] = [];
  /** Attached emitters by key, while they spawn. */
  private readonly attached = new Map<string, Emitter>();
  /** The last frame stepped, or null before the first. */
  private now: number | null = null;
  /** Emits started on one frame, to give each its own stream. */
  private emitted = 0;
  private emittedOn: number | null = null;

  constructor(opts: ParticleSystemOptions = {}) {
    this.seed = opts.seed ?? 0;
    this.max = opts.max ?? PARTICLE_SYSTEM_MAX;
  }

  /** The last frame stepped (null before the first `update`). */
  get frame(): number | null {
    return this.now;
  }

  /** How many particles are alive. */
  get count(): number {
    let n = 0;
    for (const e of this.emitters) n += e.particles.length;
    return n;
  }

  /** How many emitters are running or still have particles. */
  get emitterCount(): number {
    return this.emitters.length;
  }

  /** Drops every emitter and particle (a new level, a frame number that went back). */
  clear(): void {
    this.emitters = [];
    this.attached.clear();
    this.now = null;
  }

  /**
   * Starts emitter `name` (`def`) at world point `at` on `frame`: its `burst` is made on that frame
   * and its `rate` runs for `duration` frames. With `follow`, it moves with that entity while it
   * runs (`anchor` and `offset` applied). Call before `update(frame)`.
   */
  emit(name: string, def: EmitterDef, at: { x: number; y: number }, frame: number, follow?: string): void {
    if (this.now !== null && frame < this.now) this.clear();
    if (this.emittedOn !== frame) {
      this.emittedOn = frame;
      this.emitted = 0;
    }
    const key = `${name}:${frame}:${this.emitted++}`;
    const until = def.rate === undefined ? frame + 1 : frame + (def.duration ?? EMITTER_DEFAULTS.duration);
    this.emitters.push(this.make(key, name, def, at, frame, until, def.follow ? follow : undefined));
  }

  /**
   * Keeps emitter `name` running on entity `id` from `frame` on (a skin kind's `emit`): the first
   * call starts it, later calls with the same id and name do nothing. It follows the entity
   * through `update`'s `locate` and stops spawning the first frame the entity is gone; its live
   * particles finish their lives.
   */
  attach(id: string, name: string, def: EmitterDef, box: ParticleAnchorBox, frame: number): void {
    if (this.now !== null && frame < this.now) this.clear();
    const key = `${name}@${id}`;
    if (this.attached.has(key)) return;
    const e = this.make(key, name, def, anchorPoint(box, def.anchor), frame, Infinity, id);
    this.attached.set(key, e);
    this.emitters.push(e);
  }

  /**
   * Steps every frame after the last one up to `frame` (at most {@link PARTICLE_CATCH_UP}): moves
   * followers to their entity (`locate`), stops those whose entity is gone, spawns bursts and
   * rates, and drops dead particles and finished emitters. A frame not after the last one does
   * nothing; one before it clears the system first (a new level's frames start again).
   */
  update(frame: number, locate: ParticleLocate = () => undefined): void {
    if (!Number.isInteger(frame))
      throw new Error(`ParticleSystem: frame must be a whole number, got ${frame}`);
    if (this.now !== null && frame < this.now) this.clear();
    if (this.now === frame) return;
    // The first update starts from the earliest emitter started before it.
    let from = this.now === null ? Math.min(frame, ...this.emitters.map((e) => e.start)) : this.now + 1;
    if (frame - from + 1 > PARTICLE_CATCH_UP) from = frame - PARTICLE_CATCH_UP + 1;
    for (const e of this.emitters) {
      if (e.follow === undefined) continue;
      const box = locate(e.follow);
      if (box === undefined) {
        e.stopped = true;
        continue;
      }
      const p = anchorPoint(box, e.def.anchor);
      e.x = p.x;
      e.y = p.y;
    }
    for (let f = from; f <= frame; f++) this.step(f);
    this.now = frame;
  }

  /** The live particles at the last stepped frame, emitter by emitter in start order. */
  particles(): ParticleView[] {
    const out: ParticleView[] = [];
    const f = this.now;
    if (f === null) return out;
    for (const e of this.emitters) {
      const d = e.def;
      const r = 1 - (d.drag ?? 0);
      const gravity = d.gravity ?? 0;
      for (const p of e.particles) {
        const age = f - p.born;
        const t = p.life <= 1 ? 0 : age / (p.life - 1);
        const { s, g } = travel(age, r);
        const view: ParticleView = {
          emitter: e.name,
          x: p.x0 + p.vx * s,
          y: p.y0 + p.vy * s + gravity * g,
          size: keyframeAt(d.size ?? EMITTER_DEFAULTS.size, t, lerpNumber),
          color: keyframeAt(d.color ?? EMITTER_DEFAULTS.color, t, lerpColor),
          alpha: keyframeAt(d.alpha ?? EMITTER_DEFAULTS.alpha, t, lerpNumber),
          blend: d.blend ?? 'normal',
          glow: d.glow ?? 0,
          age,
          life: p.life,
        };
        if (d.frame !== undefined) view.frame = d.frame;
        if (d.sheet !== undefined) view.sheet = d.sheet;
        out.push(view);
      }
    }
    return out;
  }

  private make(
    key: string,
    name: string,
    def: EmitterDef,
    at: { x: number; y: number },
    start: number,
    until: number,
    follow: string | undefined,
  ): Emitter {
    return {
      key,
      name,
      def,
      x: at.x,
      y: at.y,
      follow,
      start,
      until,
      carry: 0,
      stopped: false,
      particles: [],
    };
  }

  private step(f: number): void {
    let alive = this.count;
    const kept: Emitter[] = [];
    for (const e of this.emitters) {
      const before = e.particles.length;
      e.particles = e.particles.filter((p) => f - p.born < p.life);
      alive -= before - e.particles.length;
      if (f >= e.start && f < e.until && !e.stopped) {
        let n = f === e.start ? (e.def.burst ?? 0) : 0;
        if (e.def.rate !== undefined) {
          e.carry += e.def.rate;
          const whole = Math.floor(e.carry);
          e.carry -= whole;
          n += whole;
        }
        if (n > 0) alive += this.spawn(e, f, n, alive);
      }
      const done = e.stopped || f + 1 >= e.until;
      if (done && e.particles.length === 0) {
        if (this.attached.get(e.key) === e) this.attached.delete(e.key);
        continue;
      }
      kept.push(e);
    }
    this.emitters = kept;
  }

  /** Makes up to `n` particles of `e` on frame `f`, within both caps; returns how many. */
  private spawn(e: Emitter, f: number, n: number, alive: number): number {
    const d = e.def;
    const room = Math.min(n, (d.max ?? EMITTER_DEFAULTS.max) - e.particles.length, this.max - alive);
    if (room <= 0) return 0;
    const rng = fxRng(this.seed, f, `particles:${e.key}`);
    const angle = d.angle ?? EMITTER_DEFAULTS.angle;
    const ox = e.x + (d.offset?.x ?? 0);
    const oy = e.y + (d.offset?.y ?? 0);
    for (let i = 0; i < room; i++) {
      // Each particle draws the same five numbers in the same order, whatever the def says.
      const life = Math.max(1, Math.round(drawRange(rng, d.life ?? EMITTER_DEFAULTS.life)));
      const speed = drawRange(rng, d.speed ?? EMITTER_DEFAULTS.speed);
      let turn: number;
      const ua = rng.float();
      const [lo, hi] = typeof angle === 'number' ? [angle, angle] : angle;
      // In turns, so a full even ring is exactly i / n of a turn.
      if (d.even) turn = lo / 360 + (i / n) * ((hi - lo) / 360);
      else turn = lo / 360 + ua * ((hi - lo) / 360);
      const rad = turn * Math.PI * 2;
      const [px, py] = this.shapePoint(rng, d.shape);
      e.particles.push({
        x0: ox + px,
        y0: oy + py,
        vx: speed * Math.cos(rad),
        vy: speed * Math.sin(rad),
        born: f,
        life,
      });
    }
    return room;
  }

  /** A point in the emitter's shape round (0, 0): two draws always. */
  private shapePoint(rng: Rng, shape: EmitterDef['shape']): [number, number] {
    const a = rng.float();
    const b = rng.float();
    if (shape === undefined || shape === 'point') return [0, 0];
    if ('circle' in shape) {
      const r = shape.circle * Math.sqrt(a);
      const th = b * Math.PI * 2;
      return [r * Math.cos(th), r * Math.sin(th)];
    }
    return [(a - 0.5) * shape.box.w, (b - 0.5) * shape.box.h];
  }
}
