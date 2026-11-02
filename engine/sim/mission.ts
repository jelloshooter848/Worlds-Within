import { z } from 'zod';
import type { JsonObject, JsonValue } from '../core/headless';
import type {
  MissionDef,
  MissionEffect,
  MissionRecord,
  MissionReport,
  MissionResolution,
  MissionResult,
} from '../core/missions';
import {
  missionEffectSchema,
  missionResult,
  missionSchema,
  parseMission,
  pickOutcome,
  totalWeight,
} from '../core/missions';
import { defineComponent } from './component';
import { Health } from './components';
import { freezeEvent, startExperience, stampCommitment, timeOf, unfreezeEvent, WorldTime } from './time';
import type { Entity, World } from './world';
import { worldInternals } from './world';

/**
 * The mission lifecycle (Engine 0.10 T4; docs/BUILD-LOG.md, Engine 0.10, items 150-154; see
 * "Missions" in this folder's CLAUDE.md): open a mission, resolve it by delegating or playing, and
 * commit its result to the world, once.
 *
 *   const opened = openMission(world, def);                 // freezes def.event, returns a snapshot
 *   delegateMission(world, 'raid');                         // or playMission(world, 'raid', 'partial')
 *   const done = commitMission(world, 'raid');              // steps to the commit tick, applies effects
 *   done.ok && done.record.outcome;                         // 'partial'
 *
 * Opening at tick T fixes the commit tick at T + `worldTimeCost`. `commitMission` steps the world
 * to that tick (fewer steps when the world has already moved on, never more) and commits there,
 * so the world moves exactly the cost, however many experience ticks were spent inside. All the
 * state is world data: `Missions` on the same world-level entity as `WorldTime`, `omitWhenEmpty`,
 * so a world that never opens a mission snapshots, saves and hashes exactly as before.
 */

const Tick = z.int().min(0);
const EntityId = z.int().min(1);

const reportSchema = z.strictObject({
  outcome: z.string(),
  stats: z.record(z.string(), z.json()).exactOptional(),
});

/** How an open mission was resolved before its commit: the outcome and the path that chose it. */
const resolvedSchema = z.strictObject({
  outcome: z.string(),
  resolution: z.enum(['played', 'quit', 'delegated']),
  report: reportSchema.exactOptional(),
});

/** An open mission: its definition as it was when opened, its ticks and its scenario key refs. */
export const openMissionSchema = z.strictObject({
  def: missionSchema,
  openTick: Tick,
  commitTick: Tick,
  refs: z.record(z.string(), EntityId),
  resolved: resolvedSchema.nullable(),
});
export type OpenMission = z.infer<typeof openMissionSchema>;

/** A committed record (`MissionRecord` from `engine/core/missions.ts`), append-only. */
export const missionRecordSchema = z.strictObject({
  mission: z.string(),
  outcome: z.string(),
  effects: z.array(missionEffectSchema),
  report: reportSchema.exactOptional(),
  resolution: z.enum(['played', 'quit', 'delegated', 'timeout']),
  openTick: Tick,
  commitTick: Tick,
  experienceTicks: Tick,
  skipped: z.array(missionEffectSchema),
});

/** The world's missions: open ones (by id) and committed records (in commit order). */
export const Missions = defineComponent(
  'Missions',
  z.strictObject({
    open: z.array(openMissionSchema),
    committed: z.array(missionRecordSchema),
  }) as unknown as z.ZodType<MissionsData & JsonValue>,
  { omitWhenEmpty: true },
);
export interface MissionsData {
  readonly open: readonly OpenMission[];
  readonly committed: readonly MissionRecord[];
}

/** The mission components: `Missions`. Left out of snapshots until a mission opens. */
export const MISSION_COMPONENTS = Object.freeze([Missions]);

/** Why a mission step was refused (and nothing changed). */
export type MissionRefusal =
  | 'bad_mission'
  | 'bad_id'
  | 'unknown_ref'
  | 'unknown_component'
  | 'mission_open'
  | 'mission_not_open'
  | 'mission_committed'
  | 'mission_resolved'
  | 'mission_overdue'
  | 'event_frozen'
  | 'unknown_outcome'
  | 'result_mismatch'
  | 'stepping';

export type MissionRefused = { ok: false; code: MissionRefusal; error: string };

const refuse = (code: MissionRefusal, error: string): MissionRefused => ({ ok: false, code, error });

/** The cause every lifecycle change is logged with. */
export const missionCause = (id: string): string => `mission:${id}`;

const EMPTY: MissionsData = { open: [], committed: [] };

function holder(world: World): Entity | null {
  if (!world.registered(Missions)) return null;
  return world.query(Missions)[0] ?? null;
}

function stateOf(world: World): MissionsData {
  const id = holder(world);
  return id === null ? EMPTY : (world.get(id, Missions) as MissionsData);
}

/** Write the next missions state onto the `WorldTime` entity (call after a time write made it). */
function write(world: World, next: MissionsData): void {
  if (!world.registered(Missions)) world.registerComponent(Missions);
  const id = holder(world) ?? world.query(WorldTime)[0];
  if (id === undefined) throw new Error('the missions state needs the WorldTime entity');
  world.add(id, Missions, next as MissionsData & JsonValue);
}

/** The refusal for `id` when it is not open (committed, or never opened), else the open mission. */
function findOpen(world: World, id: string): OpenMission | MissionRefused {
  const s = stateOf(world);
  const open = s.open.find((m) => m.def.id === id);
  if (open) return open;
  return s.committed.some((r) => r.mission === id)
    ? refuse('mission_committed', `mission "${id}" is already committed; there are no do-overs`)
    : refuse('mission_not_open', `mission "${id}" is not open`);
}

function notStepping(world: World, what: string): MissionRefused | null {
  return worldInternals(world).stepping() ? refuse('stepping', `cannot ${what} during a step`) : null;
}

const isRefused = (v: unknown): v is MissionRefused =>
  typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === false;

/** Read the world's missions. */
export interface MissionsView {
  /** The open missions, by id. */
  open(): OpenMission[];
  /** Every committed record, in commit order. */
  committed(): MissionRecord[];
  /** The committed record of `id`, or null. */
  record(id: string): MissionRecord | null;
  /** `open`, `committed`, or null when the mission was never opened. */
  status(id: string): 'open' | 'committed' | null;
}

export function missionsOf(world: World): MissionsView {
  return {
    open: () => [...stateOf(world).open],
    committed: () => [...stateOf(world).committed],
    record: (id) => stateOf(world).committed.find((r) => r.mission === id) ?? null,
    status: (id) => {
      const s = stateOf(world);
      if (s.open.some((m) => m.def.id === id)) return 'open';
      return s.committed.some((r) => r.mission === id) ? 'committed' : null;
    },
  };
}

/** What a mission plays from: the plain world snapshot (a kit's adapter reads it). */
export function missionSnapshot(world: World): JsonObject {
  return world.snapshot() as unknown as JsonObject;
}

export interface OpenOptions {
  /** Scenario keys an effect may name, mapped to entity ids (kept on the open mission). */
  readonly refs?: Readonly<Record<string, Entity>>;
}

export type OpenResult =
  | { ok: true; mission: MissionDef; openTick: number; commitTick: number; snapshot: JsonObject }
  | MissionRefused;

/**
 * Open mission `def` (checked with `missionSchema`) at the current tick: record it with its
 * outcomes and fixed cost, start its experience clock and freeze its event. Refused (nothing
 * changes) when the def is bad, the mission is open or committed, its event is already frozen, an
 * effect names a key not in `refs`, or a `set` effect names a component the world lacks.
 */
export function openMission(world: World, def: unknown, options: OpenOptions = {}): OpenResult {
  const stepping = notStepping(world, 'open a mission');
  if (stepping) return stepping;
  const parsed = parseMission(def);
  if (!parsed.ok) return refuse('bad_mission', parsed.error.split('\n').join('; '));
  const mission = parsed.mission;
  const id = mission.id;
  const s = stateOf(world);
  if (s.committed.some((r) => r.mission === id))
    return refuse('mission_committed', `mission "${id}" is already committed; there are no do-overs`);
  if (s.open.some((m) => m.def.id === id)) return refuse('mission_open', `mission "${id}" is already open`);
  if (!/^[a-z][a-z0-9-]*$/.test(id))
    return refuse('bad_id', `mission id "${id}" must start with a letter to open`);
  if (
    mission.event !== undefined &&
    timeOf(world)
      .frozen()
      .some((f) => f.event === mission.event)
  )
    return refuse('event_frozen', `event "${mission.event}" is already frozen by another mission`);

  const refs: Record<string, Entity> = {};
  for (const outcome of mission.outcomes) {
    for (const effect of outcome.effects) {
      if (effect.type === 'opportunity') continue;
      if (typeof effect.entity === 'string') {
        const ref = options.refs?.[effect.entity];
        if (ref === undefined)
          return refuse(
            'unknown_ref',
            `outcome "${outcome.id}" names "${effect.entity}", which is not in refs`,
          );
        refs[effect.entity] = ref;
      }
      if (effect.type === 'set' && !world.registered(effect.component))
        return refuse(
          'unknown_component',
          `outcome "${outcome.id}" sets "${effect.component}", which the world lacks`,
        );
    }
  }

  const openTick = world.tick;
  const commitTick = openTick + mission.worldTimeCost;
  const cause = missionCause(id);
  world.withCause(cause, () => {
    startExperience(world, id, cause);
    if (mission.event !== undefined) freezeEvent(world, mission.event, cause);
    const entry: OpenMission = { def: mission, openTick, commitTick, refs, resolved: null };
    const open = [...s.open, entry].sort((a, b) => (a.def.id < b.def.id ? -1 : 1));
    write(world, { ...s, open });
  });
  return { ok: true, mission, openTick, commitTick, snapshot: missionSnapshot(world) };
}

export type ResolveResult = { ok: true; result: MissionResult } | MissionRefused;

/** Record how open mission `id` was resolved; refused when it already was (no do-overs). */
function resolve(
  world: World,
  id: string,
  pick: (
    m: OpenMission,
  ) =>
    { outcome: string; resolution: 'played' | 'quit' | 'delegated'; report?: MissionReport } | MissionRefused,
): ResolveResult {
  const stepping = notStepping(world, 'resolve a mission');
  if (stepping) return stepping;
  const open = findOpen(world, id);
  if (isRefused(open)) return open;
  if (open.resolved)
    return refuse(
      'mission_resolved',
      `mission "${id}" was already ${open.resolved.resolution} ("${open.resolved.outcome}"); there are no do-overs`,
    );
  const picked = pick(open);
  if (isRefused(picked)) return picked;
  const checked = missionResult(open.def, picked.outcome, picked.report);
  if (!checked.ok) return refuse('unknown_outcome', checked.error);
  const resolved = {
    outcome: picked.outcome,
    resolution: picked.resolution,
    ...(picked.report ? { report: picked.report } : {}),
  };
  const s = stateOf(world);
  world.withCause(missionCause(id), () =>
    write(world, { ...s, open: s.open.map((m) => (m === open ? { ...m, resolved } : m)) }),
  );
  return { ok: true, result: checked.result };
}

/**
 * Delegate open mission `id`: draw one declared outcome with `world.rng` (one `int(totalWeight)`
 * draw, walked in file order: item 154's fair, average result).
 */
export function delegateMission(world: World, id: string): ResolveResult {
  return resolve(world, id, (m) => ({
    outcome: pickOutcome(m.def, world.rng.int(totalWeight(m.def))).id,
    resolution: 'delegated',
  }));
}

/**
 * Play open mission `id`: choose the outcome, by id or as a kit's report. Only a declared (and,
 * with `playable`, playable) outcome is taken; anything else is refused (`unknown_outcome`) and the
 * mission stays open and unresolved.
 */
export function playMission(world: World, id: string, played: string | MissionReport): ResolveResult {
  const report: MissionReport = typeof played === 'string' ? { outcome: played } : played;
  return resolve(world, id, () => ({ outcome: report.outcome, resolution: 'played', report }));
}

/** Quit open mission `id` while playing it: it resolves to its `onQuit` outcome. */
export function quitMission(world: World, id: string): ResolveResult {
  return resolve(world, id, (m) => ({ outcome: m.def.onQuit, resolution: 'quit' }));
}

export type CommitResult = { ok: true; record: MissionRecord } | MissionRefused;

/**
 * Commit open mission `id`: step the world to its commit tick (committing any other mission that
 * comes due on the way), delegate it then if still unresolved (`timeout`), and at the commit tick,
 * under cause `mission:<id>`, apply its outcome's effects, unfreeze its event, stamp the commitment
 * and append the record. `result`, when given, must be the outcome it was resolved to (or, when it
 * is unresolved, is played). Refused when it is not open, already committed, or overdue (the world
 * stepped past its commit tick without `settleMissions`).
 */
export function commitMission(world: World, id: string, result?: MissionResult): CommitResult {
  const stepping = notStepping(world, 'commit a mission');
  if (stepping) return stepping;
  let open = findOpen(world, id);
  if (isRefused(open)) return open;
  if (world.tick > open.commitTick)
    return refuse(
      'mission_overdue',
      `mission "${id}" was due at tick ${open.commitTick}, the world is at ${world.tick}`,
    );
  if (result !== undefined) {
    if (result.mission !== id)
      return refuse('result_mismatch', `the result is for mission "${result.mission}", not "${id}"`);
    if (open.resolved === null) {
      const played = playMission(world, id, result.report ?? { outcome: result.outcome });
      if (!played.ok) return played;
    } else if (open.resolved.outcome !== result.outcome) {
      return refuse(
        'result_mismatch',
        `mission "${id}" was resolved to "${open.resolved.outcome}", not "${result.outcome}"`,
      );
    }
  }
  while (world.tick < open.commitTick) {
    world.step();
    settleMissions(world, id);
  }
  open = findOpen(world, id) as OpenMission;
  return commitNow(world, open);
}

/**
 * Commit every open mission whose commit tick is now (in id order), delegating unresolved ones
 * (`timeout`). Call it after each `world.step()` when missions may be open and the caller does not
 * commit them itself. Returns the records made.
 */
export function settleMissions(world: World, except?: string): MissionRecord[] {
  if (worldInternals(world).stepping())
    throw new Error('settleMissions runs between ticks, not during a step');
  const records: MissionRecord[] = [];
  for (const open of stateOf(world).open) {
    if (open.def.id === except || open.commitTick !== world.tick) continue;
    const current = findOpen(world, open.def.id) as OpenMission;
    records.push(commitNow(world, current).record);
  }
  return records;
}

function commitNow(world: World, open: OpenMission): { ok: true; record: MissionRecord } {
  const id = open.def.id;
  const cause = missionCause(id);
  return world.withCause(cause, () => {
    let resolved = open.resolved;
    let resolution: MissionResolution;
    if (resolved === null) {
      const outcome = pickOutcome(open.def, world.rng.int(totalWeight(open.def))).id;
      resolved = { outcome, resolution: 'delegated' };
      resolution = 'timeout';
    } else resolution = resolved.resolution;
    const outcome = open.def.outcomes.find((o) => o.id === resolved.outcome);
    if (!outcome) throw new Error(`mission "${id}" resolved to undeclared outcome "${resolved.outcome}"`);
    const skipped = outcome.effects.filter((effect) => !applyEffect(world, open, effect));
    if (open.def.event !== undefined) unfreezeEvent(world, open.def.event, cause);
    const experienceTicks = timeOf(world).experience(id) ?? 0;
    stampCommitment(world, id, cause, open.commitTick);
    const record: MissionRecord = {
      mission: id,
      outcome: outcome.id,
      effects: outcome.effects,
      ...(resolved.report ? { report: resolved.report } : {}),
      resolution,
      openTick: open.openTick,
      commitTick: open.commitTick,
      experienceTicks,
      skipped,
    };
    const s = stateOf(world);
    write(world, { open: s.open.filter((m) => m.def.id !== id), committed: [...s.committed, record] });
    return { ok: true as const, record: stateOf(world).committed[s.committed.length] as MissionRecord };
  });
}

/**
 * Apply one effect; false when it is skipped: its entity is gone, `damage` finds no `Health`, or a
 * `set` would break the component's schema. `opportunity` effects are carried on the record and
 * acted on by the opportunities (T5); here they change nothing.
 */
function applyEffect(world: World, open: OpenMission, effect: MissionEffect): boolean {
  if (effect.type === 'opportunity') return true;
  const id = typeof effect.entity === 'number' ? effect.entity : open.refs[effect.entity];
  if (id === undefined || !world.alive(id)) return false;
  switch (effect.type) {
    case 'damage': {
      const health = world.get(id, Health);
      if (!health) return false;
      world.add(id, Health, { ...health, hp: Math.max(0, health.hp - effect.amount) });
      return true;
    }
    case 'destroy':
      world.destroy(id);
      return true;
    case 'inventory': {
      const items: Record<string, number> = {
        ...((world.get(id, 'Inventory') as Record<string, number> | undefined) ?? {}),
      };
      const count = Math.max(0, (items[effect.item] ?? 0) + effect.add);
      if (count === 0) delete items[effect.item];
      else items[effect.item] = count;
      const def = worldInternals(world).component('Inventory');
      if (!def || !def.schema.safeParse(items).success) return false;
      world.add(id, 'Inventory', items);
      return true;
    }
    case 'set': {
      const def = worldInternals(world).component(effect.component);
      const current = world.get(id, effect.component);
      const base = current !== null && typeof current === 'object' && !Array.isArray(current) ? current : {};
      const merged = { ...base, ...effect.values };
      if (!def || !def.schema.safeParse(merged).success) return false;
      world.add(id, effect.component, merged);
      return true;
    }
  }
}
