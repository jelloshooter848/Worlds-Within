import type { ContentBundle } from './content/bundle';
import type { Renderer } from './gfx/renderer';
import type { ScreenSize } from './gfx/screen';
import type { HeadlessGame, HeadlessOptions } from './headless';
import type { DeepReadonly, PresentFrame } from './present';

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
