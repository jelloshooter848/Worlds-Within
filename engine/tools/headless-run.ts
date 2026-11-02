import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ContentBundle } from '@engine/core/content/bundle';
import { MANIFEST_FILE } from '@engine/core/content/manifest';
import { contentError, type ContentError } from '@engine/core/content/validate';
import {
  canonicalJson,
  type HeadlessEntry,
  type HeadlessGame,
  type JsonObject,
  type JsonValue,
} from '@engine/core/headless';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { loadGame } from './game-loader';
import { failsCheck, readRunFile, type CheckOp, type LoadedRunFile } from './run-file';

/**
 * Plays a run file headless: loads the game's content, imports its headless module (the
 * `headless` path in `game.json`, by its path at run time: never a static import), and steps the
 * game tick by tick with the run's scripted input, checking invariants and assertions and hashing
 * the state. Used by `run` and `dump`.
 */

/**
 * The state hash: the first 16 hex digits (64 bits) of the SHA-256 of the snapshot's canonical
 * JSON (`canonicalJson` in `engine/core/headless.ts`). Same state, same hash, on every machine.
 */
export function stateHash(snapshot: JsonObject): string {
  return createHash('sha256').update(canonicalJson(snapshot)).digest('hex').slice(0, 16);
}

/** A check that failed: which one, at which tick, and what the snapshot held. */
export interface FailedCheck {
  tick: number;
  kind: 'assertion' | 'invariant';
  /** Its index in the run file's `assertions` or `invariants`. */
  index: number;
  path: string;
  op: CheckOp;
  expected: JsonValue;
  /** The value at the path (null when the path is not in the snapshot). */
  actual: JsonValue | null;
  message: string;
}

export interface TickHash {
  tick: number;
  hash: string;
}

/** A run that got as far as playing (its content and run file were valid). */
export interface PlayedRun {
  loaded: LoadedRunFile;
  seed: number;
  /** The last tick played: the run's `ticks`, the first failing tick, or the tick asked for. */
  lastTick: number;
  hashes: TickHash[];
  /** Every check that failed at the first failing tick (empty when all passed). */
  failures: FailedCheck[];
  /** The snapshot at `lastTick`. */
  snapshot: JsonObject;
}

export type PlayOutcome = { ok: true; value: PlayedRun } | { ok: false; errors: ContentError[] };

/** Imports the game's headless module. A missing file is a content error at `headless` in `game.json`. */
async function importEntry(
  cwd: string,
  gameDir: string,
  content: ContentBundle,
): Promise<{ ok: true; entry: HeadlessEntry } | { ok: false; errors: ContentError[] }> {
  const root = gameDir === '.' ? '' : `${gameDir}/`;
  const path = content.manifest.headless;
  const abs = resolve(cwd, gameDir, path);
  const where = `${root}${MANIFEST_FILE}`;
  if (!existsSync(abs))
    return {
      ok: false,
      errors: [contentError(where, ['headless'], 'missing_file', `no file at ${root}${path}`)],
    };
  const mod = (await import(pathToFileURL(abs).href)) as Partial<HeadlessEntry>;
  if (typeof mod.createGame !== 'function') {
    const message = `${root}${path} does not export createGame(content, seed) (engine/core/headless.ts)`;
    return { ok: false, errors: [contentError(where, ['headless'], 'no_headless_entry', message)] };
  }
  return { ok: true, entry: mod as HeadlessEntry };
}

/**
 * Plays the run file at `runPath` (relative to `cwd`). With `untilTick` it plays only that far and
 * makes no checks (for `dump`); otherwise it plays every tick and stops at the first failing tick.
 */
export async function playRun(
  cwd: string,
  runPath: string,
  opts: { untilTick?: number } = {},
): Promise<PlayOutcome> {
  const runFile = readRunFile(cwd, runPath);
  if (!runFile.ok) return runFile;
  const loaded = runFile.value;
  const { run } = loaded;
  const game = loadGame(cwd, loaded.gameDir);
  if (!game.content.ok) return { ok: false, errors: game.content.errors };
  const content = game.content.value;
  const imported = await importEntry(cwd, game.dir, content);
  if (!imported.ok) return imported;

  const seed = run.seed ?? content.manifest.start.seed;
  const instance: HeadlessGame = imported.entry.createGame(content, seed);
  const input = new ScriptedInput(run.input);
  const checking = opts.untilTick === undefined;
  const last = opts.untilTick ?? run.ticks;
  const hashes: TickHash[] = [];
  const failures: FailedCheck[] = [];
  let snapshot = instance.snapshot();

  for (let tick = 0; ; tick++) {
    if (tick > 0) {
      input.next();
      instance.step(input);
      snapshot = instance.snapshot();
    }
    if (checking) {
      run.invariants.forEach((c, index) => {
        const failed = failsCheck(snapshot, c);
        if (failed)
          failures.push({
            tick,
            kind: 'invariant',
            index,
            path: c.path,
            op: c.op,
            expected: c.value,
            ...failed,
          });
      });
      run.assertions.forEach((c, index) => {
        if (c.tick !== tick) return;
        const failed = failsCheck(snapshot, c);
        if (failed)
          failures.push({
            tick,
            kind: 'assertion',
            index,
            path: c.path,
            op: c.op,
            expected: c.value,
            ...failed,
          });
      });
    }
    const end = tick === last || failures.length > 0;
    if (tick % run.hashEvery === 0 || end) hashes.push({ tick, hash: stateHash(snapshot) });
    if (end) return { ok: true, value: { loaded, seed, lastTick: tick, hashes, failures, snapshot } };
  }
}
