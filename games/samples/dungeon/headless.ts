import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessGame, HeadlessOptions } from '@engine/core/headless';
import { TopDownWorld, topdownGame } from '@kits/topdown';
import { demoDungeon } from './content';

/**
 * The demo's headless entry (named by `headless` in `game.json`): a world from the loaded content
 * and a seed (the manifest's `start.seed` when none is given). No browser, no drawing.
 */
export function createWorld(
  content: ContentBundle,
  seed = content.manifest.start.seed,
  disabledRules: readonly string[] = [],
): TopDownWorld {
  return new TopDownWorld(demoDungeon(content), { seed, disabledRules });
}

/**
 * The headless game contract (`engine/core/headless.ts`), for `pnpm cli run`, `dump` and
 * `mutants`: kit rules switched off in `opts` go to the world.
 */
export function createGame(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): HeadlessGame {
  return topdownGame(createWorld(content, seed, opts.disabledRules));
}
