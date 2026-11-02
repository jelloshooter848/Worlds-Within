import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessOptions } from '@engine/core/headless';
import { frameView, type ViewGame } from '@engine/core/view';
import { createGame } from './headless';
import { SKY, testCanvasPicture, testFrames, testLook } from './picture';

/**
 * The view entry (named by `view` in `game.json`), for `pnpm cli screenshot`: the engine's
 * `frameView` over the headless game, drawing through `testCanvasPicture` (the kits' frames
 * through the Canvas2D backend and the game's skins, the round's skin while the door's round
 * runs) for `render`, and the same frames (`testFrames`) for `frame()`. No loop: the screenshot
 * page steps it.
 */
export function createView(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): ViewGame {
  const look = testLook(content);
  return frameView({
    game: createGame(content, seed, opts),
    screen: look.screen,
    frames: testFrames(look.screen),
    picture: (r) => testCanvasPicture(r, look),
    background: SKY,
  });
}
