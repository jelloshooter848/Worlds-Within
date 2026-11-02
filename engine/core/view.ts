import type { ContentBundle } from './content/bundle';
import type { Renderer } from './gfx/renderer';
import type { HeadlessGame, HeadlessOptions } from './headless';

/**
 * The view contract: the headless game plus a way to draw it, so the tools (`pnpm cli
 * screenshot`) can play a run in a browser and draw one paused frame. A game names the module
 * that exports it in `game.json` (`view`); the screenshot page loads that module by its path at run
 * time.
 *
 *   export function createView(content: ContentBundle, seed: number, opts?: HeadlessOptions): ViewGame
 *
 * The page steps the view exactly like `run` steps the headless game (one input frame per tick, no
 * clock, no audio), then calls `render` once onto the 256x240 picture. `step` and `snapshot` must
 * match the headless module's for the same content, seed and input: the screenshot result checks
 * the state hash against a headless run.
 */

/** A headless game that can also draw its current state. */
export interface ViewGame extends HeadlessGame {
  /** Draws the state now onto `r` (the whole 256x240 picture). Must not change the game. */
  render(r: Renderer): void;
}

/** What a game's view module (named by `view` in `game.json`) exports. */
export interface ViewEntry {
  createView(content: ContentBundle, seed: number, opts?: HeadlessOptions): ViewGame;
}
