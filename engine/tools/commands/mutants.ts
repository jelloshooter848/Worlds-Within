import { readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { formatErrors, type ContentError } from '@engine/core/content/validate';
import type { KitDef } from '@engine/core/kit';
import { EXIT, UsageError, type ExitCode } from '../exit-codes';
import { loadGame } from '../game-loader';
import { playRun, type FailedCheck } from '../headless-run';
import { gameKits, lookupRuleId, qualifiedRuleId } from '../kits';
import { readRunFile } from '../run-file';
import { defineCommand } from '../registry';

/**
 * `mutants <run-file | game folder>`: mutant checks. Plays a run file once as it is (it must pass),
 * then once per named rule of every kit the game uses (`kit`, then each kit in `uses`; Engine 0.14,
 * gap G12, decision 8) with that rule switched off (`engine/core/rules.ts`). A run that fails with
 * a rule off guards that rule; one that still passes does not: its checks do not notice the rule
 * is gone. Rules the run file already switches off are skipped.
 *
 * Rule ids are written as run files write them: bare for the game's own kit, `kit:id` for a kit it
 * `uses` (`topdown:doors-change-room`). Each row also names its `kit` and that kit's `strict`.
 *
 * The rules a run is expected to guard are its `guards` when the run file gives them, else every
 * rule of the game's own kit it does not skip (a `uses` kit's rule is expected only when `guards`
 * lists it). `weak` lists the expected rules it does not guard. A weak rule of a kit whose hook
 * says `strictMutants: true` fails the command (exit 4); a weak rule of another kit (topdown, rts)
 * is only reported (exit 0). Each rule is judged by its own kit's strictness.
 *
 * Run file result: `{ run, game, kit, strict, kits: [{ kit, strict, rules }], baseline: { passed,
 * failure }, guards, rules: [{ id, kit, strict, description, skipped, expected, passed, guarded,
 * failure }], guarded: [ids], weak: [ids] }`. `kit` and `strict` are the game's own kit's; `kits`
 * lists every kit tried with its strictness and rule count. `guards` is the run file's list or
 * null; `failure` is the first failed check with that rule off or null; a skipped rule has
 * `passed` and `guarded` null.
 *
 * Game folder (`mutants games/<g>`): plays every run file of the game (`*.run.json` in a `runs/`
 * folder under it) the same way and asks of the game as a whole that each rule is guarded by some
 * run file. Result: `{ game, kit, strict, kits: [{ kit, strict, rules, unguarded }], runs: [{ run,
 * baseline, guards, guarded, weak }], rules: [{ id, kit, strict, description, guardedBy: [run
 * files] }], unguarded: [ids] }`. Here a run's `weak` is only its own `guards` it does not guard
 * (none without `guards`). A rule of the game's own kit that no run file guards when that kit is
 * strict, or a run with a weak rule of a strict kit (its own `guards`), is exit 4. A `uses` kit's
 * rules no run file guards are listed (`unguarded`, and per kit in `kits[].unguarded`) but fail
 * nothing, even for a strict kit: strictness applies to another kit's rules where the game's run
 * files list them in `guards` (decision 8, settled in T5).
 *
 * A world run file (`world`, no kit) is a usage error: it has no rules to switch off.
 *
 * Both: exit 4 (`failedCheck`) when a run fails as it is (its rules are not tried), 3 (with
 * `errors`) for a bad run file or content. No replay files are written.
 */

interface RuleRow {
  id: string;
  kit: string;
  strict: boolean;
  description: string;
  skipped: boolean;
  expected: boolean;
  passed: boolean | null;
  guarded: boolean | null;
  failure: FailedCheck | null;
}

interface KitRow {
  kit: string;
  strict: boolean;
  rules: number;
}

interface RunReport {
  run: string;
  game: string;
  kit: string;
  strict: boolean;
  kits: KitRow[];
  baseline: { passed: boolean; failure: FailedCheck | null };
  guards: string[] | null;
  rules: RuleRow[];
  guarded: string[];
  weak: string[];
}

type Checked = { ok: true; report: RunReport } | { ok: false; errors: ContentError[] };

/** Every rule of every kit in `kits` (the game's own first), with its id as run files write it. */
function kitRuleRows(kits: readonly KitDef[]) {
  const main = kits[0]!.name;
  return kits.flatMap((k) =>
    k.rules.map((r) => ({
      id: qualifiedRuleId({ kit: k.name, id: r.id }, main),
      rule: r.id,
      kit: k.name,
      strict: k.strictMutants === true,
      description: r.description,
    })),
  );
}

/** The ids in `ids` as `kitRuleRows` writes them (`platformer:jump` in a platformer game is `jump`). */
function normalIds(ids: readonly string[], kits: readonly KitDef[]): string[] {
  return ids.map((id) => {
    const found = lookupRuleId(id, kits);
    return found.ok ? qualifiedRuleId(found.rule, kits[0]!.name) : id;
  });
}

/** Plays one run file as it is and once per rule of each of its game's kits switched off. */
async function checkRun(cwd: string, runFile: string): Promise<Checked> {
  const base = await playRun(cwd, runFile);
  if (!base.ok) return base;
  const { loaded, kit } = base.value;
  if (kit === null || loaded.gameDir === null)
    throw new UsageError(`${loaded.file} plays a world, which has no kit rules to switch off`);
  const game = loadGame(cwd, loaded.gameDir);
  if (!game.content.ok) return { ok: false, errors: game.content.errors };
  const kits = gameKits(game.content.value.manifest);
  const guards = loaded.run.guards ?? null;
  const expectedIds = guards ? new Set(normalIds(guards, kits)) : null;
  const baseline = { passed: base.value.failures.length === 0, failure: base.value.failures[0] ?? null };
  const report: RunReport = {
    run: loaded.file,
    game: loaded.gameDir,
    kit,
    strict: kits[0]!.strictMutants === true,
    kits: kits.map((k) => ({ kit: k.name, strict: k.strictMutants === true, rules: k.rules.length })),
    baseline,
    guards,
    rules: [],
    guarded: [],
    weak: [],
  };
  if (!baseline.passed) return { ok: true, report };

  for (const { rule: _rule, ...row } of kitRuleRows(kits)) {
    const skipped = base.value.disabledRules.includes(row.id);
    // A `uses` kit's rule is expected only when the run lists it in `guards` (decision 8, settled
    // in T5): a game is held to another kit's rules where it says it guards them.
    const expected = expectedIds ? expectedIds.has(row.id) : !skipped && row.kit === kit;
    if (skipped) {
      report.rules.push({ ...row, skipped, expected, passed: null, guarded: null, failure: null });
      continue;
    }
    const played = await playRun(cwd, runFile, { disableRules: [row.id] });
    if (!played.ok) return played;
    const failure: FailedCheck | null = played.value.failures[0] ?? null;
    report.rules.push({ ...row, skipped, expected, passed: !failure, guarded: !!failure, failure });
  }
  report.guarded = report.rules.filter((r) => r.guarded === true).map((r) => r.id);
  report.weak = report.rules.filter((r) => r.expected && r.guarded === false).map((r) => r.id);
  return { ok: true, report };
}

/** Is rule `id` (as `kitRuleRows` writes it) one of a strict kit's, among `rows`? */
function strictRule(rows: readonly { id: string; strict: boolean }[], id: string): boolean {
  return rows.some((r) => r.id === id && r.strict);
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
  const strictWeak = r.weak.some((id) => strictRule(r.rules, id));
  const exit: ExitCode = !r.baseline.passed || strictWeak ? EXIT.failedCheck : EXIT.ok;
  return { exit, result: { ...r } };
}

async function mutantsOfGame(cwd: string, gameDir: string) {
  const game = loadGame(cwd, gameDir);
  if (!game.content.ok)
    return { exit: EXIT.invalidContent, result: { game: game.dir, errors: game.content.errors } };
  const kits = gameKits(game.content.value.manifest);
  const all = kitRuleRows(kits);
  const files = gameRunFiles(resolve(cwd, game.dir)).map((f) => relative(cwd, f).replaceAll('\\', '/'));

  const runs = [];
  const errors: ContentError[] = [];
  const guardedBy = new Map<string, string[]>(all.map((r) => [r.id, []]));
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
  const strict = kits[0]!.strictMutants === true;
  const common = { game: game.dir, kit: kits[0]!.name, strict };
  if (errors.length > 0) return { exit: EXIT.invalidContent, result: { ...common, errors } };

  const rules = all.map(({ rule: _rule, ...r }) => ({ ...r, guardedBy: guardedBy.get(r.id) ?? [] }));
  const unguarded = rules.filter((r) => r.guardedBy.length === 0).map((r) => r.id);
  const kitRows = kits.map((k) => ({
    kit: k.name,
    strict: k.strictMutants === true,
    rules: k.rules.length,
    unguarded: rules.filter((r) => r.kit === k.name && r.guardedBy.length === 0).map((r) => r.id),
  }));
  const failed = runs.some((r) => !r.baseline.passed);
  const strictGap =
    rules.some((r) => r.kit === kits[0]!.name && r.strict && r.guardedBy.length === 0) ||
    runs.some((r) => r.weak.some((id) => strictRule(rules, id)));
  const exit: ExitCode = failed || strictGap ? EXIT.failedCheck : EXIT.ok;
  return { exit, result: { ...common, kits: kitRows, runs, rules, unguarded } };
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
    if (isDir) return mutantsOfGame(ctx.cwd, args.target);
    const runFile = readRunFile(ctx.cwd, args.target);
    if (runFile.ok && runFile.value.worldFile !== null)
      throw new UsageError(`${runFile.value.file} plays a world, which has no kit rules to switch off`);
    return mutantsOfRun(ctx.cwd, args.target);
  },
  text(result) {
    if (result.errors) return formatErrors(result.errors as ContentError[]);
    if (Array.isArray(result.runs)) {
      type GameRun = Pick<RunReport, 'run' | 'baseline' | 'weak'>;
      type GameRule = { id: string; kit: string; guardedBy: string[] };
      const runs = result.runs as GameRun[];
      const rules = result.rules as GameRule[];
      const lines = [
        `${String(result.game)}: ${runs.length} run file(s), ${rules.length} rule(s) of ${kitsText(result.kits as KitRow[])}`,
      ];
      for (const r of rules)
        lines.push(
          r.guardedBy.length > 0
            ? `  ${r.id}: guarded by ${r.guardedBy.join(', ')}`
            : r.kit === result.kit
              ? `  weak: no run file guards ${r.id}`
              : `  not guarded: no run file guards ${r.id} (kit "${r.kit}" is held only to the run files' guards)`,
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
    const lines = [`${String(result.run)}: ${rows.length} rule(s) of ${kitsText(result.kits as KitRow[])}`];
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

/** `kit "rts", kit "towerdefense" (strict)`: the kits tried, each with its strictness. */
function kitsText(kits: readonly KitRow[]): string {
  return kits.map((k) => `kit "${k.kit}"${k.strict ? ' (strict)' : ''}`).join(', ');
}
