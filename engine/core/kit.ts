import type { z } from 'zod';
import type { ContentBundle } from './content/bundle';
import type { ContentKind } from './content/kinds';
import type { MiniGameUse } from './minigame-params';
import { defineRules, type RuleList } from './rules';

/**
 * A kit's hook for the tools: what a kit tells `engine/tools` about itself, so the tools can read
 * and test a game built on it without a table of kits in engine code. Each kit exports one, as
 * `kit` from `kits/<name>/kit.ts`, made with {@link defineKit}.
 *
 * Pure: no IO, no clock, no randomness.
 */
export interface KitDef {
  /** The kit's name: its folder under `kits/`, and what a `game.json` gives in `kit`. */
  readonly name: string;
  /** The content kinds the kit adds to the engine's own (fresh each call). */
  kinds(): readonly ContentKind[];
  /** The kit's named rules (`rules.ts`), for `disableRules`, `--disable-rule` and `mutants`. */
  readonly rules: RuleList;
  /** Whether the kit opts in to strict mutant checks (Engine 0.5, item 41). Off when left out. */
  readonly strictMutants?: boolean;
  /**
   * Optional (Engine 0.10, gap G16): every place in a game's checked content where the kit's kinds
   * name a mini game and its `params` (a platformer level's triggers), for `validate` to check
   * against the game's mini games (`minigame-params.ts`). Kits whose content names none leave it out.
   */
  miniGameUses?(content: ContentBundle): readonly MiniGameUse[];
  /**
   * Optional (Engine 0.11): the params schemas of the kit's own mini games that content names by a
   * fixed id (the topdown kit's `mission-room`, whose params a mission file holds), for the
   * generated schema reference (`docs/reference/schemas.md`, "Mini game params").
   */
  paramsDocs?(): readonly KitParamsDoc[];
}

/** One mini game's params for the schema reference: its id, what it is and its schema. */
export interface KitParamsDoc {
  /** The mini game id content names (`mission-room`); its example is `<game>-params.json`. */
  readonly game: string;
  /** One sentence: what the round is and where its params are written. */
  readonly description: string;
  readonly schema: z.ZodType;
}

/** A kit name: lower-case letters, digits and "-", as in `game.json`. */
const KIT_NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Checks a kit's hook (a name `game.json` can give, and a good rule list: see `defineRules`) and
 * returns it. Throws on a bad hook, so a kit's mistake shows at once.
 */
export function defineKit(kit: KitDef): KitDef {
  if (!KIT_NAME.test(kit.name))
    throw new Error(`kit name "${kit.name}" must be lower-case letters, digits and "-"`);
  try {
    defineRules(kit.rules);
  } catch (error) {
    throw new Error(`kit "${kit.name}": ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  return kit;
}
