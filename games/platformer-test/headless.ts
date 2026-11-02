import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessOptions } from '@engine/core/headless';
import { LevelSequence, type SequenceSnapshot } from '@kits/platformer';
import { testStages } from './content';
import { testMiniGames } from './minigames';

/**
 * The stacking test's headless entry (named by `headless` in `game.json`): the platformer kit's
 * `LevelSequence` on the game's levels, played in order (`testStages`), with its mini games (the
 * door level's top-down room challenge, `testMiniGames`). The level flow (the pause
 * between levels, next or same level, a new world per level) is the kit's. No browser, no drawing.
 */

/** The game being played: the kit's level sequence. */
export type TestGame = LevelSequence;

/** The snapshot: the kit's `SequenceSnapshot` (the world's plus `stage` and `pause`). */
export type TestSnapshot = SequenceSnapshot;

/**
 * The headless game contract (`engine/core/headless.ts`), for `pnpm cli run`, `dump` and
 * `mutants`: kit rules switched off in `opts` go to every level's world.
 */
export function createGame(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): TestGame {
  return new LevelSequence(testStages(content), {
    seed,
    disabledRules: opts.disabledRules ?? [],
    miniGames: testMiniGames(content),
  });
}
