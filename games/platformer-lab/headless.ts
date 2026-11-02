import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessOptions } from '@engine/core/headless';
import { LevelSequence, type SequenceSnapshot } from '@kits/platformer';
import { labStages } from './content';
import { LAB_MINI_GAMES } from './minigame';

/**
 * The lab's headless entry (named by `headless` in `game.json`): the platformer kit's
 * `LevelSequence` on the lab's levels, played in order (`labStages`: the fixture level `tiny`
 * first), with the lab's mini games. The level flow (the pause between levels, next or same
 * level, a new world per level) is the kit's. No browser, no drawing.
 */

/** The lab being played: the kit's level sequence. */
export type LabGame = LevelSequence;

/** The lab's snapshot: the kit's `SequenceSnapshot` (the world's plus `stage` and `pause`). */
export type LabSnapshot = SequenceSnapshot;

/**
 * The headless game contract (`engine/core/headless.ts`), for `pnpm cli run`, `dump` and
 * `mutants`: kit rules switched off in `opts` go to every level's world.
 */
export function createGame(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): LabGame {
  return new LevelSequence(labStages(content), {
    seed,
    disabledRules: opts.disabledRules ?? [],
    miniGames: LAB_MINI_GAMES,
  });
}
