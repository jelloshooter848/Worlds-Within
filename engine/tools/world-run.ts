import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { contentError, type ContentError } from '@engine/core/content/validate';
import {
  STANDARD_COMPONENTS,
  SYSTEM_COMPONENTS,
  ScenarioError,
  Terrain,
  buildSystem,
  haulSystem,
  patrolSystem,
  worldFromScenario,
  type AnyComponent,
  type System,
  type World,
} from '@engine/sim/index';

/**
 * World runs: a run file whose `world` names a `*.world.json` scenario (`engine/sim/scenario.ts`)
 * plays that world instead of a game. The world is built with every engine component kind
 * (`WORLD_COMPONENTS`) and the engine's systems in a fixed order (`WORLD_SYSTEMS`), with no event
 * log (the log is not part of a snapshot, so it never changes a hash). A step is `world.step()`
 * and the snapshot is `world.snapshot()`, so a world run's hashes are the same as the ones
 * `engine/sim` tests take (`__fixtures__/village.hashes.json`). A world has no input in Engine
 * 0.8: the run file may not script any.
 */

/** The component kinds a world run knows: the standard ones, `Terrain` and the systems' own. */
export const WORLD_COMPONENTS: readonly AnyComponent[] = [
  ...STANDARD_COMPONENTS,
  Terrain,
  ...SYSTEM_COMPONENTS,
];

/** The systems a world run steps, in run order (as in `engine/sim/sample-world.test.ts`). */
export const WORLD_SYSTEMS: readonly System[] = [haulSystem, buildSystem, patrolSystem];

/** `entities.0.Position` as a field path (`['entities', 0, 'Position']`). */
const fieldPath = (dotted: string): PropertyKey[] =>
  dotted === '' ? [] : dotted.split('.').map((key) => (/^\d+$/.test(key) ? Number(key) : key));

/**
 * Builds the world of the scenario at `worldFile` (relative to `cwd`), with `seed` in place of the
 * scenario's own when given. A missing file is a content error at the run file's `world`; a
 * scenario that does not build gives one content error per bad field of the scenario.
 */
export function loadWorldRun(
  cwd: string,
  runFile: string,
  worldFile: string,
  seed: number | undefined,
): { ok: true; world: World } | { ok: false; errors: ContentError[] } {
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
    const world = worldFromScenario(json, {
      components: WORLD_COMPONENTS,
      systems: WORLD_SYSTEMS,
      log: { enabled: false },
    });
    return { ok: true, world };
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
