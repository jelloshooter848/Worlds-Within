import { z } from 'zod';
import { formatErrors, type ContentError } from '@engine/core/content/validate';
import type { JsonValue } from '@engine/core/headless';
import { EXIT, UsageError } from '../exit-codes';
import { playRun, stateHash } from '../headless-run';
import { readRunFile, valueAt } from '../run-file';
import { defineCommand } from '../registry';

/**
 * `trace <run-file> --paths a,b [--from N] [--to M] [--every K]` (Engine 0.14, gap G8, decision 5,
 * item 251): plays the run file headless with no checks, like `dump` (recorded orders, mission
 * steps, `from` and `start` applied as `run` applies them), and reads a few snapshot paths at every K-th
 * tick from N to M: one row per traced tick, `{ tick, hash, values: { <path>: value } }`. Result:
 * `{ run, game, world, seed, start, from, to, every, paths, rows, missing, orders, missions }`. A path
 * not in the snapshot at a tick gives null there; `missing` lists each such path with the first
 * traced tick it was missing at and at how many traced ticks it was (a path holding a real null
 * is not missing). `rows` is a top-level array so the output cap halves it (whole rows), and the
 * full trace is in the `fullOutput` file. `orders` and `missions` are the entries applied before
 * the last traced tick (`tick < to`), as in `dump`.
 *
 * Usage errors (exit 2): no paths, an empty path or segment (`a..b`), a path listed twice, `--from`
 * after `--to`, `--to` after the run's `ticks`, `--every` below 1. Exit 3 (with `errors`) when the
 * run file or the content is bad.
 */

/** A traced tick: its tick, its state hash and the value at every path (null when missing). */
export interface TraceRow {
  tick: number;
  hash: string;
  values: Record<string, JsonValue | null>;
}

/** A path that was not in the snapshot at some traced ticks. */
export interface MissingPath {
  path: string;
  /** The first traced tick it was missing at. */
  firstTick: number;
  /** How many traced ticks it was missing at. */
  ticks: number;
}

/** `--paths a,b,c` as a list of dotted paths; every problem is a usage error. */
export function tracePaths(flag: string): string[] {
  const paths = flag.split(',').map((p) => p.trim());
  if (paths.every((p) => p === '')) throw new UsageError('--paths needs at least one path, such as hero.x');
  const seen = new Set<string>();
  for (const path of paths) {
    if (path === '') throw new UsageError(`--paths "${flag}" has an empty path (two commas in a row?)`);
    if (path.split('.').some((key) => key === ''))
      throw new UsageError(`--paths: "${path}" has an empty segment (dotted paths, such as hero.x)`);
    if (seen.has(path)) throw new UsageError(`--paths: "${path}" is listed twice`);
    seen.add(path);
  }
  return paths;
}

/** The trace as an aligned table, one column per path (values as JSON). */
export function traceTable(rows: readonly TraceRow[], paths: readonly string[]): string {
  const head = ['tick', 'hash', ...paths];
  const body = rows.map((r) => [
    String(r.tick),
    r.hash,
    ...paths.map((p) => JSON.stringify(r.values[p] ?? null)),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((cells) => cells[i]!.length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === 0 ? c.padStart(widths[i]!) : c.padEnd(widths[i]!)))
      .join('  ')
      .trimEnd();
  return [line(head), ...body.map(line)].join('\n');
}

export const traceCommand = defineCommand({
  name: 'trace',
  summary: 'a few snapshot paths over a range of ticks of a run file, one row per traced tick',
  args: z.strictObject({
    runFile: z
      .string()
      .min(1)
      .describe('the run file, such as games/samples/dungeon/runs/walk-east.run.json'),
  }),
  flags: z.strictObject({
    paths: z
      .string()
      .min(1)
      .describe('the snapshot paths to read, comma-separated dotted paths (hero.x,hero.room)'),
    from: z.number().int().min(0).optional().describe('the first tick to trace (default 0, the start)'),
    to: z.number().int().min(0).optional().describe("the last tick to trace (default the run's ticks)"),
    every: z.number().int().min(1).optional().describe('trace every K-th tick from --from (default 1)'),
  }),
  async run({ args, flags }, ctx) {
    const paths = tracePaths(flags.paths);
    const runFile = readRunFile(ctx.cwd, args.runFile);
    if (!runFile.ok)
      return { exit: EXIT.invalidContent, result: { run: args.runFile, errors: runFile.errors } };
    const ticks = runFile.value.run.ticks;
    const from = flags.from ?? 0;
    const to = flags.to ?? ticks;
    const every = flags.every ?? 1;
    if (to > ticks) throw new UsageError(`--to ${to} is after the run's last tick (${ticks})`);
    if (from > to) throw new UsageError(`--from ${from} is after --to ${to}`);

    const rows: TraceRow[] = [];
    const missing = new Map<string, MissingPath>();
    const played = await playRun(ctx.cwd, args.runFile, {
      untilTick: to,
      onTick(tick, snapshot, keys) {
        if (tick < from || (tick - from) % every !== 0) return;
        const values: Record<string, JsonValue | null> = {};
        for (const path of paths) {
          const value = valueAt(snapshot, path, keys);
          values[path] = value ?? null;
          if (value !== undefined) continue;
          const seen = missing.get(path);
          if (seen) seen.ticks++;
          else missing.set(path, { path, firstTick: tick, ticks: 1 });
        }
        rows.push({ tick, hash: stateHash(snapshot), values });
      },
    });
    if (!played.ok)
      return { exit: EXIT.invalidContent, result: { run: args.runFile, errors: played.errors } };
    const { loaded, seed, lastTick, start } = played.value;
    return {
      exit: EXIT.ok,
      result: {
        run: loaded.file,
        game: loaded.gameDir,
        world: loaded.worldFile,
        seed,
        start,
        from,
        to,
        every,
        paths,
        rows,
        missing: [...missing.values()],
        orders: loaded.run.orders.filter((o) => o.tick < lastTick),
        missions: loaded.run.missions.filter((m) => m.tick < lastTick),
      },
    };
  },
  text(result) {
    if (result.errors) return formatErrors(result.errors as ContentError[]);
    const paths = result.paths as string[];
    const rows = (result.rows as TraceRow[] | undefined) ?? [];
    const head = `${String(result.run)}: ticks ${String(result.from)}-${String(result.to)} every ${String(result.every)} (${rows.length} rows)`;
    const missing = ((result.missing as MissingPath[] | undefined) ?? []).map(
      (m) => `missing: ${m.path} at ${m.ticks} traced tick(s), first at tick ${m.firstTick}`,
    );
    return [head, traceTable(rows, paths), ...missing].join('\n');
  },
});
