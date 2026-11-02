import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { contentError, validate, type ContentError } from '@engine/core/content/validate';
import {
  DEFAULT_SYSTEM_SET,
  delegateMission,
  missionSchema,
  openMission,
  playMission,
  quitMission,
  scenarioKeys,
  settleMissions,
  type Entity,
  type MissionDef,
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
 * (applied with `applyOrder` between ticks, `headless-run.ts`) and `missions` (Engine 0.10, item
 * 161: `applyMissionEntry` below, with `settleMissions` after every step, so a mission commits by
 * itself at its commit tick and opportunity windows open and close on time).
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
):
  | { ok: true; world: World; systems: SystemSetName; keys: Record<string, Entity> }
  | { ok: false; errors: ContentError[] } {
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
    return { ok: true, world, systems: name, keys: scenarioKeys(json) };
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

/** One `missions` entry of a run file (`run-file.ts`). */
export interface MissionStep {
  tick: number;
  mission: string;
  action: 'open' | 'delegate' | 'play' | 'quit';
  outcome?: string;
  experienceTicks?: number;
}

/** Where the definition of mission `id` may be: beside the scenario, or in a `missions/` folder there. */
export function missionFileCandidates(worldFile: string, id: string): string[] {
  const dir = dirname(worldFile);
  return [join(dir, `${id}.mission.json`), join(dir, 'missions', `${id}.mission.json`)].map((p) =>
    p.replaceAll('\\', '/'),
  );
}

/**
 * Reads the definition of every mission the run file's `missions` name (`<id>.mission.json`, see
 * `missionFileCandidates`), checked with the `mission` content kind's schema. A mission with no file
 * is a `missing_file` error at the run file's first entry naming it; a bad file gives its own
 * errors (file and field), and an `id` that is not the file name is `id_mismatch`. Then the steps
 * are checked against the definitions: a `play` or `quit` at or after the commit tick its `open`
 * fixes (open tick + `worldTimeCost`) is `mission_unresolved` (BUILD-LOG, Engine 0.10, decision 2:
 * the cost has run out by then, so the mission was delegated).
 */
export function loadMissionDefs(
  cwd: string,
  runFile: string,
  worldFile: string,
  steps: readonly MissionStep[],
): { ok: true; defs: Map<string, MissionDef> } | { ok: false; errors: ContentError[] } {
  const defs = new Map<string, MissionDef>();
  const errors: ContentError[] = [];
  const tried = new Set<string>();
  steps.forEach((step, i) => {
    if (tried.has(step.mission)) return;
    tried.add(step.mission);
    const candidates = missionFileCandidates(worldFile, step.mission);
    const file = candidates.find((c) => existsSync(resolve(cwd, c)) && statSync(resolve(cwd, c)).isFile());
    if (file === undefined) {
      errors.push(
        contentError(
          runFile,
          ['missions', i, 'mission'],
          'missing_file',
          `no mission "${step.mission}": looked for ${candidates.join(' and ')}`,
        ),
      );
      return;
    }
    const shown = relative(cwd, resolve(cwd, file)).replaceAll('\\', '/');
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(resolve(cwd, file), 'utf8'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(contentError(shown, [], 'invalid_json', message));
      return;
    }
    const checked = validate(shown, json, missionSchema);
    if (!checked.ok) {
      errors.push(...checked.errors);
      return;
    }
    if (checked.value.id !== step.mission) {
      errors.push(
        contentError(
          shown,
          ['id'],
          'id_mismatch',
          `id "${checked.value.id}" must match the file name "${step.mission}"`,
        ),
      );
      return;
    }
    defs.set(step.mission, checked.value);
  });
  if (errors.length > 0) return { ok: false, errors };

  const commitTicks = new Map<string, number>();
  steps.forEach((step, i) => {
    const def = defs.get(step.mission) as MissionDef;
    if (step.action === 'open' && !commitTicks.has(step.mission))
      commitTicks.set(step.mission, step.tick + def.worldTimeCost);
    const due = commitTicks.get(step.mission);
    if ((step.action === 'play' || step.action === 'quit') && due !== undefined && step.tick >= due)
      errors.push(
        contentError(
          runFile,
          ['missions', i, 'tick'],
          'mission_unresolved',
          `mission "${step.mission}" commits at tick ${due} (opened at ${due - def.worldTimeCost}, worldTimeCost ${def.worldTimeCost}): a "${step.action}" at tick ${step.tick} comes after its cost ran out`,
        ),
      );
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, defs };
}

/** A mission step the world refused: its tick, mission, action, refusal code and why. */
export interface RefusedMission {
  tick: number;
  mission: string;
  action: string;
  code: string;
  error: string;
}

/**
 * Applies one mission step between ticks (`openMission` with the scenario's keys as `refs`,
 * `delegateMission`, `playMission` or `quitMission`). Returns null when the world took it, else
 * the refusal (`{ code, error }`; nothing changed). `experienceTicks` never reach the world: the
 * played round is stood in for by its outcome, so its ticks are only counted in the run's result.
 */
export function applyMissionStep(
  world: World,
  step: MissionStep,
  defs: ReadonlyMap<string, MissionDef>,
  keys: Readonly<Record<string, Entity>>,
): { code: string; error: string } | null {
  const done = (() => {
    switch (step.action) {
      case 'open':
        return openMission(world, defs.get(step.mission), { refs: keys });
      case 'delegate':
        return delegateMission(world, step.mission);
      case 'play':
        return playMission(world, step.mission, step.outcome as string);
      case 'quit':
        return quitMission(world, step.mission);
    }
  })();
  return done.ok ? null : { code: done.code, error: done.error };
}

/** After a step: commit every mission due now and settle the opportunity windows. */
export function settleWorld(world: World): void {
  settleMissions(world);
}
