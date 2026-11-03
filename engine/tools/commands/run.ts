import { z } from 'zod';
import { formatErrors, type ContentError } from '@engine/core/content/validate';
import { EXIT } from '../exit-codes';
import {
  playRun,
  type FailedCheck,
  type HashMismatch,
  type RefusedMission,
  type RefusedOrder,
  type TickHash,
} from '../headless-run';
import { defineCommand } from '../registry';
import { checkReplay, writeReplay, type ReplayCheck } from '../replay';

/**
 * `run <run-file>`: plays a run file headless (seeded, scripted input) and checks its invariants
 * (every tick) and assertions (at their tick). Stops at the first failing tick.
 *
 * `--disable-rule <ids>` switches kit rules off (comma-separated ids, on top of the run file's
 * `disableRules`); an id the kit does not name is a usage error.
 *
 * A run file plays a game (`game`) or a world scenario (`world`, see `world-run.ts`); the result
 * gives both fields, the one not played as null. A world run has no kit rules: `--disable-rule`
 * on it is a usage error.
 *
 * Result: `{ run, game, world, seed, disabledRules, ticks, lastTick, passed, checks: { assertions, invariants },
 * failure, failures, hashes: [{ tick, hash }], finalHash, orders, ordersPlayed, refusedOrders,
 * missions, missionsPlayed, refusedMissions, experience, hashesChecked, hashMismatch, from, start,
 * codes, codesChecked }`. `start` (Engine 0.14, gap G9) is the run file's `start` (`{ stage }` or
 * `{ entry }`) or null. From Engine 0.13 (decision 9) `from` is the campaign save the run started from
 * (`{ run, code, position, campaign }`: the run file or code it names, the entry and campaign) or
 * null, `codes` counts the run file's expected save codes and `codesChecked` those compared (a
 * different one fails the run like an assertion, kind `code`). `orders` counts the run file's recorded orders, `ordersPlayed`
 * those handed over before `lastTick` and `refusedOrders` (`{ tick, id, error }`) those the world
 * or game dropped (not a failure). `missions`, `missionsPlayed` and `refusedMissions` (`{ tick,
 * mission, action, code, error }`) are the same for mission steps (a world run's, or from Engine
 * 0.11 a game run's, handed to the game's `mission` method), and `experience` (`[{ mission, ticks
 * }]`) the experience ticks its played missions spent (never in the world; on a game run the
 * game's own count of its rounds' ticks, `missionExperience`).
 * `hashMismatch` is the first of the run file's sync `hashes`
 * that differs, `{ tick, expected, actual, lastMatch }` (the state first differs after `lastMatch`
 * and by `tick`), or null; the run stops there and fails. `failure` is the first failed check
 * (`{ tick, kind, index, path, op, expected, actual, message }`) or null, and `failures` every
 * check that failed at that tick. A failing run writes a replay file (`replay.ts`) and gives its
 * path in `replayFile` (null otherwise, and for replays themselves); `debug` (Engine 0.14 T11) is
 * the `pnpm cli debug <file>` line that opens a failed game run in the debugger at its failing
 * tick (null when it passed, and for a world run). On a replay file `replay` is
 * `{ source, expectedTick, reproduced, hashesChecked, hashMismatch }` (null for other run files),
 * and a hash that differs from the stored one fails the run. Exit 0 when every check passed, 4
 * (`failedCheck`) otherwise, 3 (`invalidContent`, with `errors`) when the run file or the game's
 * content breaks its schema.
 */
/** `--disable-rule a,b` as ids (empty when not given). */
export function ruleIds(flag: string | undefined): string[] {
  return (flag ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
}

/**
 * The command line that opens a failed game run in the debugger (Engine 0.14 T11): its replay
 * file (which opens at the failing tick), else the run file itself (a replay that failed again,
 * or a run file whose sync hash differs, opened at that tick). Null for a world run, which the
 * debugger does not step.
 */
export function debugLine(
  runFile: string,
  worldFile: string | null,
  replayFile: string | null,
  mismatchTick: number | null,
): string | null {
  if (worldFile !== null) return null;
  if (replayFile !== null) return `pnpm cli debug ${replayFile}`;
  return `pnpm cli debug ${runFile}${mismatchTick === null ? '' : ` --tick ${mismatchTick}`}`;
}

export const runCommand = defineCommand({
  name: 'run',
  summary: 'play a run file headless from its seed and check its assertions and invariants',
  args: z.strictObject({
    runFile: z.string().min(1).describe('the run file, such as games/demo/runs/walk-east.run.json'),
  }),
  flags: z.strictObject({
    disableRule: z
      .string()
      .min(1)
      .optional()
      .describe("kit rules to switch off, comma-separated ids (see `mutants`), on top of the run file's"),
  }),
  async run({ args, flags }, ctx) {
    const played = await playRun(ctx.cwd, args.runFile, { disableRules: ruleIds(flags.disableRule) });
    if (!played.ok)
      return { exit: EXIT.invalidContent, result: { run: args.runFile, errors: played.errors } };
    const { loaded, seed, disabledRules, lastTick, hashes, failures } = played.value;
    const { ordersPlayed, refusedOrders, hashesChecked, hashMismatch } = played.value;
    const { missionsPlayed, refusedMissions, experience, startSave, codesChecked, start } = played.value;
    const stored = loaded.run.replay;
    const replay = stored ? checkReplay(played.value, stored, ctx.cwd) : null;
    const passed = failures.length === 0 && !replay?.hashMismatch && hashMismatch === null;
    const replayFile = failures.length > 0 && !stored ? writeReplay(played.value, ctx.cwd, ctx.outDir) : null;
    const debug = passed
      ? null
      : debugLine(loaded.file, loaded.worldFile, replayFile, hashMismatch?.tick ?? null);
    return {
      exit: passed ? EXIT.ok : EXIT.failedCheck,
      result: {
        run: loaded.file,
        game: loaded.gameDir,
        world: loaded.worldFile,
        seed,
        disabledRules,
        ticks: loaded.run.ticks,
        lastTick,
        passed,
        checks: { assertions: loaded.run.assertions.length, invariants: loaded.run.invariants.length },
        failure: failures[0] ?? null,
        failures,
        hashes,
        finalHash: hashes[hashes.length - 1]?.hash ?? null,
        orders: loaded.run.orders.length,
        ordersPlayed,
        refusedOrders,
        missions: loaded.run.missions.length,
        missionsPlayed,
        refusedMissions,
        experience,
        hashesChecked,
        hashMismatch,
        from:
          startSave === null
            ? null
            : {
                run: loaded.fromRun,
                code: loaded.run.from?.code ?? null,
                campaign: startSave.campaign,
                position: startSave.position,
              },
        start,
        codes: loaded.run.codes?.length ?? 0,
        codesChecked,
        replayFile,
        replay,
        debug,
      },
    };
  },
  text(result) {
    if (result.errors) return formatErrors(result.errors as ContentError[]);
    const hashes = result.hashes as TickHash[];
    const lines = [
      `${String(result.run)}: ${result.passed ? 'passed' : 'FAILED'} (seed ${String(result.seed)}, ${String(result.lastTick)}/${String(result.ticks)} ticks)`,
    ];
    const from = result.from as {
      run: string | null;
      code: string | null;
      campaign: string;
      position: number;
    } | null;
    if (from)
      lines.push(
        `  from ${from.run ?? `code ${String(from.code)}`}: campaign "${from.campaign}" at entry ${from.position}`,
      );
    const start = result.start as { stage?: number; entry?: string } | null;
    if (start)
      lines.push(
        start.stage !== undefined
          ? `  start: stage ${start.stage}`
          : `  start: entry "${String(start.entry)}"`,
      );
    const off = result.disabledRules as string[];
    if (off.length > 0) lines.push(`  rules off: ${off.join(', ')}`);
    for (const f of result.failures as FailedCheck[])
      lines.push(`  tick ${f.tick}: ${f.kind} ${f.index}: ${f.message}`);
    const orders = result.orders as number;
    const refusedOrders = result.refusedOrders as RefusedOrder[];
    if (orders > 0)
      lines.push(
        `  orders: ${String(result.ordersPlayed)} of ${orders} played, ${refusedOrders.length} refused`,
      );
    for (const r of refusedOrders) lines.push(`  tick ${r.tick}: refused: ${r.error}`);
    const missions = result.missions as number;
    const refusedMissions = result.refusedMissions as RefusedMission[];
    if (missions > 0)
      lines.push(
        `  missions: ${String(result.missionsPlayed)} of ${missions} steps played, ${refusedMissions.length} refused`,
      );
    for (const r of refusedMissions)
      lines.push(`  tick ${r.tick}: refused: ${r.action} "${r.mission}": ${r.code}: ${r.error}`);
    for (const e of result.experience as { mission: string; ticks: number }[])
      lines.push(`  experience: "${e.mission}" ${e.ticks} tick(s) inside, the world did not move`);
    if (
      (result.codesChecked as number) > 0 &&
      !(result.failures as FailedCheck[]).some((f) => f.kind === 'code')
    )
      lines.push(`  ${String(result.codesChecked)} save code(s) match`);
    const mismatch = result.hashMismatch as HashMismatch | null;
    if (mismatch)
      lines.push(
        `  hash MISMATCH at tick ${mismatch.tick}: expected ${mismatch.expected}, got ${mismatch.actual} (the state first differs ${mismatch.lastMatch === null ? 'at or before' : `after tick ${mismatch.lastMatch} and by`} tick ${mismatch.tick})`,
      );
    else if ((result.hashesChecked as number) > 0)
      lines.push(`  ${String(result.hashesChecked)} sync hash(es) match`);
    const replay = result.replay as ReplayCheck | null;
    if (replay) {
      lines.push(
        `  replay of ${replay.source}: ${replay.reproduced ? 'reproduced' : 'NOT reproduced'} the failure at tick ${replay.expectedTick}`,
      );
      const m = replay.hashMismatch;
      lines.push(
        m
          ? `  hash MISMATCH at tick ${m.tick}: stored ${m.expected}, now ${m.actual} (the state differs from the source run by then)`
          : `  ${replay.hashesChecked} stored hash(es) match`,
      );
    }
    if (result.replayFile) lines.push(`  replay file: ${String(result.replayFile)}`);
    if (result.debug) lines.push(`  open it in the debugger: ${String(result.debug)}`);
    for (const h of hashes) lines.push(`  hash @${h.tick}: ${h.hash}`);
    return lines.join('\n');
  },
});
