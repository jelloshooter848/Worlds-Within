import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { HeadlessOptions } from '@engine/core/headless';
import type { ViewGame } from '@engine/core/view';
import type { PlatformerEvent, PlatformerWorld } from '@kits/platformer';
import { createGame } from './headless';
import { LabFrames, LabPicture, labLook, SKY } from './picture';

/**
 * The lab's view entry (named by `view` in `game.json`), for `pnpm cli screenshot`: the headless
 * game (`headless.ts`) plus the scene's drawing (`LabPicture`: the kit's frame through the
 * Canvas2D backend and the skin). No loop: the screenshot page steps it and draws every tick.
 * `frame()` gives the same frames (`LabFrames`) for any presenter, with the events since the last
 * call (dropped when the level changes, as the scene does), for the 3D backend, and `background`
 * is the sky the 3D page clears to.
 */
export function createView(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): ViewGame {
  const game = createGame(content, seed, opts);
  const look = labLook(content);
  let picture: { r: Renderer; p: LabPicture } | null = null;
  const frames = new LabFrames(look.screen);
  let pending: PlatformerEvent[] = [...game.events];
  let pendingOf: PlatformerWorld = game.world;
  return {
    step(input) {
      game.step(input);
      if (game.world !== pendingOf) {
        pendingOf = game.world;
        pending = [];
      }
      pending.push(...game.events);
    },
    snapshot: () => game.snapshot(),
    screen: look.screen,
    render(r) {
      if (picture?.r !== r) picture = { r, p: new LabPicture(r, look) };
      picture.p.draw(game.world, game.events);
    },
    frame: () => frames.next(game.world, pending.splice(0)),
    background: SKY,
  };
}
