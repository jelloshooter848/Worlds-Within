import { z } from 'zod';
import { formatErrors, type ContentError } from '@engine/core/content/validate';
import { EXIT } from '../exit-codes';
import { playRun, type FailedCheck } from '../headless-run';
import { kitRules } from '../kits';
import { defineCommand } from '../registry';

/**
 * `mutants <run-file>`: mutant checks. Plays the run file once as it is (it must pass), then once
 * per named rule of the game's kit with that rule switched off (`engine/core/rules.ts`). A run
 * that fails with a rule off guards that rule; one that still passes is weak there: its checks
 * do not notice the rule is gone. Rules the run file already switches off are skipped.
 *
 * Result: `{ run, game, kit, baseline: { passed, failure }, rules: [{ id, description, skipped,
 * passed, guarded, failure }], guarded: [ids], weak: [ids] }`. `failure` is the first failed
 * check with that rule off (`{ tick, kind, index, path, op, expected, actual, message }`) or null;
 * a skipped rule has `passed` and `guarded` null. Exit 0 when the run passes as it is (weak rules
 * are reported, not failed: kits adopt rules fully from Engine 0.5), 4 (`failedCheck`) when it
 * fails as it is (nothing else is tried), 3 (with `errors`) for a bad run file or content. No
 * replay files are written.
 */
export const mutantsCommand = defineCommand({
  name: 'mutants',
  summary: "play a run file once per kit rule switched off and report the rules it doesn't guard",
  args: z.strictObject({
    runFile: z.string().min(1).describe('the run file, such as games/demo/runs/walk-east.run.json'),
  }),
  flags: z.strictObject({}),
  async run({ args }, ctx) {
    const base = await playRun(ctx.cwd, args.runFile);
    if (!base.ok) return { exit: EXIT.invalidContent, result: { run: args.runFile, errors: base.errors } };
    const { loaded } = base.value;
    const kit = base.value.kit;
    const baseline = { passed: base.value.failures.length === 0, failure: base.value.failures[0] ?? null };
    const common = { run: loaded.file, game: loaded.gameDir, kit, baseline };
    if (!baseline.passed)
      return { exit: EXIT.failedCheck, result: { ...common, rules: [], guarded: [], weak: [] } };

    const rules = [];
    for (const rule of kitRules(kit)) {
      if (base.value.disabledRules.includes(rule.id)) {
        rules.push({ ...rule, skipped: true, passed: null, guarded: null, failure: null });
        continue;
      }
      const played = await playRun(ctx.cwd, args.runFile, { disableRules: [rule.id] });
      if (!played.ok)
        return { exit: EXIT.invalidContent, result: { run: args.runFile, errors: played.errors } };
      const failure: FailedCheck | null = played.value.failures[0] ?? null;
      rules.push({ ...rule, skipped: false, passed: !failure, guarded: !!failure, failure });
    }
    return {
      exit: EXIT.ok,
      result: {
        ...common,
        rules,
        guarded: rules.filter((r) => r.guarded === true).map((r) => r.id),
        weak: rules.filter((r) => r.guarded === false).map((r) => r.id),
      },
    };
  },
  text(result) {
    if (result.errors) return formatErrors(result.errors as ContentError[]);
    const baseline = result.baseline as { passed: boolean; failure: FailedCheck | null };
    if (!baseline.passed)
      return `${String(result.run)}: FAILED as it is (tick ${baseline.failure?.tick}: ${baseline.failure?.message}); fix it before checking mutants`;
    type Row = { id: string; skipped: boolean; guarded: boolean | null; failure: FailedCheck | null };
    const rows = result.rules as Row[];
    const lines = [`${String(result.run)}: ${rows.length} rule(s) of kit "${String(result.kit)}"`];
    for (const r of rows) {
      if (r.skipped) lines.push(`  skipped: ${r.id} (the run file switches it off)`);
      else if (r.guarded)
        lines.push(`  guards: ${r.id} (fails at tick ${r.failure?.tick}: ${r.failure?.message})`);
      else lines.push(`  weak: does not guard ${r.id}`);
    }
    return lines.join('\n');
  },
});
