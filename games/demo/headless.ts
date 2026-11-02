import type { ContentBundle } from '@engine/core/content/bundle';
import { TopDownWorld } from '@kits/topdown';
import { demoDungeon } from './content';

/**
 * The demo's headless entry (named by `headless` in `game.json`): a world from the loaded content
 * and a seed (the manifest's `start.seed` when none is given). No browser, no drawing.
 */
export function createWorld(content: ContentBundle, seed = content.manifest.start.seed): TopDownWorld {
  return new TopDownWorld(demoDungeon(content), { seed });
}
