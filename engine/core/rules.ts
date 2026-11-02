/**
 * Named rules and the switch that turns them off: the mechanism behind mutant checks.
 *
 * A kit names its rules (an id and a one-line description each) and guards the code of each with
 * `rules.isOn(id)`. A run can switch rules off (a run file's `disableRules`, the CLI's
 * `--disable-rule`); `pnpm cli mutants <run-file>` plays the run once per named rule with that
 * rule off. A run that still passes with a rule off does not guard that rule: its checks are too
 * weak to notice the rule is gone.
 *
 * Pure: no IO, no clock, no randomness.
 */

/** One named rule: a kebab-case id and what the rule does, in one line. */
export interface RuleDef {
  readonly id: string;
  readonly description: string;
}

/** A kit's rules, in the order the kit lists them. */
export type RuleList = readonly RuleDef[];

const RULE_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Checks a kit's rule list (kebab-case ids, no id twice, a description each) and returns it. Throws
 * on a bad list, so a kit's mistake shows at once.
 */
export function defineRules<const R extends RuleList>(rules: R): R {
  const seen = new Set<string>();
  for (const r of rules) {
    if (!RULE_ID.test(r.id)) throw new Error(`rule id "${r.id}" is not kebab-case`);
    if (seen.has(r.id)) throw new Error(`rule "${r.id}" is listed twice`);
    if (r.description.trim() === '') throw new Error(`rule "${r.id}" has no description`);
    seen.add(r.id);
  }
  return rules;
}

/** The ids in `disabled` that are not rules in `rules` (to report, not to switch off). */
export function unknownRules(rules: RuleList, disabled: Iterable<string>): string[] {
  const known = new Set(rules.map((r) => r.id));
  return [...disabled].filter((id) => !known.has(id));
}

/**
 * Which of a kit's rules are on. Built from the kit's list and the ids switched off; an id that
 * is not on the list throws, so a typo cannot pass for a rule that was switched off. Asking about
 * an id that is not on the list also throws.
 */
export class RuleSwitch {
  private readonly known: ReadonlySet<string>;
  private readonly off: ReadonlySet<string>;

  constructor(
    readonly rules: RuleList,
    disabled: Iterable<string> = [],
  ) {
    this.known = new Set(rules.map((r) => r.id));
    const off = [...disabled];
    const unknown = unknownRules(rules, off);
    if (unknown.length > 0)
      throw new Error(
        `unknown rule(s) ${unknown.map((id) => `"${id}"`).join(', ')} (known: ${[...this.known].join(', ')})`,
      );
    this.off = new Set(off);
  }

  /** Is rule `id` on? */
  isOn(id: string): boolean {
    if (!this.known.has(id)) throw new Error(`no rule "${id}"`);
    return !this.off.has(id);
  }

  /** The ids switched off, in the kit's order. */
  disabled(): string[] {
    return this.rules.filter((r) => this.off.has(r.id)).map((r) => r.id);
  }
}
