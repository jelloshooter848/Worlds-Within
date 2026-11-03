import { z } from 'zod';
import { formatErrors, type ContentError } from '@engine/core/content/validate';
import { EXIT } from '../exit-codes';
import { defineCommand } from '../registry';
import type { StoredFailure } from '../debugger/job';
import type { FailureReading } from '../debugger/model';
import { buildDebugJob, checkInBrowser, startDebugServer } from '../debugger/server';

/**
 * `debug <file> [--tick N] [--port P] [--check]` (Engine 0.14 T10; docs/BUILD-LOG.md, Engine
 * 0.14, decisions 1 and 2): opens the in-browser simulation debugger (`engine/tools/debugger/`) on
 * a run file, a replay file or a dump file (`dump --out`), told apart by their shape. It serves
 * the repo with Vite (the screenshot command's server) and the file as a job for the page, prints
 * `{ url, file, kind, game, ticks, openTick, failure, serving }` (`failure` a replay's stored
 * `replay.failure`, else null) and stays up until stopped (Ctrl-C); open
 * the URL in a browser, or drive it with Playwright through `window.__wwDebugger`.
 *
 * A run opens at `--tick` (default 0), a replay at its failing tick, a dump at its own tick (read
 * only; another `--tick` is a usage error). A world run is a usage error: the page steps game runs
 * (open a world run's dump file instead).
 *
 * `--check` opens the page in headless Chromium instead, goes to the open tick, reads what the
 * page shows and stops: the result adds `{ tick, hash, headlessHash, matchesHeadless, mismatch,
 * eventCount }` (`hash` the page's state hash there, `headlessHash` the headless run's, `mismatch`
 * the page's first stored-hash, rewind or view mismatch, `eventCount` the world's kept changes or
 * null for a game with no world). Engine 0.14 T11: also `{ failure, reproduced, hashMismatch }`:
 * `failure` a replay's stored check as the page found it at its tick (`FailureReading`: with
 * `actual`, `reached`, `tickBefore`), `reproduced` whether the page failed that same check there
 * (null for a run or dump, or a save code check), `hashMismatch` the page's first stored hash
 * that differs (`{ tick, expected, actual, source }`, a replay's `replay.hashes` included) or
 * null. Exit 4 when the hashes differ, the page found a mismatch or a replay did not reproduce,
 * so the page itself is CLI-checkable.
 *
 * Exit 0; 2 for a file that is not there, a `--tick` past the run's ticks, a world run or a
 * dump's other tick; 3 for a run file, dump file or game content that breaks its schema; 4 as
 * above; 5 when Chromium is not installed (`--check`).
 */
export const debugCommand = defineCommand({
  name: 'debug',
  summary: 'the in-browser simulation debugger on a run, replay or dump file (state, events, stepping)',
  args: z.strictObject({
    file: z
      .string()
      .min(1)
      .describe('a run file, a replay file or a dump file, such as games/demo/runs/walk-east.run.json'),
  }),
  flags: z.strictObject({
    tick: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("the tick to open at (default 0; a replay's failing tick; a dump's own tick)"),
    port: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .optional()
      .describe('the local port to serve on (default: a free one)'),
    check: z
      .boolean()
      .default(false)
      .describe(
        "open the page in headless Chromium at the tick, compare its hash with the headless run's, and stop",
      ),
  }),
  async run({ args, flags }, ctx) {
    const built = await buildDebugJob(ctx.cwd, args.file, flags.tick);
    if (!built.ok) return { exit: EXIT.invalidContent, result: { file: args.file, errors: built.errors } };
    const { job, game } = built.value;
    const ticks = job.kind === 'dump' ? (job.run?.ticks ?? job.openTick) : job.ticks;
    const stored = job.kind === 'dump' ? null : job.failure;
    const head = { file: job.file, kind: job.kind, game, ticks, openTick: job.openTick };
    if (!flags.check) {
      const server = await startDebugServer(built.value, flags.port);
      return {
        exit: EXIT.ok,
        result: { url: server.url, ...head, failure: stored, serving: true },
      };
    }
    const page = await checkInBrowser(built.value, flags.port);
    const { headlessHash } = built.value;
    const matchesHeadless = headlessHash === null ? null : page.hash === headlessHash;
    // A replay (Engine 0.14 T11): did the page fail the stored check at its tick, and did a stored
    // hash (`replay.hashes`, a golden or sync hash) differ on the way there?
    const reproduced = page.failure?.reproduced ?? null;
    const m = page.mismatch;
    const hashMismatch =
      m !== null && m.kind === 'stored'
        ? { tick: m.tick, expected: m.expected, actual: m.actual, source: m.source ?? null }
        : null;
    const passed = matchesHeadless !== false && page.mismatch === null && reproduced !== false;
    return {
      exit: passed ? EXIT.ok : EXIT.failedCheck,
      result: {
        url: page.url,
        ...head,
        serving: false,
        tick: page.tick,
        hash: page.hash,
        headlessHash,
        matchesHeadless,
        mismatch: page.mismatch,
        eventCount: page.eventCount,
        failure: page.failure,
        reproduced,
        hashMismatch,
      },
    };
  },
  text(result) {
    if (result.errors) return formatErrors(result.errors as ContentError[]);
    const what = `${String(result.kind)} ${String(result.file)}`;
    const failure = (result.failure ?? null) as FailureReading | StoredFailure | null;
    const failed =
      failure === null
        ? []
        : [
            `failed check at tick ${failure.tick}: ${failure.kind} ${failure.path} ${failure.op} ${JSON.stringify(failure.expected)}${'actual' in failure && failure.reached ? `, actual ${JSON.stringify(failure.actual)}` : ''} (${failure.message})`,
          ];
    if (result.serving)
      return [
        `Debugger for ${what}: ${String(result.url)}`,
        ...failed,
        'Serving until stopped (Ctrl-C).',
      ].join('\n');
    const ok = result.matchesHeadless !== false && result.mismatch === null;
    const lines = [
      `${what} @ tick ${String(result.tick)}: page hash ${String(result.hash)}, headless ${String(result.headlessHash)}${ok ? '' : ' (MISMATCH)'}`,
      ...failed,
    ];
    if (result.reproduced !== null)
      lines.push(result.reproduced ? '  reproduced in the page' : '  NOT reproduced in the page');
    const hm = result.hashMismatch as { tick: number; expected: string; actual: string } | null;
    if (hm)
      lines.push(`  first stored hash mismatch at tick ${hm.tick}: stored ${hm.expected}, page ${hm.actual}`);
    return lines.join('\n');
  },
});
