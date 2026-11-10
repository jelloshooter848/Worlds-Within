import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessGame, HeadlessOptions } from '@engine/core/headless';
import { TopDownWorld, topdownGame } from '@kits/topdown';
import { topdownItems } from '@kits/topdown/kit';
import { dungeonRooms } from './content';

/**
 * The dungeon sample's headless entry (named by `headless` in `game.json`): a world from the loaded content
 * and a seed (the manifest's `start.seed` when none is given), with the kit's items tuned by
 * `kitOptions.topdown` (the dash, Engine 0.16 part C T5). No browser, no drawing.
 */
export function createWorld(
  content: ContentBundle,
  seed = content.manifest.start.seed,
  disabledRules: readonly string[] = [],
): TopDownWorld {
  return new TopDownWorld(dungeonRooms(content), {
    seed,
    disabledRules,
    items: topdownItems(content.manifest),
  });
}

/**
 * The headless game contract (`engine/core/headless.ts`), for `pnpm cli run`, `dump` and
 * `mutants`: kit rules switched off in `opts` go to the world.
 */
export function createGame(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): HeadlessGame {
  return topdownGame(createWorld(content, seed, opts.disabledRules));
}
