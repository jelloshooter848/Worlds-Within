import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessOptions } from '@engine/core/headless';
import { frameView, type ViewGame } from '@engine/core/view';
import { createGame } from './headless';
import { tdCanvasPicture, tdFrameStream, tdLook } from './picture';

/**
 * The view entry (named by `view` in `game.json`), for `pnpm cli screenshot` and the backend
 * parity test: the headless game (`headless.ts`) through the engine's `frameView`, with `render`
 * drawing the kit's frames through the Canvas2D backend and the skin (`tdCanvasPicture`) and
 * `frame()` the same frames for any presenter. Both show the player's cursor and ghost tower, as
 * the page does. No loop and no sound: the screenshot page steps it.
 */
export function createView(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): ViewGame {
  const game = createGame(content, seed, opts);
  const look = tdLook(content);
  const cursor = () => game.controls.view();
  return frameView({
    game,
    screen: look.screen,
    frames: tdFrameStream(look.screen, cursor),
    picture: (r) => tdCanvasPicture(r, look, cursor),
  });
}
