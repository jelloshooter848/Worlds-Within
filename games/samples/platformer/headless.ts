import type { ContentBundle } from '@engine/core/content/bundle';
import { rulesOffFor, type HeadlessOptions, type HeadlessStarts } from '@engine/core/headless';
import { LevelSequence, stageStarts, startStage, type SequenceSnapshot } from '@kits/platformer';
import { hopperStages } from './content';
import { hopperMiniGames } from './minigames';

/**
 * The game's mini games (`HeadlessEntry.miniGames`, Engine 0.10 gap G16): the room challenges
 * `createGame` hands its levels, so `pnpm cli validate` checks the door's `game` and `params`
 * (`challengeParamsSchema`) with the content.
 */
export { hopperMiniGames as miniGames };

/**
 * The platformer sample's headless entry (named by `headless` in `game.json`): the platformer kit's
 * `LevelSequence` on the game's levels, played in order (`hopperStages`), with its mini games (the
 * door level's top-down room challenge, `hopperMiniGames`). The level flow (the pause
 * between levels, next or same level, a new world per level) is the kit's. No browser, no drawing.
 */

/** The game being played: the kit's level sequence. */
export type HopperGame = LevelSequence;

/** The snapshot: the kit's `SequenceSnapshot` (the world's plus `stage` and `pause`). */
export type HopperSnapshot = SequenceSnapshot;

/**
 * The headless game contract (`engine/core/headless.ts`), for `pnpm cli run`, `dump` and
 * `mutants`: platformer rules switched off in `opts` go to every level's world, top-down ones
 * (`opts.disabledRulesByKit.topdown`, a run file's `topdown:<id>`, gap G12) to every vault round, and a run file's
 * `start: { stage }` (`opts.start`, gap G9) is the level the sequence starts at.
 */
export function createGame(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): HopperGame {
  const start = startStage(opts.start);
  return new LevelSequence(hopperStages(content), {
    seed,
    disabledRules: opts.disabledRules ?? [],
    miniGames: hopperMiniGames(content, rulesOffFor(opts, 'topdown')),
    ...(start === undefined ? {} : { start }),
  });
}

/**
 * The starts a run file may name (`HeadlessEntry.starts`, Engine 0.14, gap G9): one stage per
 * level, in play order (`level-1` is stage 0).
 */
export function starts(content: ContentBundle): HeadlessStarts {
  return stageStarts(hopperStages(content));
}
