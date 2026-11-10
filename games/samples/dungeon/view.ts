import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { HeadlessOptions } from '@engine/core/headless';
import type { DeepReadonly, PresentFrame } from '@engine/core/present';
import type { ViewGame } from '@engine/core/view';
import { snapshotWorld } from '@kits/topdown';
import { createWorld } from './headless';
import { DungeonPicture, dungeonLook } from './picture';

/**
 * The dungeon sample's view entry (named by `view` in `game.json`), for `pnpm cli screenshot`:
 * the headless game (`headless.ts`) plus the scene's drawing (`DungeonPicture`: the kit's frame
 * through the Canvas2D backend and the skin). No audio, no loop: the screenshot page steps it and
 * draws one frame.
 */
export function createView(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): ViewGame {
  const world = createWorld(content, seed, opts.disabledRules);
  const look = dungeonLook(content);
  // As `topdownGame` (the headless contract): each step takes the events it emitted.
  let last: object[] = world.events.splice(0);
  let picture: { r: Renderer; p: DungeonPicture } | null = null;
  let hud = true;
  let status: DeepReadonly<PresentFrame['status']> | null = null;
  // The page shows the run's end through the shell (`menus.triggers.end`), so no banner here.
  const banner = content.manifest.menus?.triggers?.end === undefined;
  return {
    step(input) {
      world.update(input);
      last = world.events.splice(0);
    },
    snapshot: () => snapshotWorld(world, last),
    screen: look.screen,
    render(r) {
      if (picture?.r !== r) picture = { r, p: new DungeonPicture(r, look, { banner }) };
      picture.p.showHud(hud);
      status = picture.p.draw(world, last).status;
    },
    // The frame status drawn last, for the screenshot page's `end` overlay (time, rooms seen).
    status: () => status,
    // The screenshot page's title overlay hides the HUD (Engine 0.16 part C T1).
    showHud(shown) {
      hud = shown;
    },
  };
}
