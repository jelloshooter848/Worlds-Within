import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessOptions } from '@engine/core/headless';
import { tdGame, type TdGame } from '@kits/towerdefense';
import { sampleRound } from './content';

/**
 * The sample's headless entry (named by `headless` in `game.json`), for `pnpm cli run`, `dump` and
 * `mutants`: the kit's `tdGame` over the round from the content. Kit rules switched off in `opts`
 * go to the kit. No browser, no drawing, no rules of its own.
 */
export function createGame(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): TdGame {
  return tdGame({ ...sampleRound(content), seed, disabledRules: opts.disabledRules });
}
