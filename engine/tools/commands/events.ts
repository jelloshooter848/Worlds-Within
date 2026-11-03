import { z } from 'zod';
import { formatErrors, type ContentError } from '@engine/core/content/validate';
import type { Change } from '@engine/sim/index';
import { causeMatches, changeLine, filterChanges } from '../event-filter';
import { EXIT, UsageError } from '../exit-codes';
import { readRunFile } from '../run-file';
import { defineCommand } from '../registry';
import { playWorldData } from '../world-data';

/**
 * `events <run-file> [--from N] [--to M] [--entity id] [--cause c] [--component name]` (Engine
 * 0.14 T7; docs/BUILD-LOG.md, Engine 0.14, decision 3, item 249): plays the run file to its last
 * tick (no checks, like `dump`) and prints the world's event log: every kept change (`Change`,
 * `engine/sim/events.ts`: `{ tick, cause, op, entity, component?, before?, value? }`) with world
 * tick N to M (both included; world ticks, which a game run's played rounds hold still), for one
 * entity, one cause (exact, or every `<c>:...` cause: `--cause mission` matches
 * `mission:sabotage`) and one component. Result: `{ run, game, world, seed, start, tick,
 * worldTick, logFrom, from, to, entity, cause, component, count, events }`, `events` a top-level
 * array so the output cap halves it (whole changes). `logFrom` is the oldest world tick the log
 * keeps: asking for older ticks gives what is kept.
 *
 * A world run is played with its event log on; a game gives its log through
 * `HeadlessGame.worldEvents` (the mini siege, the RTS skirmish). A game without it (a platformer)
 * is exit 3, `no_world` at `headless` in its `game.json`. Usage errors (exit 2): `--from` after
 * `--to`. Exit 3 for a bad run file or content.
 */

export { causeMatches, changeLine };

export const eventsCommand = defineCommand({
  name: 'events',
  summary: "the world's event log of a run file: every change with its world tick and cause",
  args: z.strictObject({
    runFile: z
      .string()
      .min(1)
      .describe('the run file, such as games/samples/mini-siege/runs/played.run.json'),
  }),
  flags: z.strictObject({
    from: z.number().int().min(0).optional().describe('the first world tick to list (default 0)'),
    to: z.number().int().min(0).optional().describe('the last world tick to list (default the last one)'),
    entity: z.number().int().min(1).optional().describe('only changes to this entity id'),
    cause: z
      .string()
      .min(1)
      .optional()
      .describe('only changes with this cause, or its sub-causes (mission matches mission:sabotage)'),
    component: z.string().min(1).optional().describe('only changes to this component (WorldTime, Health...)'),
  }),
  async run({ args, flags }, ctx) {
    if (flags.from !== undefined && flags.to !== undefined && flags.from > flags.to)
      throw new UsageError(`--from ${flags.from} is after --to ${flags.to}`);
    const runFile = readRunFile(ctx.cwd, args.runFile);
    if (!runFile.ok)
      return { exit: EXIT.invalidContent, result: { run: args.runFile, errors: runFile.errors } };
    const data = await playWorldData(ctx.cwd, args.runFile, runFile.value.run.ticks);
    if (!data.ok) return { exit: EXIT.invalidContent, result: { run: args.runFile, errors: data.errors } };
    const { played, events: log } = data.value;
    const from = flags.from ?? 0;
    const to = flags.to ?? log.tick;
    const events = filterChanges(log.changes as Change[], {
      from,
      to,
      ...(flags.entity === undefined ? {} : { entity: flags.entity }),
      ...(flags.cause === undefined ? {} : { cause: flags.cause }),
      ...(flags.component === undefined ? {} : { component: flags.component }),
    });
    return {
      exit: EXIT.ok,
      result: {
        run: played.loaded.file,
        game: played.loaded.gameDir,
        world: played.loaded.worldFile,
        seed: played.seed,
        start: played.start,
        tick: played.lastTick,
        worldTick: log.tick,
        logFrom: log.from,
        from,
        to,
        entity: flags.entity ?? null,
        cause: flags.cause ?? null,
        component: flags.component ?? null,
        count: events.length,
        events,
      },
    };
  },
  text(result) {
    if (result.errors) return formatErrors(result.errors as ContentError[]);
    const events = (result.events as Change[] | undefined) ?? [];
    const head = `${String(result.run)}: ${String(result.count)} change(s), world ticks ${String(result.from)}-${String(result.to)} (log kept from ${String(result.logFrom)}, world tick ${String(result.worldTick)})`;
    return [head, ...events.map(changeLine)].join('\n');
  },
});
