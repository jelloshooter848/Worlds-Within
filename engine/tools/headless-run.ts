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
import { applyOrder, type MissionDef } from '@engine/sim/index';
import { failsCheck, readRunFile, type CheckOp, type LoadedRunFile, type OrderEntry } from './run-file';
import {
  applyMissionStep,
  loadMissionDefs,
  loadWorldRun,
  settleWorld,
  type MissionStep,
  type RefusedMission,
} from './world-run';

export type { RefusedMission } from './world-run';

/**
 * Plays a run file headless: loads the game's content, imports its headless module (the
 * `headless` path in `game.json`, by its path at run time: never a static import), and steps the
 * game tick by tick with the run's scripted input, checking invariants and assertions and hashing
 * the state. A world run (`world` in the run file) builds the world from its scenario instead
 * (`world-run.ts`) and steps it with no input. Recorded `orders` are applied in lockstep: each one
 * after the state of its tick (checks and hash taken) and before the step from it, on a world with
 * `applyOrder`, on a game through its `order` method. A world run's `missions` steps go in right
 * after their tick's orders, and the world settles its missions after every step (each commits by
 * itself at its commit tick). Used by `run` and `dump`.
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

/** An order the world or game dropped: its tick, its `id` (null when it has none) and why. */
export interface RefusedOrder {
  tick: number;
  id: number | null;
  error: string;
}

/**
 * The first sync hash (the run file's `hashes`) that differs from the run's: the tick, the stored
 * hash, the run's, and the last tick whose stored hash still matched (null when none did), so the
 * state first differs after `lastMatch` and by `tick`.
 */
export interface HashMismatch {
  tick: number;
  expected: string;
  actual: string;
  lastMatch: number | null;
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
  /** The recorded orders handed over (applied or refused) before `lastTick`. */
  ordersPlayed: number;
  /** The orders the world or game dropped, in the order they came. */
  refusedOrders: RefusedOrder[];
  /** The mission steps handed over (applied or refused) before `lastTick`. */
  missionsPlayed: number;
  /** The mission steps the world refused, in the order they came. */
  refusedMissions: RefusedMission[];
  /**
   * Experience ticks the played (or quit) missions spent inside their stand-in rounds, per mission
   * in first-step order: counted here, never in the world (they cannot move it).
   */
  experience: { mission: string; ticks: number }[];
  /** How many of the run file's sync `hashes` were compared (0 without `hashes`). */
  hashesChecked: number;
  /** The first sync hash that differed (the run stops there), or null. */
  hashMismatch: HashMismatch | null;
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
    const { world, keys } = built;
    let defs: ReadonlyMap<string, MissionDef> = new Map();
    if (loaded.run.missions.length > 0) {
      const read = loadMissionDefs(cwd, loaded.file, loaded.worldFile, loaded.run.missions);
      if (!read.ok) return read;
      defs = read.defs;
    }
    // Orders are RTS orders (`engine/core/orders.ts`): only the `rts` systems carry them out.
    if (loaded.run.orders.length > 0 && built.systems !== 'rts')
      return {
        ok: false,
        errors: [
          contentError(
            loaded.file,
            ['orders'],
            'no_orders',
            `${loaded.worldFile} runs the "${built.systems}" system set, which takes no orders: orders need "systems": "rts" in the scenario`,
          ),
        ],
      };
    const stepper: Stepper = {
      step: () => {
        world.step();
        settleWorld(world);
      },
      snapshot: () => world.snapshot(),
      order: (order) => {
        const applied = applyOrder(world, order);
        return applied.ok ? null : applied.error;
      },
      mission: (step) => applyMissionStep(world, step, defs, keys),
    };
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
  if (run.orders.length > 0 && typeof instance.order !== 'function')
    throw new UsageError(
      `${loaded.file} has orders, but the game's headless module (${content.manifest.headless}) takes none: its game has no order(order) method (engine/core/headless.ts)`,
    );
  const input = new ScriptedInput(run.input);
  const stepper: Stepper = {
    step: () => {
      input.next();
      instance.step(input);
    },
    snapshot: () => instance.snapshot(),
    order: (order) => instance.order?.(order) ?? null,
  };
  return { ok: true, value: play(loaded, stepper, seed, content.manifest.kit, disabledRules, opts) };
}

/** What `play` needs of a game or a world: one step, the snapshot after it, and taking an order. */
interface Stepper {
  step(): void;
  snapshot(): JsonObject;
  /** Applies one order between steps: null when applied, else why it was dropped. */
  order(order: JsonObject): string | null;
  /** Applies one mission step between steps (world runs only): null when taken, else the refusal. */
  mission?(step: MissionStep): { code: string; error: string } | null;
}

/** An entry's order: the entry without its `tick`. */
export function orderOf(entry: OrderEntry): JsonObject {
  const { tick: _tick, ...order } = entry;
  return order as JsonObject;
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
  const refusedOrders: RefusedOrder[] = [];
  const refusedMissions: RefusedMission[] = [];
  const experience = new Map<string, number>();
  const stored = new Map((checking ? (run.hashes ?? []) : []).map((h) => [h.tick, h.hash]));
  let hashesChecked = 0;
  let hashMismatch: HashMismatch | null = null;
  let lastMatch: number | null = null;
  let next = 0; // the next order entry to hand over
  let nextMission = 0; // the next mission step to hand over
  let snapshot = stepper.snapshot();

  for (let tick = 0; ; tick++) {
    if (tick > 0) {
      // Lockstep: the orders of the previous tick go in after its state, before the step from it.
      for (; next < run.orders.length && run.orders[next]!.tick === tick - 1; next++) {
        const entry = run.orders[next]!;
        const error = stepper.order(orderOf(entry));
        if (error !== null) refusedOrders.push({ tick: entry.tick, id: entry.id ?? null, error });
      }
      // Then that tick's mission steps, in file order.
      for (
        ;
        nextMission < run.missions.length && run.missions[nextMission]!.tick === tick - 1;
        nextMission++
      ) {
        const step = run.missions[nextMission]!;
        const refused = stepper.mission?.(step) ?? null;
        if (refused !== null)
          refusedMissions.push({ tick: step.tick, mission: step.mission, action: step.action, ...refused });
        else if (step.experienceTicks !== undefined)
          experience.set(step.mission, (experience.get(step.mission) ?? 0) + step.experienceTicks);
      }
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
    const want = stored.get(tick);
    let hash: string | null = null;
    if (want !== undefined) {
      hash = stateHash(snapshot);
      hashesChecked++;
      if (hash === want) lastMatch = tick;
      else hashMismatch = { tick, expected: want, actual: hash, lastMatch };
    }
    const end = tick === last || failures.length > 0 || hashMismatch !== null;
    if (tick % run.hashEvery === 0 || end || want !== undefined)
      hashes.push({ tick, hash: hash ?? stateHash(snapshot) });
    if (end)
      return {
        loaded,
        seed,
        kit,
        disabledRules,
        lastTick: tick,
        hashes,
        failures,
        snapshot,
        ordersPlayed: next,
        refusedOrders,
        missionsPlayed: nextMission,
        refusedMissions,
        experience: [...experience].map(([mission, ticks]) => ({ mission, ticks })),
        hashesChecked,
        hashMismatch,
      };
  }
}
