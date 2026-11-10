import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessOptions } from '@engine/core/headless';
import { frameView, type ViewGame } from '@engine/core/view';
import { createGame } from './headless';
import { fxCanvasPicture, fxFrames, fxLook } from './picture';

/**
 * The view entry (named by `view` in `game.json`), for `pnpm cli screenshot`: the engine's
 * `frameView` over the headless game, drawing through `fxCanvasPicture` for `render` and giving
 * the same frames (`fxFrames`) for `frame()` (the 3D backend). No loop: the screenshot page steps it.
 */
export function createView(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): ViewGame {
  const look = fxLook(content);
  return frameView({
    game: createGame(content, seed, opts),
    screen: look.screen,
    frames: fxFrames(look.screen),
    picture: (r) => fxCanvasPicture(r, look),
  });
}
