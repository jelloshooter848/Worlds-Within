import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessOptions, JsonObject } from '@engine/core/headless';
import type { ViewGame } from '@engine/core/view';
import { createGame } from './headless';
import { skirmishCanvasPicture, skirmishFrames, skirmishLook, type SkirmishPicture } from './picture';

/**
 * The view entry (named by `view` in `game.json`), for `pnpm cli screenshot` and the backend
 * parity test: the headless game plus `render` (the kit's frames through the Canvas2D backend and
 * the skin, `skirmishCanvasPicture`) and `frame()` (the same frames for any presenter). It takes
 * recorded orders like the headless game (`order`), so a screenshot of a battle shows the battle.
 * The world has no events, and the frames show no selection: the camera is the map's centre. No
 * loop: the screenshot page steps it.
 */
export function createView(
  content: ContentBundle,
  seed: number,
  opts: HeadlessOptions = {},
): ViewGame & { order(order: JsonObject): string | null } {
  const game = createGame(content, seed, opts);
  const look = skirmishLook(content);
  const frames = skirmishFrames(look.screen);
  let picture: { r: Parameters<ViewGame['render']>[0]; p: SkirmishPicture } | null = null;
  return {
    step: (input) => game.step(input),
    snapshot: () => game.snapshot(),
    order: (order) => game.order(order),
    screen: look.screen,
    render(r) {
      if (picture?.r !== r) picture = { r, p: skirmishCanvasPicture(r, look) };
      picture.p.draw(game.rts, []);
    },
    frame: () => frames.next(game.rts, []),
    background: look.background,
  };
}
