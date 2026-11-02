import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { HeadlessOptions } from '@engine/core/headless';
import type { ViewGame } from '@engine/core/view';
import { snapshotWorld } from '@kits/topdown';
import { createWorld } from './headless';
import { DemoPicture, demoLook } from './picture';

/**
 * The demo's view entry (named by `view` in `game.json`), for `pnpm cli screenshot`: the headless
 * game (`headless.ts`) plus the scene's drawing (`DemoPicture`: the kit's frame through the
 * Canvas2D backend and the skin). No audio, no loop: the screenshot page steps it and draws one
 * frame.
 */
export function createView(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): ViewGame {
  const world = createWorld(content, seed, opts.disabledRules);
  const look = demoLook(content);
  // As `topdownGame` (the headless contract): each step takes the events it emitted.
  let last: object[] = world.events.splice(0);
  let picture: { r: Renderer; p: DemoPicture } | null = null;
  return {
    step(input) {
      world.update(input);
      last = world.events.splice(0);
    },
    snapshot: () => snapshotWorld(world, last),
    screen: look.screen,
    render(r) {
      if (picture?.r !== r) picture = { r, p: new DemoPicture(r, look) };
      picture.p.draw(world, last);
    },
  };
}
