import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessOptions } from '@engine/core/headless';
import type { ViewGame } from '@engine/core/view';
import { createGame } from './headless';
import { siegeCanvasPicture, siegeFrames, siegeLook, type SiegePicture } from './picture';

/**
 * The view entry (named by `view` in `game.json`), for `pnpm cli screenshot` and the backend
 * parity test: the headless game plus `render` (the kits' frames through the Canvas2D backend and
 * the two skins, `siegeCanvasPicture`) and `frame()` (the same frames for any presenter). It takes
 * a run file's orders and mission steps like the headless game (`order`, `mission`), so a
 * screenshot at a tick inside the played round shows the room, and one after the commit the
 * battle as the result left it. The camera is the map's centre (the road between the village and
 * the raiders' camp); no selection. No loop: the screenshot page steps it.
 */
export function createView(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): ViewGame {
  const game = createGame(content, seed, opts);
  const look = siegeLook(content);
  const frames = siegeFrames(content);
  let picture: { r: Parameters<ViewGame['render']>[0]; p: SiegePicture } | null = null;
  // The host's events since the last draw (its mission events, gap M21), for the skins' sounds.
  const events: unknown[] = [];
  const take = () => events.splice(0);
  return {
    step: (input) => {
      game.step(input);
      events.push(...game.events);
    },
    snapshot: () => game.snapshot(),
    order: (order) => game.order(order),
    mission: (step) => game.mission(step),
    missionExperience: () => game.missionExperience(),
    miniGame: () => game.miniGame(),
    screen: look.screen,
    render(r) {
      if (picture?.r !== r) picture = { r, p: siegeCanvasPicture(r, content, look) };
      picture.p.draw(game, take());
    },
    frame: () => frames.next(game, take()),
  };
}
