import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { contentError, type ContentError } from '@engine/core/content/validate';
import {
  DEFAULT_SYSTEM_SET,
  SYSTEM_SETS,
  SYSTEM_SET_NAMES,
  ScenarioError,
  worldFromScenario,
  type SystemSet,
  type SystemSetName,
  type World,
} from '@engine/sim/index';

/**
 * World runs: a run file whose `world` names a `*.world.json` scenario (`engine/sim/scenario.ts`)
 * plays that world instead of a game. The world is built with the engine system set its scenario
 * names in `systems` (`SYSTEM_SETS` in `engine/sim/system-sets.ts`: `village`, the 0.8 haul, build
 * and patrol, when it names none; `rts`, the RTS units and economy), with no event log (the log is
 * not part of a snapshot, so it never changes a hash). A step is `world.step()` and the snapshot is
 * `world.snapshot()`, so a world run's hashes are the same as the ones `engine/sim` tests take
 * (`__fixtures__/village.hashes.json`). A world has no input: a run file drives it with `orders`
 * only (applied with `applyOrder` between ticks, `headless-run.ts`).
 */

/** The system set a scenario names in `systems` (`village` when it names none or a bad one). */
export function worldSystemSet(json: unknown): { name: SystemSetName; set: SystemSet } {
  const named =
    json !== null && typeof json === 'object' && !Array.isArray(json)
      ? (json as { systems?: unknown }).systems
      : undefined;
  const name = SYSTEM_SET_NAMES.find((n) => n === named) ?? DEFAULT_SYSTEM_SET;
  return { name, set: SYSTEM_SETS[name] };
}

/** `entities.0.Position` as a field path (`['entities', 0, 'Position']`). */
const fieldPath = (dotted: string): PropertyKey[] =>
  dotted === '' ? [] : dotted.split('.').map((key) => (/^\d+$/.test(key) ? Number(key) : key));

/**
 * Builds the world of the scenario at `worldFile` (relative to `cwd`), with `seed` in place of the
 * scenario's own when given, and returns it with the name of its system set. A missing file is a content error at the run file's `world`; a
 * scenario that does not build gives one content error per bad field of the scenario.
 */
export function loadWorldRun(
  cwd: string,
  runFile: string,
  worldFile: string,
  seed: number | undefined,
): { ok: true; world: World; systems: SystemSetName } | { ok: false; errors: ContentError[] } {
  const abs = resolve(cwd, worldFile);
  if (!existsSync(abs) || !statSync(abs).isFile())
    return {
      ok: false,
      errors: [contentError(runFile, ['world'], 'missing_file', `no world scenario at ${worldFile}`)],
    };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [contentError(worldFile, [], 'invalid_json', message)] };
  }
  if (seed !== undefined && json !== null && typeof json === 'object' && !Array.isArray(json))
    json = { ...json, seed };
  try {
    // A bad `systems` name is left to the scenario schema, which names the field.
    const { name, set } = worldSystemSet(json);
    const world = worldFromScenario(json, {
      components: set.components,
      systems: set.systems,
      log: { enabled: false },
    });
    return { ok: true, world, systems: name };
  } catch (error) {
    if (!(error instanceof ScenarioError)) throw error;
    return {
      ok: false,
      errors: error.issues.map((i) =>
        contentError(worldFile, fieldPath(i.path), 'invalid_scenario', i.message),
      ),
    };
  }
}
