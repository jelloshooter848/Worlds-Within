import { AssetRegistry } from '@engine/core/assets/registry';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessOptions } from '@engine/core/headless';
import type { ViewGame } from '@engine/core/view';
import { sheetLookup } from '@engine/core/assets/sheet-lookup';
import { topdownGame } from '@kits/topdown';
import { demoArt } from './content';
import { createWorld } from './headless';
import { renderDemo } from './scene';

/**
 * The demo's view entry (named by `view` in `game.json`), for `pnpm cli screenshot`: the headless
 * game (`headless.ts`) plus drawing, the same drawing the scene does. No audio, no loop: the
 * screenshot page steps it and draws one frame.
 */
export function createView(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): ViewGame {
  const world = createWorld(content, seed, opts.disabledRules);
  const game = topdownGame(world);
  const art = demoArt(content);
  const assets = new AssetRegistry({ default: art.palettes });
  assets.defineAll(art.sprites);
  const sheet = sheetLookup(assets);
  let frame = 0;
  return {
    step(input) {
      frame++;
      game.step(input);
    },
    snapshot: () => game.snapshot(),
    screen: content.manifest.screen,
    render: (r) => renderDemo(r, world, frame, sheet),
  };
}
