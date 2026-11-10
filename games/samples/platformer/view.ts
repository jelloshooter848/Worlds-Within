import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessOptions } from '@engine/core/headless';
import { frameView, type ViewGame } from '@engine/core/view';
import { createGame } from './headless';
import { hopperCanvasPicture, hopperFrames, hopperLook } from './picture';

/**
 * The view entry (named by `view` in `game.json`), for `pnpm cli screenshot`: the engine's
 * `frameView` over the headless game, drawing through `hopperCanvasPicture` (the kit's frames
 * through the Canvas2D backend and the game's skin) for `render`, and the same frames
 * (`hopperFrames`) for `frame()`. No loop: the screenshot page steps it.
 */
export function createView(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): ViewGame {
  const look = hopperLook(content);
  return frameView({
    game: createGame(content, seed, opts),
    screen: look.screen,
    frames: hopperFrames(look.screen),
    picture: (r) => hopperCanvasPicture(r, look),
  });
}
