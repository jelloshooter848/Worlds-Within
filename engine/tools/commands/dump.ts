import { z } from 'zod';
import { formatErrors, type ContentError } from '@engine/core/content/validate';
import { EXIT, UsageError } from '../exit-codes';
import { playRun, stateHash } from '../headless-run';
import { readRunFile } from '../run-file';
import { defineCommand } from '../registry';

/**
 * `dump <run-file> --tick N`: plays the run file up to tick N (no checks) and prints the whole
 * snapshot there (a game's, or for a world run the world's `World.snapshot()`). Result: `{ run,
 * game, world, seed, tick, hash, state, orders }` (`game` or `world` null, whichever is not
 * played; `orders` the recorded order entries applied before tick N, those with `tick < N`); the cap (`--max-output`)
 * applies as for every command. N must be between 0 and the run's `ticks` (a usage error
 * otherwise). Exit 0, or 3 (`invalidContent`, with `errors`) when the run file or content is bad.
 */
export const dumpCommand = defineCommand({
  name: 'dump',
  summary: 'the whole game or world state at one tick of a run file, as JSON',
  args: z.strictObject({
    runFile: z.string().min(1).describe('the run file, such as games/demo/runs/walk-east.run.json'),
  }),
  flags: z.strictObject({
    tick: z.number().int().min(0).describe('the tick to show (0 is the start, before any step)'),
  }),
  async run({ args, flags }, ctx) {
    const runFile = readRunFile(ctx.cwd, args.runFile);
    if (runFile.ok && flags.tick > runFile.value.run.ticks)
      throw new UsageError(`--tick ${flags.tick} is after the run's last tick (${runFile.value.run.ticks})`);
    const played = await playRun(ctx.cwd, args.runFile, { untilTick: flags.tick });
    if (!played.ok)
      return { exit: EXIT.invalidContent, result: { run: args.runFile, errors: played.errors } };
    const { loaded, seed, lastTick, snapshot } = played.value;
    return {
      exit: EXIT.ok,
      result: {
        run: loaded.file,
        game: loaded.gameDir,
        world: loaded.worldFile,
        seed,
        tick: lastTick,
        hash: stateHash(snapshot),
        state: snapshot,
        orders: loaded.run.orders.filter((o) => o.tick < lastTick),
      },
    };
  },
  text(result) {
    if (result.errors) return formatErrors(result.errors as ContentError[]);
    return `${String(result.run)} @ tick ${String(result.tick)} (hash ${String(result.hash)})\n${JSON.stringify(result.state, null, 2)}`;
  },
});
