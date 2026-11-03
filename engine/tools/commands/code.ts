import { z } from 'zod';
import { contentError, formatErrors, type ContentError } from '@engine/core/content/validate';
import { EXIT, UsageError } from '../exit-codes';
import { playRun, saveCodeNow, stateHash } from '../headless-run';
import { readRunFile } from '../run-file';
import { defineCommand } from '../registry';

/**
 * `code <run-file> [--tick N]` (Engine 0.13, decision 9, item 228): plays a game run file (no
 * checks) to its last tick, or to tick N, and prints the save code of the game's campaign save
 * there (`HeadlessGame.campaignSave`, packed by `engine/core/campaign-code.ts`), the code a later
 * run's `from: { "code": ... }` or a player starts from. Result: `{ run, game, seed, start, tick, hash,
 * code, save }` (`save` the campaign save the code packs). Exit 0; 3 (with `errors`) for a bad run
 * file or content, a game that gives no campaign save there (`no_campaign`), or a save the code
 * cannot hold (`code_record`, ...); 2 for a world run, a game with no `campaignSave`, or a bad
 * `--tick`.
 */
export const codeCommand = defineCommand({
  name: 'code',
  summary: "the save code of a game run's campaign save at its last tick (or --tick N)",
  args: z.strictObject({
    runFile: z
      .string()
      .min(1)
      .describe('a game run file, such as games/samples/mini-siege/runs/played.run.json'),
  }),
  flags: z.strictObject({
    tick: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("the tick to take the code at; the run's last tick when left out"),
  }),
  async run({ args, flags }, ctx) {
    const runFile = readRunFile(ctx.cwd, args.runFile);
    if (!runFile.ok)
      return { exit: EXIT.invalidContent, result: { run: args.runFile, errors: runFile.errors } };
    const loaded = runFile.value;
    if (loaded.worldFile !== null)
      throw new UsageError(
        `${loaded.file} plays a world, which has no campaign: save codes are for game runs`,
      );
    const tick = flags.tick ?? loaded.run.ticks;
    if (tick > loaded.run.ticks)
      throw new UsageError(`--tick ${tick} is after the run's last tick (${loaded.run.ticks})`);
    const played = await playRun(ctx.cwd, args.runFile, { untilTick: tick, withSave: true });
    if (!played.ok) return { exit: EXIT.invalidContent, result: { run: loaded.file, errors: played.errors } };
    const { seed, lastTick, snapshot, campaignSave, codeContext, start } = played.value;
    if (campaignSave === undefined || codeContext === null)
      throw new UsageError(
        `${loaded.file}: the game's headless module plays no campaign: its game has no campaignSave() method (engine/core/headless.ts)`,
      );
    const now = saveCodeNow(campaignSave, codeContext);
    if (!now.ok)
      return {
        exit: EXIT.invalidContent,
        result: {
          run: loaded.file,
          errors: [contentError(loaded.file, [], now.code, `at tick ${lastTick}: ${now.error}`)],
        },
      };
    return {
      exit: EXIT.ok,
      result: {
        run: loaded.file,
        game: loaded.gameDir,
        seed,
        start,
        tick: lastTick,
        hash: stateHash(snapshot),
        code: now.code,
        save: campaignSave,
      },
    };
  },
  text(result) {
    if (result.errors) return formatErrors(result.errors as ContentError[]);
    return `${String(result.run)} @ tick ${String(result.tick)}: ${String(result.code)}`;
  },
});
