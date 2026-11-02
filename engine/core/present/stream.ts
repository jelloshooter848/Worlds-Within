import { freezeFrame } from './freeze';
import type { DeepReadonly, Presenter, PresentFrame } from './types';

/**
 * Streams of frames (Engine 0.7, gap G21 in docs/reports/stacking-test.md): the per-frame glue every
 * game with a kit world had written by hand. A kit's `presentWorld` needs stream state that lives
 * as long as one world (a map tracker, animation clocks, the last frame's entities); a game swaps
 * worlds (the next level, the same level again), so the stream starts afresh on a new world, and
 * the events gathered since the last frame belong to the world that made them. Pure: no clock, no
 * DOM, no kit or backend code (a kit hands its own `FrameSource`).
 */

/** How a kit presents its world: fresh stream state for a new world, and one frame from it. */
export interface FrameSource<W, E, S> {
  /** The stream state for a world shown for the first time. */
  start(world: W): S;
  /** The frame for `world` now, with the events since the last frame. */
  present(world: W, events: readonly E[], state: S): PresentFrame;
}

/**
 * One stream of frozen frames for any presenter: `next(world, events)` presents through the
 * source with one stream state per world (a new world object starts a new state).
 */
export class FrameStream<W extends object, E, S> {
  private world: W | null = null;
  private state: S | null = null;

  constructor(private readonly source: FrameSource<W, E, S>) {}

  /** The frame for `world` now, frozen, with the events since the last frame. */
  next(world: W, events: readonly E[]): DeepReadonly<PresentFrame> {
    if (this.world !== world || this.state === null) {
      this.world = world;
      this.state = this.source.start(world);
    }
    return freezeFrame(this.source.present(world, events, this.state));
  }
}

/**
 * The events since the last frame, for a game that can step several times between two frames:
 * `add(world, events)` after each step keeps them, dropping any kept for an older world (they
 * belong to a level that is gone); `take()` hands them over and empties the list.
 */
export class PendingEvents<W extends object, E> {
  private events: E[];

  constructor(
    private world: W,
    initial: readonly E[] = [],
  ) {
    this.events = [...initial];
  }

  /** Keeps a step's events; a new `world` drops the ones kept so far. */
  add(world: W, events: readonly E[]): void {
    if (world !== this.world) {
      this.world = world;
      this.events = [];
    }
    this.events.push(...events);
  }

  /** The events kept since the last `take`, oldest first; the list is empty afterwards. */
  take(): E[] {
    return this.events.splice(0);
  }
}

/** One stream of frames onto one presenter (Canvas2D, Three.js, null...). */
export class FramePicture<W extends object, E> {
  constructor(
    private readonly frames: { next(world: W, events: readonly E[]): DeepReadonly<PresentFrame> },
    readonly presenter: Presenter,
  ) {}

  /** Presents `world` now, with the events since the last draw; returns the frame it presented. */
  draw(world: W, events: readonly E[]): DeepReadonly<PresentFrame> {
    const frame = this.frames.next(world, events);
    this.presenter.present(frame);
    return frame;
  }
}
