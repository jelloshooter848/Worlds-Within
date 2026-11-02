import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { canonicalJson, type JsonValue } from '@engine/core/headless';
import type { FailedCheck, PlayedRun, TickHash } from './headless-run';
import type { Replay } from './run-file';

/**
 * Replay files: when `run` fails a check, it writes a run file that plays the same seed and input
 * up to the first failing tick and makes the same checks, plus a `replay` block with the source
 * run, the failed check and the state hashes so far. A replay is an ordinary run file (`run` and
 * `dump` take it); on a replay `run` also checks the stored hashes and reports the first tick
 * whose hash differs, which says the game changed there.
 *
 * Replays go to `<outDir>/replays/<source name>-t<tick>-<hash>.run.json` (the output folder,
 * `.ww-out/` by default, git-ignored). The name comes from the content, so the same failure
 * writes the same file.
 */

/** The folder under the tools output folder that replay files go to. */
export const REPLAY_DIR = 'replays';

const slash = (path: string) => path.replaceAll('\\', '/');

/** The replay file's JSON for a run that failed (its `failures` are not empty). */
export function replayOf(played: PlayedRun, cwd: string, replayDir: string): Record<string, unknown> {
  const failure = played.failures[0];
  if (!failure) throw new Error('replayOf needs a failed run');
  const { run } = played.loaded;
  const tick = failure.tick;
  const fromReplay = (path: string) => slash(relative(replayDir, resolve(cwd, path))) || '.';
  const replay: Replay = {
    source: fromReplay(played.loaded.file),
    failure: {
      tick,
      kind: failure.kind,
      path: failure.path,
      op: failure.op,
      expected: failure.expected,
      message: failure.message,
    },
    hashes: played.hashes,
  };
  return {
    // The game or the world the source run played (a run file names exactly one).
    ...(played.loaded.worldFile !== null
      ? { world: fromReplay(played.loaded.worldFile) }
      : { game: fromReplay(played.loaded.gameDir ?? '.') }),
    seed: played.seed,
    // A run plays at least one tick; a failure at tick 0 still stops the replay there.
    ticks: Math.max(tick, 1),
    input: { steps: run.input.steps.filter((s) => s.frame <= tick) },
    assertions: run.assertions.filter((a) => a.tick <= tick),
    invariants: run.invariants,
    hashEvery: run.hashEvery,
    // The rules that were off (the run file's and any `--disable-rule`), so the replay fails alike.
    ...(played.disabledRules.length > 0 ? { disableRules: played.disabledRules } : {}),
    replay,
  };
}

/** Writes the replay file for a failed run and returns its path relative to `cwd`. */
export function writeReplay(played: PlayedRun, cwd: string, outDir: string): string {
  const dir = resolve(cwd, outDir, REPLAY_DIR);
  const text = `${JSON.stringify(replayOf(played, cwd, dir), null, 2)}\n`;
  const name = basename(played.loaded.file).replace(/(\.run)?\.json$/, '');
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 12);
  const file = join(dir, `${name}-t${played.failures[0]!.tick}-${hash}.run.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return slash(relative(cwd, file));
}

/** What `run` found when it played a replay file. */
export interface ReplayCheck {
  /** The source run file, relative to the working folder. */
  source: string;
  /** The tick the source run first failed at. */
  expectedTick: number;
  /** True when the replay failed first at the same tick, with the same check. */
  reproduced: boolean;
  /** How many stored hashes had a hash at the same tick in this run to compare with. */
  hashesChecked: number;
  /** The first tick whose hash differs from the stored one, or null when all matched. */
  hashMismatch: { tick: number; expected: string; actual: string } | null;
}

const sameCheck = (a: FailedCheck, b: Replay['failure']) =>
  a.tick === b.tick &&
  a.kind === b.kind &&
  a.path === b.path &&
  a.op === b.op &&
  canonicalJson(a.expected) === canonicalJson(b.expected as JsonValue);

/** Compares a replay's run with what its `replay` block stored. */
export function checkReplay(played: PlayedRun, replay: Replay, cwd: string): ReplayCheck {
  const runDir = dirname(resolve(cwd, played.loaded.file));
  const now = new Map<number, string>(played.hashes.map((h: TickHash) => [h.tick, h.hash]));
  let hashesChecked = 0;
  let hashMismatch: ReplayCheck['hashMismatch'] = null;
  for (const stored of [...replay.hashes].sort((a, b) => a.tick - b.tick)) {
    const actual = now.get(stored.tick);
    if (actual === undefined) continue;
    hashesChecked++;
    if (actual !== stored.hash) {
      hashMismatch = { tick: stored.tick, expected: stored.hash, actual };
      break;
    }
  }
  const first = played.failures[0];
  return {
    source: slash(relative(cwd, resolve(runDir, replay.source))),
    expectedTick: replay.failure.tick,
    reproduced: first !== undefined && sameCheck(first, replay.failure),
    hashesChecked,
    hashMismatch,
  };
}
