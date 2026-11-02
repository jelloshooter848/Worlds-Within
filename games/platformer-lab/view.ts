import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { HeadlessOptions } from '@engine/core/headless';
import type { ViewGame } from '@engine/core/view';
import { createGame } from './headless';
import { LabPicture, labLook } from './picture';

/**
 * The lab's view entry (named by `view` in `game.json`), for `pnpm cli screenshot`: the headless
 * game (`headless.ts`) plus the scene's drawing (`LabPicture`: the kit's frame through the
 * Canvas2D backend and the skin). No loop: the screenshot page steps it and draws every tick.
 */
export function createView(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): ViewGame {
  const game = createGame(content, seed, opts);
  const look = labLook(content);
  let picture: { r: Renderer; p: LabPicture } | null = null;
  return {
    step: (input) => game.step(input),
    snapshot: () => game.snapshot(),
    screen: look.screen,
    render(r) {
      if (picture?.r !== r) picture = { r, p: new LabPicture(r, look) };
      picture.p.draw(game.world, game.events);
    },
  };
}
