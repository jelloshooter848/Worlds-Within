import { lerpColor } from './color';
import { ease } from './ease';
import {
  TWEEN_DEFAULT_AMOUNT,
  TWEEN_DEFAULT_FROM_COLOR,
  TWEEN_REST,
  type TweenSpec,
  type TweensSpec,
} from './schema';

/**
 * Tweens driven by presentation frames (docs/ROADMAP.md, Engine 0.16 part A). Everything is a
 * function of the frame number, never of a clock, so the same frames always give the same
 * picture. Pure; a tween lives in a presenter (or a UI widget), never in a world, a frame or a hash.
 */

/** What a set of tweens does to one entity this frame, on top of its own look. */
export interface TweenState {
  /** World px added to the entity's position. */
  x: number;
  y: number;
  /** Factors on the drawn width and height. */
  scaleX: number;
  scaleY: number;
  /** Degrees added to its turn, clockwise. */
  rotate: number;
  /** A factor on its opacity. */
  alpha: number;
  /** The overlay colour (`#rrggbb`), or null for none. */
  color: string | null;
  /** How strongly the overlay covers it, 0 to 1. */
  colorAmount: number;
}

/** A state that changes nothing. */
export const REST_STATE: Readonly<TweenState> = Object.freeze({
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotate: 0,
  alpha: 1,
  color: null,
  colorAmount: 0,
});

/** One running tween: a spec started on a frame. */
export class Tween {
  /** Frames from `start` to the end (delay included); Infinity for a `forever` tween. */
  readonly length: number;

  constructor(
    readonly spec: TweenSpec,
    readonly start: number,
    readonly onDone?: () => void,
  ) {
    const cycle = spec.frames * (spec.yoyo === true ? 2 : 1);
    const plays = spec.repeat === 'forever' ? Infinity : 1 + (spec.repeat ?? 0);
    this.length = (spec.delay ?? 0) + cycle * plays;
  }

  /** Whether it has ended by `frame` (the frame `start + length` and later). */
  done(frame: number): boolean {
    return frame - this.start >= this.length;
  }

  /**
   * The raw progress at `frame`, 0 to 1 before easing: 0 before the start and in the delay; then
   * up (and down again under `yoyo`) once per play, a new play starting from 0; after the end,
   * where the last play stopped (1, or 0 under `yoyo`).
   */
  progress(frame: number): number {
    const { frames, yoyo } = this.spec;
    const local = frame - this.start - (this.spec.delay ?? 0);
    if (local <= 0) return 0;
    if (this.done(frame)) return yoyo === true ? 0 : 1;
    const cycle = frames * (yoyo === true ? 2 : 1);
    const within = local % cycle;
    return yoyo === true && within > frames ? (cycle - within) / frames : within / frames;
  }

  /** The tweened value at `frame`: a number, or `#rrggbb` for `color`. */
  value(frame: number): number | string {
    const t = ease(this.spec.ease, this.progress(frame));
    const spec = this.spec;
    if (spec.prop === 'color') return lerpColor(spec.from ?? TWEEN_DEFAULT_FROM_COLOR, spec.to, t);
    const from = spec.from ?? TWEEN_REST[spec.prop];
    return from + (spec.to - from) * t;
  }

  /** Lays this tween's value at `frame` onto `state` (offsets add, factors multiply, colour replaces). */
  applyTo(state: TweenState, frame: number): void {
    const spec = this.spec;
    const v = this.value(frame);
    if (spec.prop === 'color') {
      state.color = v as string;
      state.colorAmount = spec.amount ?? TWEEN_DEFAULT_AMOUNT;
      return;
    }
    const n = v as number;
    switch (spec.prop) {
      case 'x':
      case 'y':
      case 'rotate':
        state[spec.prop] += n;
        break;
      case 'scale':
        state.scaleX *= n;
        state.scaleY *= n;
        break;
      case 'scaleX':
      case 'scaleY':
      case 'alpha':
        state[spec.prop] *= n;
        break;
    }
  }
}

/** A tween spec or a list of them as a list. */
export function tweenList(specs: TweensSpec | readonly TweenSpec[]): readonly TweenSpec[] {
  return Array.isArray(specs) ? specs : [specs as TweenSpec];
}

/**
 * The tweens on one thing (an entity, a widget). `add` starts specs on a frame, `update(frame)`
 * drops the ended ones (calling each one's `onDone` once, in the order they were added), and
 * `state(frame)` combines the running ones in that order. An ended tween stops counting: the
 * thing goes back to its own look.
 */
export class TweenSet {
  private tweens: Tween[] = [];

  /** Starts each spec on `start`; `onDone` (if any) is called once for each when it ends. */
  add(specs: TweensSpec | readonly TweenSpec[], start: number, onDone?: () => void): void {
    for (const spec of tweenList(specs)) this.tweens.push(new Tween(spec, start, onDone));
  }

  /** Drops the tweens that have ended by `frame`, calling their `onDone`. */
  update(frame: number): void {
    const ended = this.tweens.filter((t) => t.done(frame));
    if (ended.length === 0) return;
    this.tweens = this.tweens.filter((t) => !t.done(frame));
    for (const t of ended) t.onDone?.();
  }

  /** The combined state of the tweens still running at `frame` (ended ones are skipped). */
  state(frame: number): TweenState {
    const state: TweenState = { ...REST_STATE };
    for (const t of this.tweens) if (!t.done(frame)) t.applyTo(state, frame);
    return state;
  }

  /** How many tweens it holds (ended ones count until `update` drops them). */
  get size(): number {
    return this.tweens.length;
  }

  clear(): void {
    this.tweens = [];
  }
}
