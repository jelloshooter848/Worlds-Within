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
import { unknownRules } from '@engine/core/rules';
import { UsageError } from './exit-codes';
import { loadGame } from './game-loader';
import { kitRules } from './kits';
import { failsCheck, readRunFile, type CheckOp, type LoadedRunFile } from './run-file';
import { loadWorldRun } from './world-run';

/**
 * Plays a run file headless: loads the game's content, imports its headless module (the
 * `headless` path in `game.json`, by its path at run time: never a static import), and steps the
 * game tick by tick with the run's scripted input, checking invariants and assertions and hashing
 * the state. A world run (`world` in the run file) builds the world from its scenario instead
 * (`world-run.ts`) and steps it with no input. Used by `run` and `dump`.
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
  /** The game's kit (`kit` in `game.json`); null for a world run, which has no kit. */
  kit: string | null;
  /** The kit rules switched off (the run file's `disableRules` plus any asked for), in kit order. */
  disabledRules: string[];
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

export interface PlayOptions {
  /** Play only this far and make no checks (for `dump`). */
  untilTick?: number;
  /**
   * Kit rules to switch off on top of the run file's `disableRules` (`--disable-rule`, `mutants`).
   * An id that is not one of the kit's rules is a usage error.
   */
  disableRules?: readonly string[];
}

/**
 * Plays the run file at `runPath` (relative to `cwd`). With `untilTick` it plays only that far and
 * makes no checks (for `dump`); otherwise it plays every tick and stops at the first failing tick.
 * A rule in the run file's `disableRules` or `guards` that the game's kit does not name is a
 * content error (`unknown_rule`, at that entry).
 */
export async function playRun(cwd: string, runPath: string, opts: PlayOptions = {}): Promise<PlayOutcome> {
  const runFile = readRunFile(cwd, runPath);
  if (!runFile.ok) return runFile;
  const loaded = runFile.value;
  if (loaded.worldFile !== null) {
    if ((opts.disableRules ?? []).length > 0)
      throw new UsageError(`${loaded.file} plays a world, which has no kit rules to switch off`);
    const built = loadWorldRun(cwd, loaded.file, loaded.worldFile, loaded.run.seed);
    if (!built.ok) return built;
    const { world } = built;
    const stepper: Stepper = { step: () => world.step(), snapshot: () => world.snapshot() };
    return { ok: true, value: play(loaded, stepper, world.seed, null, [], opts) };
  }
  const { run } = loaded;
  const game = loadGame(cwd, loaded.gameDir ?? '.');
  if (!game.content.ok) return { ok: false, errors: game.content.errors };
  const content = game.content.value;
  const imported = await importEntry(cwd, game.dir, content);
  if (!imported.ok) return imported;

  const rules = kitRules(content.manifest.kit);
  const known = rules.map((r) => r.id).join(', ') || 'none';
  const lists = [
    ['disableRules', run.disableRules],
    ['guards', run.guards ?? []],
  ] as const;
  const badInFile = lists.flatMap(([field, ids]) =>
    ids.flatMap((id, i) =>
      unknownRules(rules, [id]).length > 0
        ? [
            contentError(
              loaded.file,
              [field, i],
              'unknown_rule',
              `kit "${content.manifest.kit}" has no rule "${id}" in "${field}" (known: ${known})`,
            ),
          ]
        : [],
    ),
  );
  if (badInFile.length > 0) return { ok: false, errors: badInFile };
  const asked = opts.disableRules ?? [];
  const badAsked = unknownRules(rules, asked);
  if (badAsked.length > 0)
    throw new UsageError(
      `kit "${content.manifest.kit}" has no rule ${badAsked.map((id) => `"${id}"`).join(', ')} (known: ${known})`,
    );
  const off = new Set([...run.disableRules, ...asked]);
  const disabledRules = rules.filter((r) => off.has(r.id)).map((r) => r.id);

  const seed = run.seed ?? content.manifest.start.seed;
  const instance: HeadlessGame = imported.entry.createGame(content, seed, { disabledRules });
  const input = new ScriptedInput(run.input);
  const stepper: Stepper = {
    step: () => {
      input.next();
      instance.step(input);
    },
    snapshot: () => instance.snapshot(),
  };
  return { ok: true, value: play(loaded, stepper, seed, content.manifest.kit, disabledRules, opts) };
}

/** What `play` needs of a game or a world: one step, and the snapshot after it. */
interface Stepper {
  step(): void;
  snapshot(): JsonObject;
}

/** Steps a game or world tick by tick, making the run file's checks and hashing the state. */
function play(
  loaded: LoadedRunFile,
  stepper: Stepper,
  seed: number,
  kit: string | null,
  disabledRules: string[],
  opts: PlayOptions,
): PlayedRun {
  const { run } = loaded;
  const checking = opts.untilTick === undefined;
  const last = opts.untilTick ?? run.ticks;
  const hashes: TickHash[] = [];
  const failures: FailedCheck[] = [];
  let snapshot = stepper.snapshot();

  for (let tick = 0; ; tick++) {
    if (tick > 0) {
      stepper.step();
      snapshot = stepper.snapshot();
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
    if (end) return { loaded, seed, kit, disabledRules, lastTick: tick, hashes, failures, snapshot };
  }
}
