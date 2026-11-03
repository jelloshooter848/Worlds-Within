import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessOptions, HeadlessStarts } from '@engine/core/headless';
import type { MiniGameDef } from '@engine/core/minigame';
import { LevelSequence, stageStarts, startStage, type SequenceSnapshot } from '@kits/platformer';
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
 * `mutants`: kit rules switched off in `opts` go to every level's world, and a run file's
 * `start: { stage }` (`opts.start`, gap G9) is the level the sequence starts at.
 */
export function createGame(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): LabGame {
  const start = startStage(opts.start);
  return new LevelSequence(labStages(content), {
    seed,
    disabledRules: opts.disabledRules ?? [],
    miniGames: LAB_MINI_GAMES,
    ...(start === undefined ? {} : { start }),
  });
}

/**
 * The starts a run file may name (`HeadlessEntry.starts`, Engine 0.14, gap G9): one stage per
 * level, in play order (the fixture level `tiny` is stage 0).
 */
export function starts(content: ContentBundle): HeadlessStarts {
  return stageStarts(labStages(content));
}

/**
 * The lab's mini games (`HeadlessEntry.miniGames`, Engine 0.10 gap G16), the same `createGame`
 * hands its levels, so `pnpm cli validate` checks each trigger's `game` and `params` against them.
 */
export function miniGames(_content: ContentBundle): readonly MiniGameDef[] {
  return LAB_MINI_GAMES;
}
