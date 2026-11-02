import type { ContentKind } from '@engine/core/content/kinds';
import type { RuleList } from '@engine/core/rules';
import { roomKind, TOPDOWN_RULES } from '@kits/topdown';

/**
 * The content kinds each kit adds to the engine's own, by the kit name a `game.json` gives in
 * `kit`. The tools read a game's content with the engine's kinds plus these. Add a line here when
 * a kit gets content kinds of its own.
 */
export const KIT_KINDS: Readonly<Record<string, () => readonly ContentKind[]>> = {
  topdown: () => [roomKind() as unknown as ContentKind],
};

/**
 * The named rules each kit lets a run switch off (`engine/core/rules.ts`), by kit name, for
 * `disableRules`, `--disable-rule` and `mutants`. A kit with no line here has no named rules.
 */
export const KIT_RULES: Readonly<Record<string, RuleList>> = {
  topdown: TOPDOWN_RULES,
};

/** The named rules of kit `kit` (none for a kit that names none). */
export function kitRules(kit: string): RuleList {
  return KIT_RULES[kit] ?? [];
}
