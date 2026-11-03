import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { z } from 'zod';
import { formatErrors, type ContentError } from '@engine/core/content/validate';
import { DUMP_FORMAT, DUMP_VERSION, dumpFileSchema, type DumpFile } from '../dump-file';
import { EXIT, UsageError } from '../exit-codes';
import { playRun, stateHash } from '../headless-run';
import { readRunFile } from '../run-file';
import { defineCommand } from '../registry';

const slash = (path: string) => path.replaceAll('\\', '/');

/**
 * `dump <run-file> --tick N`: plays the run file up to tick N (no checks) and prints the whole
 * snapshot there (a game's, or for a world run the world's `World.snapshot()`). Result: `{ run,
 * game, world, seed, start, tick, hash, state, orders, missions }` (`game` or `world` null, whichever is
 * not played; `orders` the recorded order entries applied before tick N, those with `tick < N`, and
 * `missions` the mission steps likewise); the cap (`--max-output`)
 * applies as for every command. N must be between 0 and the run's `ticks` (a usage error
 * otherwise). `start` is the run file's `start` (Engine 0.14, gap G9) or null: tick N counts from
 * that level or entry. Exit 0, or 3 (`invalidContent`, with `errors`) when the run file or content is bad.
 *
 * `--out <file>.json` (Engine 0.14 T7, decision 2) also writes a dump file for the debugger
 * (`dump-file.ts`: `{ format: "worlds-within/dump", version: 1, run, game, world, ..., state,
 * orders, missions, events, timeline }`, paths relative to the dump file, `events` and `timeline`
 * null for a game with no world) and prints the result without `state`, plus `out` (relative to
 * the working folder) and `bytes`. A path not ending in `.json` is a usage error.
 */
export const dumpCommand = defineCommand({
  name: 'dump',
  summary: 'the whole game or world state at one tick of a run file, as JSON',
  args: z.strictObject({
    runFile: z.string().min(1).describe('the run file, such as games/demo/runs/walk-east.run.json'),
  }),
  flags: z.strictObject({
    tick: z.number().int().min(0).describe('the tick to show (0 is the start, before any step)'),
    out: z
      .string()
      .min(1)
      .optional()
      .describe('also write a dump file for the debugger (state, event log and timeline) to this .json path'),
  }),
  async run({ args, flags }, ctx) {
    const runFile = readRunFile(ctx.cwd, args.runFile);
    if (runFile.ok && flags.tick > runFile.value.run.ticks)
      throw new UsageError(`--tick ${flags.tick} is after the run's last tick (${runFile.value.run.ticks})`);
    if (flags.out !== undefined && !flags.out.endsWith('.json'))
      throw new UsageError(`--out ${flags.out}: a dump file is JSON, so its name ends in .json`);
    const played = await playRun(ctx.cwd, args.runFile, {
      untilTick: flags.tick,
      withWorld: flags.out !== undefined,
    });
    if (!played.ok)
      return { exit: EXIT.invalidContent, result: { run: args.runFile, errors: played.errors } };
    const { loaded, seed, lastTick, snapshot, start } = played.value;
    const result = {
      run: loaded.file,
      game: loaded.gameDir,
      world: loaded.worldFile,
      seed,
      start,
      tick: lastTick,
      hash: stateHash(snapshot),
      state: snapshot,
      orders: loaded.run.orders.filter((o) => o.tick < lastTick),
      missions: loaded.run.missions.filter((m) => m.tick < lastTick),
    };
    if (flags.out === undefined) return { exit: EXIT.ok, result };

    const outAbs = resolve(ctx.cwd, flags.out);
    const fromDump = (path: string) => slash(relative(dirname(outAbs), resolve(ctx.cwd, path))) || '.';
    const dump: DumpFile = dumpFileSchema.parse({
      format: DUMP_FORMAT,
      version: DUMP_VERSION,
      ...result,
      run: fromDump(loaded.file),
      game: loaded.gameDir === null ? null : fromDump(loaded.gameDir),
      world: loaded.worldFile === null ? null : fromDump(loaded.worldFile),
      events: played.value.worldEvents ?? null,
      timeline: played.value.timeline ?? null,
    });
    const text = `${JSON.stringify(dump)}\n`;
    mkdirSync(dirname(outAbs), { recursive: true });
    writeFileSync(outAbs, text);
    const { state: _state, ...rest } = result;
    return {
      exit: EXIT.ok,
      result: {
        ...rest,
        out: slash(relative(ctx.cwd, outAbs)),
        bytes: Buffer.byteLength(text),
        format: DUMP_FORMAT,
        events: dump.events === null ? null : dump.events.changes.length,
        timeline: dump.timeline !== null,
      },
    };
  },
  text(result) {
    if (result.errors) return formatErrors(result.errors as ContentError[]);
    if (result.out !== undefined)
      return `${String(result.run)} @ tick ${String(result.tick)} (hash ${String(result.hash)}): wrote ${String(result.out)} (${String(result.bytes)} bytes; ${result.events === null ? 'no world' : `${String(result.events)} events, timeline`})`;
    return `${String(result.run)} @ tick ${String(result.tick)} (hash ${String(result.hash)})\n${JSON.stringify(result.state, null, 2)}`;
  },
});
