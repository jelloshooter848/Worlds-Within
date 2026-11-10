import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessOptions, HeadlessStarts } from '@engine/core/headless';
import { LevelSequence, stageStarts, startStage, type SequenceSnapshot } from '@kits/platformer';
import { hopperStages } from './content';

/**
 * Hopper's Way's headless entry (named by `headless` in `game.json`): the platformer kit's
 * `LevelSequence` on the game's stages, played in the campaign's order (`hopperStages`), with the
 * view as wide as the game's 16:9 screen (320 px: the kit scrolls and wakes actors by it). The
 * level flow (the pause between levels, next or same level, a new world per level) is the kit's.
 * No browser, no drawing.
 */

/** The game being played: the kit's level sequence. */
export type HopperGame = LevelSequence;

/** The snapshot: the kit's `SequenceSnapshot` (the world's plus `stage` and `pause`). */
export type HopperSnapshot = SequenceSnapshot;

/**
 * The headless game contract (`engine/core/headless.ts`), for `pnpm cli run`, `dump` and
 * `mutants`: platformer rules switched off in `opts` go to every level's world, and a run file's
 * `start: { stage }` (`opts.start`) is the stage the sequence starts at.
 */
export function createGame(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): HopperGame {
  const start = startStage(opts.start);
  return new LevelSequence(hopperStages(content), {
    seed,
    disabledRules: opts.disabledRules ?? [],
    viewWidth: content.manifest.screen.width,
    ...(start === undefined ? {} : { start }),
  });
}

/** The starts a run file may name: one stage per campaign entry, in play order (`level-1` is 0). */
export function starts(content: ContentBundle): HeadlessStarts {
  return stageStarts(hopperStages(content));
}
