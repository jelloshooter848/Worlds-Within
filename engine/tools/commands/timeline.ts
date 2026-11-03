import { z } from 'zod';
import { formatErrors, type ContentError } from '@engine/core/content/validate';
import { timelineEntries, type TimelineEntry } from '@engine/sim/index';
import { EXIT, UsageError } from '../exit-codes';
import { readRunFile } from '../run-file';
import { defineCommand } from '../registry';
import { playWorldData } from '../world-data';

/**
 * `timeline <run-file> [--tick N]` (Engine 0.14 T7; docs/BUILD-LOG.md, Engine 0.14, decision 4,
 * item 250): plays the run file to tick N (default its last; no checks, like `dump`) and prints
 * the world's timeline record there (`engine/sim/timeline.ts`, `worlds-within/timeline`): world
 * tick, frozen spans, experience per mission, opportunity windows with their status history, and
 * the missions opened and committed (outcome, open and commit ticks); for a game run with its
 * `clock`, the world tick per game tick, run-length (one entry where the rate changes: a played
 * round holds the world still). Result: `{ run, game, world, seed, start, tick, ticks, worldTick,
 * logFrom, timeline, entries }`: `ticks` the run's, `entries` the record as one list of happenings
 * by world tick (`timelineEntries`: `{ tick, game, kind, id, by, detail }`, `game` the game tick
 * it fell on), a top-level array so the output cap halves it.
 *
 * A game without `HeadlessGame.timeline` (a platformer) is exit 3, `no_world` at `headless` in its
 * `game.json`. Usage errors (exit 2): `--tick` after the run's `ticks`. Exit 3 for a bad run file
 * or content.
 */

/** One entry as a text line: `world 40 (game 40)  open         sabotage  by mission:sabotage`. */
export function entryLine(e: TimelineEntry): string {
  const at = `world ${e.tick}${e.game !== null ? ` (game ${e.game})` : ''}`;
  const detail = e.detail !== null ? ` -> ${e.detail}` : '';
  const by = e.by !== null ? `  by ${e.by}` : '';
  return `${at.padEnd(22)} ${e.kind.padEnd(11)} ${e.id}${detail}${by}`;
}

export const timelineCommand = defineCommand({
  name: 'timeline',
  summary: 'the world time, opportunities, frozen events and commits of a run file, as data',
  args: z.strictObject({
    runFile: z
      .string()
      .min(1)
      .describe('the run file, such as games/samples/mini-siege/runs/played.run.json'),
  }),
  flags: z.strictObject({
    tick: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("the tick to read the record at (default the run's last)"),
  }),
  async run({ args, flags }, ctx) {
    const runFile = readRunFile(ctx.cwd, args.runFile);
    if (!runFile.ok)
      return { exit: EXIT.invalidContent, result: { run: args.runFile, errors: runFile.errors } };
    const ticks = runFile.value.run.ticks;
    if (flags.tick !== undefined && flags.tick > ticks)
      throw new UsageError(`--tick ${flags.tick} is after the run's last tick (${ticks})`);
    const data = await playWorldData(ctx.cwd, args.runFile, flags.tick ?? ticks);
    if (!data.ok) return { exit: EXIT.invalidContent, result: { run: args.runFile, errors: data.errors } };
    const { played, timeline } = data.value;
    return {
      exit: EXIT.ok,
      result: {
        run: played.loaded.file,
        game: played.loaded.gameDir,
        world: played.loaded.worldFile,
        seed: played.seed,
        start: played.start,
        tick: played.lastTick,
        ticks,
        worldTick: timeline.worldTick,
        logFrom: timeline.logFrom,
        timeline,
        entries: timelineEntries(timeline),
      },
    };
  },
  text(result) {
    if (result.errors) return formatErrors(result.errors as ContentError[]);
    const entries = (result.entries as TimelineEntry[] | undefined) ?? [];
    const head = `${String(result.run)} @ tick ${String(result.tick)}: world tick ${String(result.worldTick)}, ${entries.length} entries (log kept from ${String(result.logFrom)})`;
    return [head, ...entries.map(entryLine)].join('\n');
  },
});
