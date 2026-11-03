import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, relative, resolve } from 'node:path';
import type { JsonObject } from '@engine/core/headless';
import { MANIFEST_FILE } from '@engine/core/content/manifest';
import { contentError, type ContentError } from '@engine/core/content/validate';
import { DUMP_FORMAT, parseDumpFile } from '../dump-file';
import { UsageError } from '../exit-codes';
import { loadGame } from '../game-loader';
import { headlessRules, playRun, stateHash } from '../headless-run';
import { readRunFile } from '../run-file';
import { launchChromium, servedPath, serveRepo, type ServedRepo } from '../screenshot';
import {
  DEBUG_JOB_PATH,
  DEBUG_PAGE,
  type DebugCheck,
  type DebugJob,
  type DebugKind,
  type DebugRunJob,
  type ExpectedHash,
} from './job';

/**
 * The debugger's Node side (Engine 0.14 T10): reading the file `pnpm cli debug` is given into a
 * job for the page (`buildDebugJob`), serving the page with the job (`startDebugServer`, the
 * screenshot command's Vite server with one read-only route for the job), and opening it in
 * headless Chromium at a tick to read what it shows (`checkInBrowser`, for `debug --check` and
 * the browser tests). The page itself (`page.ts`, `model.ts`) never reads a file.
 */

/** A job built, with what the CLI prints and checks beside it. */
export interface BuiltJob {
  job: DebugJob;
  /** The game folder (relative to the working folder), or null for a dump without a game run. */
  game: string | null;
  /** The headless run's state hash at the open tick (null for a dump that cannot be played). */
  headlessHash: string | null;
  /** Folders outside the repo Vite must serve (the game folder). */
  allow: string[];
}

export type BuildOutcome = { ok: true; value: BuiltJob } | { ok: false; errors: ContentError[] };

/** What kind of file `json` is: a dump (its `format`), a replay (a `replay` block) or a run file. */
export function debugKindOf(json: unknown): DebugKind {
  if (typeof json === 'object' && json !== null && !Array.isArray(json)) {
    const obj = json as Record<string, unknown>;
    if (obj['format'] === DUMP_FORMAT) return 'dump';
    if (obj['replay'] !== undefined) return 'replay';
  }
  return 'run';
}

/** The golden hashes next to a run file (`<name>.hashes.json`), or none. */
function goldenHashes(cwd: string, runFile: string): ExpectedHash[] {
  const path = resolve(cwd, runFile.replace(/\.run\.json$/, '.hashes.json'));
  if (path === resolve(cwd, runFile) || !existsSync(path)) return [];
  const golden = JSON.parse(readFileSync(path, 'utf8')) as { hashes?: { tick: number; hash: string }[] };
  return (golden.hashes ?? []).map((h) => ({ tick: h.tick, hash: h.hash, source: 'golden' as const }));
}

/**
 * The run job for a game run file at `file`, opening at `openTick` (checked against its ticks by
 * the caller), with the headless run's hash at that tick. A world run is a usage error: the page
 * steps games (open a world run's dump file instead).
 */
async function buildRunJob(
  cwd: string,
  file: string,
  openTick: number | undefined,
): Promise<
  | { ok: true; job: DebugRunJob; headlessHash: string; allow: string[] }
  | { ok: false; errors: ContentError[] }
> {
  const runFile = readRunFile(cwd, file);
  if (!runFile.ok) return runFile;
  const { run, worldFile, gameDir } = runFile.value;
  if (worldFile !== null)
    throw new UsageError(
      `${runFile.value.file} plays a world (${worldFile}); the debugger steps game runs. Open a dump of it instead: pnpm cli dump ${runFile.value.file} --tick N --out <file>.json`,
    );
  const kind = run.replay === undefined ? 'run' : 'replay';
  const tick = openTick ?? (run.replay === undefined ? 0 : Math.min(run.replay.failure.tick, run.ticks));
  if (tick > run.ticks) throw new UsageError(`--tick ${tick} is after the run's last tick (${run.ticks})`);
  const played = await playRun(cwd, file, { untilTick: tick });
  if (!played.ok) return played;
  const { loaded, seed, kit, disabledRulesByKit, startSave, start, snapshot } = played.value;
  const game = loadGame(cwd, gameDir ?? '.');
  if (!game.content.ok) return { ok: false, errors: game.content.errors };
  const root = game.dir === '.' ? '' : `${game.dir}/`;
  const { headless, view, screen } = game.content.value.manifest;
  const gameAbs = resolve(cwd, game.dir);
  const viewAbs = view === undefined ? null : resolve(gameAbs, view);
  if (viewAbs !== null && !existsSync(viewAbs)) {
    const where = `${root}${MANIFEST_FILE}`;
    return {
      ok: false,
      errors: [contentError(where, ['view'], 'missing_file', `no file at ${root}${view}`)],
    };
  }
  const checks: DebugCheck[] = [
    ...run.assertions.map((c, index) => ({
      kind: 'assertion' as const,
      index,
      tick: c.tick,
      path: c.path,
      op: c.op,
      value: c.value,
    })),
    ...run.invariants.map((c, index) => ({
      kind: 'invariant' as const,
      index,
      tick: null,
      path: c.path,
      op: c.op,
      value: c.value,
    })),
  ];
  const expected: ExpectedHash[] = [
    ...(kind === 'run' ? goldenHashes(cwd, loaded.file) : []),
    ...(run.hashes ?? []).map((h) => ({ ...h, source: 'run' as const })),
    ...(run.replay?.hashes ?? []).map((h) => ({ ...h, source: 'replay' as const })),
  ].sort((a, b) => a.tick - b.tick);
  const failure = run.replay?.failure;
  const job: DebugRunJob = {
    kind,
    file: loaded.file,
    game: game.dir,
    files: { ...game.texts },
    root,
    headlessUrl: servedPath(resolve(gameAbs, headless)),
    viewUrl: viewAbs === null ? null : servedPath(viewAbs),
    seed,
    ticks: run.ticks,
    hashEvery: run.hashEvery,
    input: run.input,
    orders: run.orders as ({ tick: number } & JsonObject)[],
    missions: run.missions as unknown as ({ tick: number } & JsonObject)[],
    ...headlessRules(kit ?? '', disabledRulesByKit),
    campaign: startSave,
    start,
    screen,
    checks,
    expected,
    failure:
      failure === undefined
        ? null
        : { tick: failure.tick, kind: failure.kind, path: failure.path, message: failure.message },
    openTick: tick,
  };
  return { ok: true, job, headlessHash: stateHash(snapshot), allow: [gameAbs] };
}

/**
 * Reads the file `debug` is given into a page job: a run file, a replay file or a dump file (told
 * apart by their shape, `debugKindOf`). A run or replay opens at `tick` (default: 0, or a
 * replay's failing tick); a dump opens at its own tick (another `--tick` is a usage error) and
 * carries its run as a run job when that is a game run file that is there, for Play from here.
 * A file that is not there is a usage error; one that breaks its schema comes back as content errors.
 */
export async function buildDebugJob(cwd: string, file: string, tick?: number): Promise<BuildOutcome> {
  const abs = resolve(cwd, file);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new UsageError(`no file at ${file}`);
  const rel = relative(cwd, abs).replaceAll('\\', '/');
  const text = readFileSync(abs, 'utf8');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [contentError(rel, [], 'invalid_json', message)] };
  }
  if (debugKindOf(json) !== 'dump') {
    const built = await buildRunJob(cwd, rel, tick);
    if (!built.ok) return built;
    return {
      ok: true,
      value: { job: built.job, game: built.job.game, headlessHash: built.headlessHash, allow: built.allow },
    };
  }
  const parsed = parseDumpFile(text);
  if (!parsed.ok)
    return {
      ok: false,
      errors: parsed.errors.map((message) => contentError(rel, [], 'invalid_dump', message)),
    };
  const { dump } = parsed;
  if (tick !== undefined && tick !== dump.tick)
    throw new UsageError(
      `${rel} is a dump of tick ${dump.tick}; it opens there (leave out --tick, or pass ${dump.tick})`,
    );
  const runPath = relative(cwd, resolve(dirname(abs), dump.run)).replaceAll('\\', '/');
  let run: DebugRunJob | null = null;
  let headlessHash: string | null = null;
  let allow: string[] = [];
  if (dump.world === null && existsSync(resolve(cwd, runPath))) {
    const built = await buildRunJob(cwd, runPath, dump.tick);
    if (!built.ok) return built;
    run = built.job;
    headlessHash = built.headlessHash;
    allow = built.allow;
  }
  return {
    ok: true,
    value: {
      job: { kind: 'dump', file: rel, dump, run, openTick: dump.tick },
      game: run?.game ?? null,
      headlessHash,
      allow,
    },
  };
}

/** A running debug server: the page's URL (opening at the job's tick) and how to stop it. */
export interface DebugServer {
  url: string;
  close(): Promise<void>;
}

const open = new Set<DebugServer>();

/**
 * Serves the repo with Vite and the job at {@link DEBUG_JOB_PATH} (GET only, the job in memory),
 * and returns the page's URL with `?tick=` the job's open tick. The server stays up until closed
 * (`pnpm cli debug` keeps the process running for it).
 */
export async function startDebugServer(
  built: Pick<BuiltJob, 'job' | 'allow'>,
  port?: number,
): Promise<DebugServer> {
  const body = JSON.stringify(built.job);
  const served: ServedRepo = await serveRepo({
    allow: built.allow,
    ...(port === undefined ? {} : { port }),
    handle(req: IncomingMessage, res: ServerResponse) {
      if (new URL(req.url ?? '/', 'http://x').pathname !== DEBUG_JOB_PATH) return false;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET' }).end();
        return true;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(body);
      return true;
    },
  });
  const server: DebugServer = {
    url: `${served.base}/${DEBUG_PAGE}?tick=${built.job.openTick}`,
    async close() {
      open.delete(server);
      await served.close();
    },
  };
  open.add(server);
  return server;
}

/** Stops every debug server this process started (for tests). */
export async function closeDebugServers(): Promise<void> {
  await Promise.all([...open].map((s) => s.close()));
}

/** What the page shows at the tick it was opened at (`window.__wwDebugger`). */
export interface PageReading {
  kind: DebugKind;
  tick: number;
  hash: string;
  /** The page's first mismatch (a stored hash, a rewind, the view), or null. */
  mismatch: { tick: number; kind: string; expected: string; actual: string } | null;
  /** The world's kept changes at that tick, or null for a game with no world. */
  eventCount: number | null;
}

/**
 * Opens the debugger on `built` in headless Chromium, waits for it to load, goes to the open tick
 * and reads what it shows. Throws when the page reports an error or does not start.
 */
export async function checkInBrowser(
  built: Pick<BuiltJob, 'job' | 'allow'>,
  port?: number,
): Promise<PageReading & { url: string }> {
  const browser = await launchChromium();
  const server = await startDebugServer(built, port);
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(server.url);
    try {
      await page.waitForFunction(
        () => window.__wwDebugger?.ready === true || window.__wwDebugger?.error,
        undefined,
        {
          timeout: 120_000,
        },
      );
    } catch (error) {
      const why = errors.length > 0 ? errors.join('; ') : String(error);
      throw new Error(`the debugger page did not start: ${why}`, { cause: error });
    }
    const reading = await page.evaluate((tick) => {
      const api = window.__wwDebugger!;
      if (api.error) return { error: api.error };
      if (api.kind !== 'dump') api.goto(tick);
      return {
        kind: api.kind,
        tick: api.tick,
        hash: api.hash(),
        mismatch: api.mismatch(),
        eventCount: api.eventCount(),
      };
    }, built.job.openTick);
    if ('error' in reading) throw new Error(`the debugger page failed: ${String(reading.error)}`);
    return { ...reading, url: server.url };
  } finally {
    await browser.close();
    await server.close();
  }
}
