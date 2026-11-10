import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessOptions, HeadlessStarts } from '@engine/core/headless';
import { LevelSequence, stageStarts, startStage, type SequenceSnapshot } from '@kits/platformer';
import { fxStages } from './content';

/**
 * The fx lab's headless entry (named by `headless` in `game.json`): the platformer kit's
 * `LevelSequence` on its two levels, in campaign order. All its rules are the kit's; the lab only
 * adds presentation (skins), which never reaches this module or a state hash.
 */

/** The game being played: the kit's level sequence. */
export type FxLabGame = LevelSequence;

/** The snapshot: the kit's `SequenceSnapshot` (the world's plus `stage` and `pause`). */
export type FxLabSnapshot = SequenceSnapshot;

/**
 * The headless game contract (`engine/core/headless.ts`), for `pnpm cli run`, `dump` and
 * `mutants`: kit rules switched off in `opts` go to every level, and a run file's
 * `start: { stage }` is the level the sequence starts at.
 */
export function createGame(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): FxLabGame {
  const start = startStage(opts.start);
  return new LevelSequence(fxStages(content), {
    seed,
    disabledRules: opts.disabledRules ?? [],
    ...(start === undefined ? {} : { start }),
  });
}

/** The starts a run file may name: one stage per level (`fx-1` is stage 0). */
export function starts(content: ContentBundle): HeadlessStarts {
  return stageStarts(fxStages(content));
}
