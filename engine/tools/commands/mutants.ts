import { readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { formatErrors, type ContentError } from '@engine/core/content/validate';
import { EXIT, type ExitCode } from '../exit-codes';
import { loadGame } from '../game-loader';
import { playRun, type FailedCheck } from '../headless-run';
import { loadKit } from '../kits';
import { defineCommand } from '../registry';

/**
 * `mutants <run-file | game folder>`: mutant checks. Plays a run file once as it is (it must pass),
 * then once per named rule of the game's kit with that rule switched off (`engine/core/rules.ts`).
 * A run that fails with a rule off guards that rule; one that still passes does not: its checks do
 * not notice the rule is gone. Rules the run file already switches off are skipped.
 *
 * The rules a run is expected to guard are its `guards` when the run file gives them, else every
 * rule it does not skip. `weak` lists the expected rules it does not guard. A kit whose hook says
 * `strictMutants: true` fails the command (exit 4) on any weak rule; other kits (topdown) only
 * report them (exit 0).
 *
 * Run file result: `{ run, game, kit, strict, baseline: { passed, failure }, guards, rules: [{ id,
 * description, skipped, expected, passed, guarded, failure }], guarded: [ids], weak: [ids] }`.
 * `guards` is the run file's list or null; `failure` is the first failed check with that rule off
 * or null; a skipped rule has `passed` and `guarded` null.
 *
 * Game folder (`mutants games/<g>`): plays every run file of the game (`*.run.json` in a `runs/`
 * folder under it) the same way and asks of the game as a whole that each rule is guarded by some
 * run file. Result: `{ game, kit, strict, runs: [{ run, baseline, guards, guarded, weak }], rules:
 * [{ id, description, guardedBy: [run files] }], unguarded: [ids] }`. Here a run's `weak` is only
 * its own `guards` it does not guard (none without `guards`). For a strict kit, a rule no run file
 * guards, or a run with a weak rule, is exit 4.
 *
 * Both: exit 4 (`failedCheck`) when a run fails as it is (its rules are not tried), 3 (with
 * `errors`) for a bad run file or content. No replay files are written.
 */

interface RuleRow {
  id: string;
  description: string;
  skipped: boolean;
  expected: boolean;
  passed: boolean | null;
  guarded: boolean | null;
  failure: FailedCheck | null;
}

interface RunReport {
  run: string;
  game: string;
  kit: string;
  strict: boolean;
  baseline: { passed: boolean; failure: FailedCheck | null };
  guards: string[] | null;
  rules: RuleRow[];
  guarded: string[];
  weak: string[];
}

type Checked = { ok: true; report: RunReport } | { ok: false; errors: ContentError[] };

/** Plays one run file as it is and once per kit rule switched off. */
async function checkRun(cwd: string, runFile: string): Promise<Checked> {
  const base = await playRun(cwd, runFile);
  if (!base.ok) return base;
  const { loaded, kit } = base.value;
  const hook = loadKit(kit);
  const guards = loaded.run.guards ?? null;
  const baseline = { passed: base.value.failures.length === 0, failure: base.value.failures[0] ?? null };
  const report: RunReport = {
    run: loaded.file,
    game: loaded.gameDir,
    kit,
    strict: hook.strictMutants === true,
    baseline,
    guards,
    rules: [],
    guarded: [],
    weak: [],
  };
  if (!baseline.passed) return { ok: true, report };

  for (const rule of hook.rules) {
    const skipped = base.value.disabledRules.includes(rule.id);
    const expected = guards ? guards.includes(rule.id) : !skipped;
    if (skipped) {
      report.rules.push({ ...rule, skipped, expected, passed: null, guarded: null, failure: null });
      continue;
    }
    const played = await playRun(cwd, runFile, { disableRules: [rule.id] });
    if (!played.ok) return played;
    const failure: FailedCheck | null = played.value.failures[0] ?? null;
    report.rules.push({ ...rule, skipped, expected, passed: !failure, guarded: !!failure, failure });
  }
  report.guarded = report.rules.filter((r) => r.guarded === true).map((r) => r.id);
  report.weak = report.rules.filter((r) => r.expected && r.guarded === false).map((r) => r.id);
  return { ok: true, report };
}

/** Every run file of the game in folder `abs`: `*.run.json` in a `runs/` folder under it, sorted. */
function gameRunFiles(dir: string): string[] {
  const out: string[] = [];
  const inRuns = basename(dir) === 'runs';
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) out.push(...gameRunFiles(path));
    else if (inRuns && e.name.endsWith('.run.json')) out.push(path);
  }
  return out.sort();
}

async function mutantsOfRun(cwd: string, runFile: string) {
  const checked = await checkRun(cwd, runFile);
  if (!checked.ok) return { exit: EXIT.invalidContent, result: { run: runFile, errors: checked.errors } };
  const r = checked.report;
  const exit: ExitCode = !r.baseline.passed || (r.strict && r.weak.length > 0) ? EXIT.failedCheck : EXIT.ok;
  return { exit, result: { ...r } };
}

async function mutantsOfGame(cwd: string, gameDir: string) {
  const game = loadGame(cwd, gameDir);
  if (!game.content.ok)
    return { exit: EXIT.invalidContent, result: { game: game.dir, errors: game.content.errors } };
  const hook = loadKit(game.content.value.manifest.kit);
  const files = gameRunFiles(resolve(cwd, game.dir)).map((f) => relative(cwd, f).replaceAll('\\', '/'));

  const runs = [];
  const errors: ContentError[] = [];
  const guardedBy = new Map<string, string[]>(hook.rules.map((r) => [r.id, []]));
  for (const file of files) {
    const checked = await checkRun(cwd, file);
    if (!checked.ok) {
      errors.push(...checked.errors);
      continue;
    }
    const r = checked.report;
    for (const id of r.guarded) guardedBy.get(id)?.push(r.run);
    runs.push({
      run: r.run,
      baseline: r.baseline,
      guards: r.guards,
      guarded: r.guarded,
      // In a game, a run is held only to the rules it says it guards.
      weak: r.guards ? r.weak : [],
    });
  }
  const strict = hook.strictMutants === true;
  const common = { game: game.dir, kit: hook.name, strict };
  if (errors.length > 0) return { exit: EXIT.invalidContent, result: { ...common, errors } };

  const rules = hook.rules.map((r) => ({ ...r, guardedBy: guardedBy.get(r.id) ?? [] }));
  const unguarded = rules.filter((r) => r.guardedBy.length === 0).map((r) => r.id);
  const failed = runs.some((r) => !r.baseline.passed);
  const weakRun = runs.some((r) => r.weak.length > 0);
  const exit: ExitCode = failed || (strict && (unguarded.length > 0 || weakRun)) ? EXIT.failedCheck : EXIT.ok;
  return { exit, result: { ...common, runs, rules, unguarded } };
}

export const mutantsCommand = defineCommand({
  name: 'mutants',
  summary: "play run files once per kit rule switched off and report the rules they don't guard",
  args: z.strictObject({
    target: z
      .string()
      .min(1)
      .describe(
        'a run file (games/demo/runs/walk-east.run.json), or a game folder (games/demo) for every run file of the game',
      ),
  }),
  flags: z.strictObject({}),
  async run({ args }, ctx) {
    const abs = resolve(ctx.cwd, args.target);
    let isDir = false;
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      // Not there: readRunFile reports it as a usage error.
    }
    return isDir ? mutantsOfGame(ctx.cwd, args.target) : mutantsOfRun(ctx.cwd, args.target);
  },
  text(result) {
    if (result.errors) return formatErrors(result.errors as ContentError[]);
    const strict = result.strict ? ' (strict)' : '';
    if (Array.isArray(result.runs)) {
      type GameRun = Pick<RunReport, 'run' | 'baseline' | 'weak'>;
      type GameRule = { id: string; guardedBy: string[] };
      const runs = result.runs as GameRun[];
      const rules = result.rules as GameRule[];
      const lines = [
        `${String(result.game)}: ${runs.length} run file(s), ${rules.length} rule(s) of kit "${String(result.kit)}"${strict}`,
      ];
      for (const r of rules)
        lines.push(
          r.guardedBy.length > 0
            ? `  ${r.id}: guarded by ${r.guardedBy.join(', ')}`
            : `  weak: no run file guards ${r.id}`,
        );
      for (const r of runs) {
        if (!r.baseline.passed)
          lines.push(
            `  ${r.run}: FAILED as it is (tick ${r.baseline.failure?.tick}: ${r.baseline.failure?.message})`,
          );
        for (const id of r.weak) lines.push(`  ${r.run}: weak: does not guard ${id} (listed in guards)`);
      }
      return lines.join('\n');
    }
    const baseline = result.baseline as RunReport['baseline'];
    if (!baseline.passed)
      return `${String(result.run)}: FAILED as it is (tick ${baseline.failure?.tick}: ${baseline.failure?.message}); fix it before checking mutants`;
    const rows = result.rules as RuleRow[];
    const lines = [`${String(result.run)}: ${rows.length} rule(s) of kit "${String(result.kit)}"${strict}`];
    for (const r of rows) {
      if (r.skipped) lines.push(`  skipped: ${r.id} (the run file switches it off)`);
      else if (r.guarded)
        lines.push(`  guards: ${r.id} (fails at tick ${r.failure?.tick}: ${r.failure?.message})`);
      else if (r.expected) lines.push(`  weak: does not guard ${r.id}`);
      else lines.push(`  not guarded: ${r.id} (not in the run's guards)`);
    }
    return lines.join('\n');
  },
});
