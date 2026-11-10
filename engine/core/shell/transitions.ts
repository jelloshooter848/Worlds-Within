import {
  reducedMotion,
  transitionFor,
  TransitionPlayer,
  type TransitionSlot,
  type TransitionSpec,
  type TransitionsSpec,
  type TransitionView,
} from '../fx/transition';
import type { DeepReadonly, Presenter, PresentFrame } from '../present/types';
import type { Scene } from '../scene';

/**
 * The browser shell's screen transitions (docs/ROADMAP.md, Engine 0.16 part A, T5): which
 * transition plays when, and the picture held while it closes. The timing and shapes are
 * `../fx/transition.ts`; the displays draw the shape (`BrowserDisplay.transition`). Pure: no
 * clock, no DOM; the boot steps it once per loop step.
 *
 * - **Level change:** {@link ShellTransitions.presenter} wraps the display's presenter and starts
 *   the `level` transition when a frame's map id differs from the last one shown.
 * - **Scene push and pop:** the boot calls {@link ShellTransitions.scenes} after each loop step;
 *   a scene pushed or popped plays its `transitionSlot` (`scene` when it gives none; `HostScene`
 *   marks a mission round `mission`).
 * - **On demand:** {@link ShellTransitions.start} (the boot's `transition()`, T9's title and
 *   menus), with a `covered` callback run once the picture is fully covered.
 *
 * While a transition **closes** (its out half and hold) the presenter keeps showing the last frame
 * it showed before the change, so the cover closes over the old picture; the frames that came
 * meanwhile (the new level's first, with its full map and events) are shown, in order, once the
 * cover opens. The boot also holds the game's ticks while it closes, as a hit-pause does, so every
 * tick's state is the same as without it (in manual-loop mode it does not hold, so the step hook
 * stays tick-exact). Under reduced motion every transition is a short fade.
 */

export interface ShellTransitionOptions {
  /** The game's transitions by slot (`game.json`'s `transitions`); none when left out. */
  specs?: DeepReadonly<TransitionsSpec>;
  /** The player's reduced-motion setting: every transition becomes a short fade. */
  reduceMotion?: boolean;
}

/** What a transition is asked for by: a slot of the game's, or a spec of its own. */
export type TransitionRequest = TransitionSlot | DeepReadonly<TransitionSpec>;

/** Frames kept while the picture is held (more are dropped: a hold never runs that long). */
const HELD_FRAMES_MAX = 240;

export class ShellTransitions {
  private readonly player = new TransitionPlayer();
  private readonly specs: DeepReadonly<TransitionsSpec> | undefined;
  /** The player's reduced-motion setting (a settings screen may change it). */
  reduceMotion: boolean;

  constructor(opts: ShellTransitionOptions = {}) {
    this.specs = opts.specs;
    this.reduceMotion = opts.reduceMotion ?? false;
  }

  /** The spec a request plays (reduced motion applied), or null when the game gives none. */
  resolve(what: TransitionRequest): DeepReadonly<TransitionSpec> | null {
    const spec = typeof what === 'string' ? transitionFor(this.specs, what) : what;
    if (spec === null) return null;
    return this.reduceMotion ? reducedMotion(spec) : spec;
  }

  /**
   * Starts a transition (default the `default` slot); `covered` runs once the picture is fully
   * covered (the in half's first frame). False, and nothing starts, when the game gives no spec
   * for the slot or one is running already (then `covered` runs at once, so a caller's change
   * still happens).
   */
  start(what: TransitionRequest = 'default', covered?: () => void): boolean {
    const spec = this.player.running ? null : this.resolve(what);
    if (spec === null) {
      covered?.();
      return false;
    }
    this.player.start(spec, covered);
    return true;
  }

  /** One display frame on (the boot's loop step, held or not). */
  step(): void {
    this.player.step();
  }

  /** The transition on this frame, for the display to draw, or null. */
  view(): TransitionView | null {
    return this.player.view;
  }

  /** True while one runs. */
  get running(): boolean {
    return this.player.running;
  }

  /** True while it closes (out half and hold): the old picture is held and the ticks wait. */
  get closing(): boolean {
    return this.player.closing;
  }

  /**
   * After a loop step: a scene pushed (the top changed and the stack grew) plays the new top's
   * slot; a scene popped plays the popped one's.
   */
  scenes(
    before: { top: Scene | undefined; depth: number },
    after: { top: Scene | undefined; depth: number },
  ): void {
    if (before.top === after.top) return;
    const moved = after.depth > before.depth ? after.top : before.top;
    this.start(moved?.transitionSlot ?? 'scene');
  }

  /**
   * The display's presenter wrapped: it starts the `level` transition on a new map id, holds the
   * last frame while a transition closes, and hands `show` the transition before each frame it
   * presents (the display draws it over that picture).
   */
  presenter(inner: Presenter, show: (view: TransitionView | null) => void): Presenter {
    return new TransitionPresenter(this, inner, show);
  }

  clear(): void {
    this.player.clear();
  }
}

type Frame = DeepReadonly<PresentFrame>;

/** See {@link ShellTransitions.presenter}. */
class TransitionPresenter implements Presenter {
  private mapId: string | null = null;
  /** The last frame shown to `inner` (held while a transition closes). */
  private last: Frame | null = null;
  /** Frames that came while it was held, still to show (those with a full map or events). */
  private held: Frame[] = [];

  constructor(
    private readonly transitions: ShellTransitions,
    private readonly inner: Presenter,
    private readonly show: (view: TransitionView | null) => void,
  ) {}

  present(frame: Frame): void {
    const id = frame.map?.id ?? null;
    if (id !== null) {
      if (this.mapId !== null && id !== this.mapId) this.transitions.start('level');
      this.mapId = id;
    }
    this.show(this.transitions.view());
    if (this.transitions.closing && this.last !== null) {
      if (this.held.length < HELD_FRAMES_MAX && (frame.events.length > 0 || isFull(frame)))
        this.held.push(frame);
      this.inner.present(this.last);
      return;
    }
    for (const f of this.held.splice(0)) this.inner.present(f);
    this.inner.present(frame);
    this.last = frame;
  }

  resize(size: Parameters<NonNullable<Presenter['resize']>>[0]): void {
    this.inner.resize?.(size);
  }
}

function isFull(frame: Frame): boolean {
  return frame.map !== undefined && 'tiles' in frame.map;
}
