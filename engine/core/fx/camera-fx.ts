import type { SkinFile } from '../present/skin';
import type { DeepReadonly } from '../present/types';
import { ease } from './ease';
import { fxRng } from './rng';
import type { FlashSpec, ShakeSpec, ZoomSpec } from './schema';

/**
 * Camera effects for one presenter (docs/ROADMAP.md, Engine 0.16 part A, T4): trauma shake, zoom
 * punches and screen flashes, started by a skin's event entries (`shake`, `zoom`, `flash`) and
 * read once per presentation frame with {@link CameraFx.state}. Pure and fixed-step: every value
 * is a function of the seed, the frame number and the effects started, so a screenshot at a tick
 * is byte-stable. Presenter state only: it never reaches a world, a frame or a hash.
 *
 * - Shake: each shake is trauma `1 - age / ticks` that decays to 0 at `ticks`; its strength is
 *   `amount * trauma²` (picture px), and running shakes add up. The offset is that strength times
 *   noise in [-1, 1) on each axis from `fxRng(seed, frame, 'camera-shake')`, so a frame always
 *   shakes the same way. Whole picture px unless `subPixel` (off: pixel art stays on the grid).
 *   The player's `shakeScale` (0..1) scales it; 0 turns shaking off.
 * - Zoom: a punch goes from 1 to `to` over `ticks` with `ease`, holds `hold`, then back to 1 over
 *   `back` (default `ticks`) with the curve played backwards; punches running together multiply,
 *   the product held between `1 / FX_ZOOM_MAX` and `FX_ZOOM_MAX` (polish Q, Q7: a battle's dozens
 *   of punches at once multiplied past any picture).
 * - Flash: `color` at `alpha` fading linearly to 0 over `ticks`; none with `reduceFlashing`.
 */

/**
 * The most the zoom punches running together may zoom in (and `1 / FX_ZOOM_MAX` out): their
 * product is held to it, so a crowd of events on one frame (a big battle's hits and footsteps)
 * cannot multiply the zoom past any picture (Engine 0.16 polish Q, Q7).
 */
export const FX_ZOOM_MAX = 4;

/** The flash colour when a flash gives none. */
export const FLASH_DEFAULT_COLOR = '#fcfcfc';

/** The player's presentation settings camera effects honour (T9's settings screen sets them). */
export interface CameraFxSettings {
  /** Skip flashes (the reduced-flashing setting). */
  reduceFlashing?: boolean;
  /** Shake strength, 0 (off) to 1 (full, the default). */
  shakeScale?: number;
}

export interface CameraFxOptions {
  /** The seed shake noise draws from (`fxRng`; default 0). */
  seed?: number;
  /** Keep shake offsets fractional instead of whole picture px (default false, for pixel art). */
  subPixel?: boolean;
}

/** What the camera effects do on one frame. */
export interface CameraFxState {
  /** The shake offset in picture px (whole unless `subPixel`). */
  shakeX: number;
  shakeY: number;
  /** The zoom factor on top of the camera's own zoom (1: none). */
  zoom: number;
  /** The flashes to lay over the picture, oldest first. */
  flashes: { color: string; alpha: number }[];
}

type Timed<T> = { spec: DeepReadonly<T>; start: number };
type EventEntry = DeepReadonly<NonNullable<SkinFile['events']>[string]>;

/** A shake's strength in picture px `age` frames after it started (0 once it has decayed). */
export function shakeStrength(spec: DeepReadonly<ShakeSpec>, age: number): number {
  if (age < 0 || age >= spec.ticks) return 0;
  const trauma = 1 - age / spec.ticks;
  return spec.amount * trauma * trauma;
}

/** Frames a zoom punch lasts, there and back. */
export function zoomLength(spec: DeepReadonly<ZoomSpec>): number {
  return spec.ticks + (spec.hold ?? 0) + (spec.back ?? spec.ticks);
}

/** A zoom punch's factor `age` frames after it started (1 before it and once it is back). */
export function zoomFactor(spec: DeepReadonly<ZoomSpec>, age: number): number {
  if (age < 0 || age >= zoomLength(spec)) return 1;
  const span = spec.to - 1;
  if (age < spec.ticks) return 1 + span * ease(spec.ease, age / spec.ticks);
  const back = age - spec.ticks - (spec.hold ?? 0);
  if (back < 0) return spec.to;
  return 1 + span * ease(spec.ease, 1 - back / (spec.back ?? spec.ticks));
}

/** A flash's opacity `age` frames after it started (0 once it has faded). */
export function flashAlpha(spec: DeepReadonly<FlashSpec>, age: number): number {
  if (age < 0 || age >= spec.ticks) return 0;
  return (spec.alpha ?? 1) * (1 - age / spec.ticks);
}

export class CameraFx {
  private readonly seed: number;
  private readonly subPixel: boolean;
  private shakes: Timed<ShakeSpec>[] = [];
  private zooms: Timed<ZoomSpec>[] = [];
  private flashList: Timed<FlashSpec>[] = [];

  constructor(opts: CameraFxOptions = {}) {
    this.seed = opts.seed ?? 0;
    this.subPixel = opts.subPixel ?? false;
  }

  shake(spec: DeepReadonly<ShakeSpec>, frame: number): void {
    this.shakes.push({ spec, start: frame });
  }

  zoom(spec: DeepReadonly<ZoomSpec>, frame: number): void {
    this.zooms.push({ spec, start: frame });
  }

  flash(spec: DeepReadonly<FlashSpec>, frame: number): void {
    this.flashList.push({ spec, start: frame });
  }

  /** Starts an event entry's `shake`, `zoom` and `flash` (whichever it gives) on `frame`. */
  event(entry: EventEntry, frame: number): void {
    if (entry.shake !== undefined) this.shake(entry.shake, frame);
    if (entry.zoom !== undefined) this.zoom(entry.zoom, frame);
    if (entry.flash !== undefined) this.flash(entry.flash, frame);
  }

  /**
   * Drops the effects that have ended by `frame`, and every effect started after it (a frame
   * number that went back is a new level).
   */
  update(frame: number): void {
    const live = <T>(list: Timed<T>[], length: (s: DeepReadonly<T>) => number) =>
      list.filter((t) => frame >= t.start && frame - t.start < length(t.spec));
    this.shakes = live(this.shakes, (s) => s.ticks);
    this.zooms = live(this.zooms, zoomLength);
    this.flashList = live(this.flashList, (s) => s.ticks);
  }

  /** How many effects are running (after the last `update`). */
  get size(): number {
    return this.shakes.length + this.zooms.length + this.flashList.length;
  }

  clear(): void {
    this.shakes = [];
    this.zooms = [];
    this.flashList = [];
  }

  /** The shake offset, zoom factor and flashes on `frame`, under the player's `settings`. */
  state(frame: number, settings: CameraFxSettings = {}): CameraFxState {
    const scale = Math.min(1, Math.max(0, settings.shakeScale ?? 1));
    let strength = 0;
    for (const s of this.shakes) strength += shakeStrength(s.spec, frame - s.start);
    let shakeX = 0;
    let shakeY = 0;
    if (strength > 0 && scale > 0) {
      const rng = fxRng(this.seed, frame, 'camera-shake');
      const nx = rng.float() * 2 - 1;
      const ny = rng.float() * 2 - 1;
      shakeX = strength * scale * nx;
      shakeY = strength * scale * ny;
      // `+ 0` turns a rounded -0 into 0.
      if (!this.subPixel) {
        shakeX = Math.round(shakeX) + 0;
        shakeY = Math.round(shakeY) + 0;
      }
    }
    let zoom = 1;
    for (const z of this.zooms) zoom *= zoomFactor(z.spec, frame - z.start);
    zoom = Math.min(FX_ZOOM_MAX, Math.max(1 / FX_ZOOM_MAX, zoom));
    const flashes: CameraFxState['flashes'] = [];
    if (!settings.reduceFlashing) {
      for (const f of this.flashList) {
        const alpha = flashAlpha(f.spec, frame - f.start);
        if (alpha > 0) flashes.push({ color: f.spec.color ?? FLASH_DEFAULT_COLOR, alpha });
      }
    }
    return { shakeX, shakeY, zoom, flashes };
  }
}
