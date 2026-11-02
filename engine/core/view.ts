import type { ContentBundle } from './content/bundle';
import type { Renderer } from './gfx/renderer';
import type { ScreenSize } from './gfx/screen';
import type { HeadlessGame, HeadlessOptions } from './headless';
import { PendingEvents } from './present/stream';
import type { DeepReadonly, PresentFrame } from './present/types';

/**
 * The view contract: the headless game plus a way to draw it, so the tools (`pnpm cli
 * screenshot`) can play a run in a browser and draw one paused frame. A game names the module
 * that exports it in `game.json` (`view`); the screenshot page loads that module by its path at run
 * time.
 *
 *   export function createView(content: ContentBundle, seed: number, opts?: HeadlessOptions): ViewGame
 *
 * The page steps the view exactly like `run` steps the headless game (one input frame per tick, no
 * clock, no audio), then calls `render` once onto a canvas of the game's picture size: `screen`,
 * which a view takes from its manifest (`content.manifest.screen`, 256x240 when `game.json`
 * names none) and the page checks against the size the CLI read. `step` and `snapshot` must
 * match the headless module's for the same content, seed and input: the screenshot result checks
 * the state hash against a headless run.
 *
 * A view may also give `frame()`: the presentation frame (`@engine/core/present`) for the state
 * now, so a tool can show the game through any `Presenter` (the Three.js backend, the null one)
 * instead of drawing it with `render`. A run uses one or the other, never both: each keeps its own
 * stream of frames (map tracker, animation clocks, events since the last call).
 */

/** A headless game that can also draw its current state. */
export interface ViewGame extends HeadlessGame {
  /** The picture size `render` draws onto (game px): the manifest's `screen`. */
  readonly screen: ScreenSize;
  /** Draws the state now onto `r` (the whole `screen`-sized picture). Must not change the game. */
  render(r: Renderer): void;
  /**
   * Optional: the frame for the state now, frozen, with the events since the last call (all of
   * them since the start on the first call), for a presenter to show. Must not change the game.
   * Used instead of `render`, never both in one run.
   */
  frame?(): DeepReadonly<PresentFrame>;
  /**
   * Optional: the colour behind the picture (CSS hex, such as `#5c94fc`) for a presenter that
   * shows `frame()` (the Three.js backend's clear colour); black when left out.
   */
  readonly background?: string;
}

/** What a game's view module (named by `view` in `game.json`) exports. */
export interface ViewEntry {
  createView(content: ContentBundle, seed: number, opts?: HeadlessOptions): ViewGame;
}

/**
 * What `frameView` needs (Engine 0.7, gap G26): a headless game that shows its `world` and the
 * `events` of its last step (a kit's level sequence does), the picture size, one stream of frames
 * for `frame()` (a `FrameStream` over the kit's `FrameSource`) and the drawer `render` draws
 * through, made once per renderer (a `FramePicture` onto a Canvas2D presenter on `r`).
 */
export interface FrameViewOptions<W extends object, E> {
  readonly game: HeadlessGame & { readonly world: W; readonly events: readonly E[] };
  readonly screen: ScreenSize;
  readonly frames: { next(world: W, events: readonly E[]): DeepReadonly<PresentFrame> };
  picture(r: Renderer): { draw(world: W, events: readonly E[]): unknown };
  readonly background?: string;
}

/**
 * A `ViewGame` over a headless game that has a world and a stream of frames: what each game's
 * `view.ts` had composed by hand. `step` steps the game and keeps its events until the next draw
 * (dropped when the world changes, as the page's `HostScene` does), `snapshot` is the game's,
 * `render(r)` draws the world now through `picture(r)` (made again only for a new renderer) and
 * `frame()` is `frames.next` with the events since the last call. A run uses one or the other, as
 * the view contract says, so they share the kept events.
 */
export function frameView<W extends object, E>(opts: FrameViewOptions<W, E>): ViewGame {
  const { game } = opts;
  const pending = new PendingEvents(game.world, game.events);
  let picture: { r: Renderer; p: ReturnType<FrameViewOptions<W, E>['picture']> } | null = null;
  return {
    step(input) {
      game.step(input);
      pending.add(game.world, game.events);
    },
    snapshot: () => game.snapshot(),
    screen: opts.screen,
    render(r) {
      if (picture?.r !== r) picture = { r, p: opts.picture(r) };
      picture.p.draw(game.world, pending.take());
    },
    frame: () => opts.frames.next(game.world, pending.take()),
    ...(opts.background !== undefined && { background: opts.background }),
  };
}
