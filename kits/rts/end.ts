import { z } from 'zod';
import { conditionHolds, planConditionSchema } from './enemy';
import type { RtsKnowledge } from './knowledge';
import type { RtsView } from './snapshot';

/**
 * A game's end rule as data (Engine 0.16 part D, D6): the `rts-end` content kind, when a match is
 * won and when it is lost, in the plan's own conditions (`planConditionSchema`, `enemy.ts`), so a
 * game declares its win and loss in a file and not in code:
 *
 *   { "faction": "red",
 *     "won":  [{ "count": "buildings", "side": "enemy", "type": "hall", "op": "lte", "value": 0 }],
 *     "lost": [{ "count": "buildings", "side": "self", "type": "hall", "op": "lte", "value": 0 },
 *              { "count": "units", "side": "self", "op": "lte", "value": 0 }] }
 *
 * `matchResult(view, end, knowledge?)`: `lost` when any `lost` condition holds (checked first, so
 * a match where both sides fall at once is lost), else `won` when any `won` condition holds, else
 * null (still playing). `self` is `faction`, `enemy` every other faction, as in a plan. With
 * `knowledge` (the side's `RtsKnowledge`, kept up to date by its owner), conditions read only what
 * that side knows (`knowledge.known(view)`): a win declared on enemy buildings counts the ones it
 * has seen and remembers. Pure: it reads the view and holds no world rule.
 */

const Id = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -');

/** The `rts-end` file shape. */
export const rtsEndSchema = z
  .strictObject({
    faction: Id.describe(
      'the side the rule is about: `self` in a condition is this faction, `enemy` every other',
    ),
    won: z
      .array(planConditionSchema)
      .min(1)
      .describe('the match is won once any of these holds (the plan condition shape)'),
    lost: z
      .array(planConditionSchema)
      .min(1)
      .describe('the match is lost once any of these holds; checked before `won`'),
  })
  .describe("a game's end rule: when the match is won and when it is lost");
export type RtsEnd = z.infer<typeof rtsEndSchema>;

/** How a match stands: `won`, `lost`, or null while it goes on. */
export type MatchResult = 'won' | 'lost' | null;

/** How the match stands on `view` under the end rule (see the file comment). */
export function matchResult(view: RtsView, end: RtsEnd, knowledge: RtsKnowledge | null = null): MatchResult {
  const known = knowledge === null ? view : knowledge.known(view);
  if (end.lost.some((c) => conditionHolds(known, end.faction, c))) return 'lost';
  if (end.won.some((c) => conditionHolds(known, end.faction, c))) return 'won';
  return null;
}
