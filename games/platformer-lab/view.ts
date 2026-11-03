import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessOptions } from '@engine/core/headless';
import { frameView, type ViewGame } from '@engine/core/view';
import { createGame } from './headless';
import { labCanvasPicture, labFrames, labLook } from './picture';

/**
 * The lab's view entry (named by `view` in `game.json`), for `pnpm cli screenshot`: the engine's
 * `frameView` over the headless game (`headless.ts`), drawing through `labCanvasPicture` (the
 * kit's frame through the Canvas2D backend and the skin) for `render`, and giving the same frames
 * (`labFrames`) for `frame()`, with the events since the last call, for the 3D backend.
 * The sky is the skin's `background` (gap G36), which both backends clear to. No loop: the screenshot page steps it.
 */
export function createView(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): ViewGame {
  const look = labLook(content);
  return frameView({
    game: createGame(content, seed, opts),
    screen: look.screen,
    frames: labFrames(look.screen),
    picture: (r) => labCanvasPicture(r, look),
  });
}
