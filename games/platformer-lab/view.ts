import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { HeadlessOptions } from '@engine/core/headless';
import { PendingEvents } from '@engine/core/present';
import type { ViewGame } from '@engine/core/view';
import { createGame } from './headless';
import { labCanvasPicture, labFrames, labLook, SKY, type LabPicture } from './picture';

/**
 * The lab's view entry (named by `view` in `game.json`), for `pnpm cli screenshot`: the headless
 * game (`headless.ts`) plus the page's drawing (`labCanvasPicture`: the kit's frame through the
 * Canvas2D backend and the skin). No loop: the screenshot page steps it and draws every tick.
 * `frame()` gives the same frames (`labFrames`) for any presenter, with the events since the last
 * call (`PendingEvents`: dropped when the level changes, as the page's scene does), for the 3D
 * backend, and `background` is the sky the 3D page clears to.
 */
export function createView(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): ViewGame {
  const game = createGame(content, seed, opts);
  const look = labLook(content);
  let picture: { r: Renderer; p: LabPicture } | null = null;
  const frames = labFrames(look.screen);
  const pending = new PendingEvents(game.world, game.events);
  return {
    step(input) {
      game.step(input);
      pending.add(game.world, game.events);
    },
    snapshot: () => game.snapshot(),
    screen: look.screen,
    render(r) {
      if (picture?.r !== r) picture = { r, p: labCanvasPicture(r, look) };
      picture.p.draw(game.world, game.events);
    },
    frame: () => frames.next(game.world, pending.take()),
    background: SKY,
  };
}
