import { z } from 'zod';
import { formatErrors, type ContentError } from '@engine/core/content/validate';
import { EXIT } from '../exit-codes';
import { playRun, type FailedCheck, type TickHash } from '../headless-run';
import { defineCommand } from '../registry';
import { checkReplay, writeReplay, type ReplayCheck } from '../replay';

/**
 * `run <run-file>`: plays a run file headless (seeded, scripted input) and checks its invariants
 * (every tick) and assertions (at their tick). Stops at the first failing tick.
 *
 * Result: `{ run, game, seed, ticks, lastTick, passed, checks: { assertions, invariants },
 * failure, failures, hashes: [{ tick, hash }], finalHash }`. `failure` is the first failed check
 * (`{ tick, kind, index, path, op, expected, actual, message }`) or null, and `failures` every
 * check that failed at that tick. A failing run writes a replay file (`replay.ts`) and gives its
 * path in `replayFile` (null otherwise, and for replays themselves). On a replay file `replay` is
 * `{ source, expectedTick, reproduced, hashesChecked, hashMismatch }` (null for other run files),
 * and a hash that differs from the stored one fails the run. Exit 0 when every check passed, 4
 * (`failedCheck`) otherwise, 3 (`invalidContent`, with `errors`) when the run file or the game's
 * content breaks its schema.
 */
export const runCommand = defineCommand({
  name: 'run',
  summary: 'play a run file headless from its seed and check its assertions and invariants',
  args: z.strictObject({
    runFile: z.string().min(1).describe('the run file, such as games/demo/runs/walk-east.run.json'),
  }),
  flags: z.strictObject({}),
  async run({ args }, ctx) {
    const played = await playRun(ctx.cwd, args.runFile);
    if (!played.ok)
      return { exit: EXIT.invalidContent, result: { run: args.runFile, errors: played.errors } };
    const { loaded, seed, lastTick, hashes, failures } = played.value;
    const stored = loaded.run.replay;
    const replay = stored ? checkReplay(played.value, stored, ctx.cwd) : null;
    const passed = failures.length === 0 && !replay?.hashMismatch;
    const replayFile = failures.length > 0 && !stored ? writeReplay(played.value, ctx.cwd, ctx.outDir) : null;
    return {
      exit: passed ? EXIT.ok : EXIT.failedCheck,
      result: {
        run: loaded.file,
        game: loaded.gameDir,
        seed,
        ticks: loaded.run.ticks,
        lastTick,
        passed,
        checks: { assertions: loaded.run.assertions.length, invariants: loaded.run.invariants.length },
        failure: failures[0] ?? null,
        failures,
        hashes,
        finalHash: hashes[hashes.length - 1]?.hash ?? null,
        replayFile,
        replay,
      },
    };
  },
  text(result) {
    if (result.errors) return formatErrors(result.errors as ContentError[]);
    const hashes = result.hashes as TickHash[];
    const lines = [
      `${String(result.run)}: ${result.passed ? 'passed' : 'FAILED'} (seed ${String(result.seed)}, ${String(result.lastTick)}/${String(result.ticks)} ticks)`,
    ];
    for (const f of result.failures as FailedCheck[])
      lines.push(`  tick ${f.tick}: ${f.kind} ${f.index}: ${f.message}`);
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
    for (const h of hashes) lines.push(`  hash @${h.tick}: ${h.hash}`);
    return lines.join('\n');
  },
});
