import { z } from 'zod';
import type { JsonObject, JsonValue } from '../core/headless';
import { Rng } from '../core/rng';
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
import { setFate } from './fate';
import {
  applyOpportunityEffect,
  knowsOpportunity,
  opportunitiesOf,
  opportunityGate,
  settleOpportunities,
  takeOpportunity,
} from './opportunity';
import { worldKeys } from './keys';
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
  | 'opportunity_closed'
  | 'unknown_opportunity'
  | 'reopens_self'
  | 'not_playable'
  | 'report_over_limit'
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

/**
 * The world's committed mission records, in commit order (Engine 0.15 T7, gap M28): what a page or
 * a game's glue reads instead of the `Missions` component itself. Frozen data; reads only.
 */
export function missionRecords(world: World): MissionRecord[] {
  return missionsOf(world).committed();
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
 * effect names a key not in `refs` (a `fate` effect's person included), a `set` effect names a
 * component the world lacks, an `opportunity` effect names an opportunity the world does not know
 * (`unknown_opportunity`) or opens one for this same mission (`reopens_self`: no do-overs), or
 * opportunities name the mission and none is offered now (`opportunity_closed`). When one is
 * offered, opening takes it (`takeOpportunity`), closing the opportunities it excludes.
 */
export function openMission(world: World, def: unknown, options: OpenOptions = {}): OpenResult {
  const stepping = notStepping(world, 'open a mission');
  if (stepping) return stepping;
  const parsed = parseMission(def);
  if (!parsed.ok) return refuse('bad_mission', parsed.error.split('\n').join('; '));
  // The card's `text` is presentation (Engine 0.16 F5): never stored, so it moves no hash.
  const { text: _text, ...mission } = parsed.mission;
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
      if (effect.type === 'opportunity') {
        const named = effect.open ?? (effect.close as string);
        if (!knowsOpportunity(world, named))
          return refuse(
            'unknown_opportunity',
            `outcome "${outcome.id}" names opportunity "${named}", which the world does not know`,
          );
        if (effect.open !== undefined && opportunitiesOf(world).get(named)?.def.mission === id)
          return refuse(
            'reopens_self',
            `outcome "${outcome.id}" opens "${named}", an opportunity for this mission itself; there are no do-overs`,
          );
        continue;
      }
      const named = [
        ...(effect.entity !== undefined ? [effect.entity] : []),
        ...('entities' in effect ? (effect.entities ?? []) : []),
      ];
      for (const name of named) {
        if (typeof name !== 'string') continue;
        const ref = options.refs?.[name];
        if (ref === undefined)
          return refuse('unknown_ref', `outcome "${outcome.id}" names "${name}", which is not in refs`);
        refs[name] = ref;
      }
      if (effect.type === 'set' && !world.registered(effect.component))
        return refuse(
          'unknown_component',
          `outcome "${outcome.id}" sets "${effect.component}", which the world lacks`,
        );
    }
  }

  const gate = opportunityGate(world, id);
  if (!gate.ok) return refuse('opportunity_closed', gate.error);

  const openTick = world.tick;
  const commitTick = openTick + mission.worldTimeCost;
  const cause = missionCause(id);
  world.withCause(cause, () => {
    if (gate.take !== null) takeOpportunity(world, gate.take, cause);
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
  if (world.tick > open.commitTick)
    return refuse(
      'mission_overdue',
      `mission "${id}" was due at tick ${open.commitTick}, the world is at ${world.tick}; it can only commit now`,
    );
  const picked = pick(open);
  if (isRefused(picked)) return picked;
  const checked = missionResult(open.def, picked.outcome, picked.report);
  if (!checked.ok) return refuse('unknown_outcome', checked.error);
  if (picked.report !== undefined) {
    const over = reportOverLimit(world, open, checked.result.effects, picked.report);
    if (over !== null) return refuse('report_over_limit', `mission "${id}": ${over}`);
  }
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
 * The delegation draw for `def` (item 154's fair, average result): one `int(totalWeight)` draw,
 * walked in file order, from the mission's own generator, `Rng.derived(world.seed, 'mission:<id>')`.
 * It never touches `world.rng`, so the outcome and the rest of the world do not depend on the tick
 * the mission was delegated at, or on whether it was played (item 151).
 */
function delegationDraw(world: World, def: MissionDef): string {
  const rng = Rng.derived(world.seed, missionCause(def.id));
  return pickOutcome(def, rng.int(totalWeight(def))).id;
}

/** Delegate open mission `id`: one declared outcome drawn by weight ({@link delegationDraw}). */
export function delegateMission(world: World, id: string): ResolveResult {
  return resolve(world, id, (m) => ({ outcome: delegationDraw(world, m.def), resolution: 'delegated' }));
}

/**
 * Play open mission `id`: choose the outcome, by id or as a kit's report. Only a declared (and,
 * with `playable`, playable) outcome is taken; anything else is refused (`unknown_outcome`) and the
 * mission stays open and unresolved. A mission with no `play` is refused (`not_playable`).
 */
export function playMission(world: World, id: string, played: string | MissionReport): ResolveResult {
  const report: MissionReport = typeof played === 'string' ? { outcome: played } : played;
  return resolve(
    world,
    id,
    (m) => notPlayable(m) ?? { outcome: report.outcome, resolution: 'played', report },
  );
}

/** Quit open mission `id` while playing it: it resolves to its `onQuit` outcome. */
export function quitMission(world: World, id: string): ResolveResult {
  return resolve(world, id, (m) => notPlayable(m) ?? { outcome: m.def.onQuit, resolution: 'quit' });
}

/** A mission with no `play` is a choice: only delegated (Engine 0.13, decision 2). */
function notPlayable(m: OpenMission): MissionRefused | null {
  return m.def.play === undefined
    ? refuse('not_playable', `mission "${m.def.id}" has no "play": it is a choice, only delegated`)
    : null;
}

export type CommitResult = { ok: true; record: MissionRecord } | MissionRefused;

/**
 * Commit open mission `id`: step the world to its commit tick, settling after every step and once
 * there ({@link settleMissions}), so `id` and every other mission due by then commit in the same
 * order a tick-by-tick run gives (commit tick, then id). An unresolved mission is delegated then
 * (`timeout`); under cause `mission:<id>` its outcome's effects apply, its event unfreezes, the
 * commitment is stamped and the record appended. `result`, when given, must be the outcome it was
 * resolved to (or, when it is unresolved, is played). Refused when it is not open or already
 * committed. An overdue mission (the world stepped past its commit tick unsettled) commits now with
 * no step; a `result` that would resolve it is refused then (`mission_overdue`).
 */
export function commitMission(world: World, id: string, result?: MissionResult): CommitResult {
  const stepping = notStepping(world, 'commit a mission');
  if (stepping) return stepping;
  const open = findOpen(world, id);
  if (isRefused(open)) return open;
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
    settleMissions(world);
  }
  settleMissions(world);
  return { ok: true, record: missionsOf(world).record(id) as MissionRecord };
}

/**
 * Commit every open mission whose commit tick has come (`commitTick <= world.tick`), in commit
 * tick then id order, delegating unresolved ones (`timeout`); one that is overdue (stepped past
 * unsettled) commits now, still recorded at its commit tick. Call it after each `world.step()`
 * when missions may be open and the caller does not commit them itself. Returns the records made.
 */
export function settleMissions(world: World): MissionRecord[] {
  if (worldInternals(world).stepping())
    throw new Error('settleMissions runs between ticks, not during a step');
  settleOpportunities(world);
  const due = stateOf(world)
    .open.filter((m) => m.commitTick <= world.tick)
    .sort((a, b) => a.commitTick - b.commitTick || (a.def.id < b.def.id ? -1 : 1));
  const records: MissionRecord[] = [];
  for (const open of due) {
    const current = findOpen(world, open.def.id) as OpenMission;
    records.push(commitNow(world, current).record);
  }
  return records;
}

function commitNow(world: World, open: OpenMission): { ok: true; record: MissionRecord } {
  const id = open.def.id;
  const cause = missionCause(id);
  settleOpportunities(world);
  return world.withCause(cause, () => {
    let resolved = open.resolved;
    let resolution: MissionResolution;
    if (resolved === null) {
      const outcome = delegationDraw(world, open.def);
      resolved = { outcome, resolution: 'delegated' };
      resolution = 'timeout';
    } else resolution = resolved.resolution;
    const outcome = open.def.outcomes.find((o) => o.id === resolved.outcome);
    if (!outcome) throw new Error(`mission "${id}" resolved to undeclared outcome "${resolved.outcome}"`);
    const report = resolved.report;
    const skipped = outcome.effects.filter((effect) => !applyEffect(world, open, effect, report));
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
 * Apply one effect; false when it is skipped: its entity is gone, `damage` finds no `Health` (or
 * its `fromReport` stat is 0), an `inventory` effect's `fromReport` stat is 0, an `each` effect
 * applies to no entity (Engine 0.15: one per named entity, skipped as a whole only when none took
 * it), or a
 * `set` would break the component's schema, or an `opportunity` effect finds its opportunity
 * already taken or closed (`applyOpportunityEffect`), or a `fate` cannot be set (`setFate` refuses
 * it: not a named person, a fate that cannot move there such as anything after a death, or a
 * `freed` cell that cannot be entered).
 */
function applyEffect(
  world: World,
  open: OpenMission,
  effect: MissionEffect,
  report: MissionReport | undefined,
): boolean {
  if (effect.type === 'opportunity') return applyOpportunityEffect(world, effect);
  if ((effect.type === 'damage' || effect.type === 'destroy') && effect.each !== undefined) {
    const ids = eachTargets(world, open, effect, report);
    let applied = false;
    for (const id of ids) if (applyOne(world, effect, id, report)) applied = true;
    return applied;
  }
  const id = entityOf(world, open, effect.entity as string | number);
  if (id === undefined) return false;
  return applyOne(world, effect, id, report);
}

/** Apply a non-opportunity effect to entity `id`; false when it is skipped. */
function applyOne(
  world: World,
  effect: Exclude<MissionEffect, { type: 'opportunity' }>,
  id: Entity,
  report: MissionReport | undefined,
): boolean {
  if (!world.alive(id)) return false;
  switch (effect.type) {
    case 'damage': {
      const health = world.get(id, Health);
      if (!health) return false;
      const amount = effect.each !== undefined ? effect.amount : damageAmount(effect, report);
      if (amount === 0) return false;
      world.add(id, Health, { ...health, hp: Math.max(0, health.hp - amount) });
      return true;
    }
    case 'destroy':
      world.destroy(id);
      return true;
    case 'inventory': {
      const delta = inventoryDelta(effect, report);
      if (delta === 0) return false;
      const items: Record<string, number> = {
        ...((world.get(id, 'Inventory') as Record<string, number> | undefined) ?? {}),
      };
      const count = Math.max(0, (items[effect.item] ?? 0) + delta);
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
    case 'fate':
      return setFate(world, id, effect.fate, {
        cause: world.cause,
        ...(effect.by !== undefined ? { by: effect.by } : {}),
        ...(effect.at !== undefined ? { cell: effect.at } : {}),
      }).ok;
  }
}

/**
 * The entity a name stands for (Engine 0.15 T8): an id, a key of the open mission's `refs`, a key
 * of the world's key table, or an id written as digits (a kit's report names an entity no key
 * names by its id). Undefined when it names none.
 */
function entityOf(world: World, open: OpenMission, name: string | number): Entity | undefined {
  if (typeof name === 'number') return name;
  const ref = open.refs[name] ?? worldKeys(world)[name];
  if (ref !== undefined) return ref;
  return /^[1-9][0-9]*$/.test(name) ? Number(name) : undefined;
}

/** A report stat as a whole number at least 0, or null (absent or not one). */
function wholeStat(report: MissionReport | undefined, stat: string): number | null {
  const v = report?.stats?.[stat];
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

/** A report stat as a list of entity names, or null (absent or not a list of names). */
function listStat(report: MissionReport | undefined, stat: string): (string | number)[] | null {
  const v = report?.stats?.[stat];
  if (!Array.isArray(v) || !v.every((n) => typeof n === 'string' || typeof n === 'number')) return null;
  return v as (string | number)[];
}

type EachEffect = Extract<MissionEffect, { type: 'damage' | 'destroy' }>;

/**
 * The entities an `each` effect applies to (lesson D4): those its report stat names when the
 * mission was played and the report has the list, else its declared `entities` (none: nothing),
 * in the order given, each once, names that stand for no entity left out.
 */
function eachTargets(world: World, open: OpenMission, effect: EachEffect, report: MissionReport | undefined) {
  const names = listStat(report, effect.each as string) ?? effect.entities ?? [];
  const ids: Entity[] = [];
  for (const name of names) {
    const id = entityOf(world, open, name);
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Why a played round's report goes over a declared limit of the outcome's effects (lessons D3 and
 * D4), or null: a `fromReport` stat above its `max`, an `each` list longer than its `max`, or (with
 * `owner`) naming an entity that is not alive or not owned by that faction. Limits are checked,
 * never clamped: the round is refused and the mission is delegated at its commit. A stat that is
 * absent or not of its shape is no limit's business (the declared amount applies, as before).
 */
function reportOverLimit(
  world: World,
  open: OpenMission,
  effects: readonly MissionEffect[],
  report: MissionReport,
): string | null {
  for (const [i, effect] of effects.entries()) {
    const at = `effect ${i} (${effect.type})`;
    if ((effect.type === 'damage' || effect.type === 'destroy') && effect.each !== undefined) {
      const names = listStat(report, effect.each);
      if (names === null) continue;
      if (effect.max !== undefined && names.length > effect.max)
        return `${at}: the report's "${effect.each}" names ${names.length} entities, more than its max ${effect.max}`;
      if (effect.owner === undefined) continue;
      for (const name of names) {
        const id = entityOf(world, open, name);
        const owner = id !== undefined && world.alive(id) ? world.get(id, 'Owner') : undefined;
        const faction = (owner as { faction?: unknown } | undefined)?.faction;
        if (faction !== effect.owner)
          return `${at}: the report's "${effect.each}" names "${name}", which is not a living entity of "${effect.owner}"`;
      }
      continue;
    }
    if ((effect.type === 'damage' || effect.type === 'inventory') && effect.fromReport !== undefined) {
      const stat = wholeStat(report, effect.fromReport);
      if (stat !== null && effect.max !== undefined && stat > effect.max)
        return `${at}: the report's "${effect.fromReport}" is ${stat}, more than its max ${effect.max}`;
    }
  }
  return null;
}

/**
 * A `damage` effect's amount: with `fromReport`, the played round's report stat of that name when
 * it is a whole number of at least 0 (Engine 0.13, decision 4, item 223); otherwise (delegated,
 * quit, timed out, or a report without that stat) the declared `amount`.
 */
function damageAmount(effect: Extract<MissionEffect, { type: 'damage' }>, report: MissionReport | undefined) {
  if (effect.fromReport === undefined) return effect.amount;
  return wholeStat(report, effect.fromReport) ?? effect.amount;
}

/**
 * An `inventory` effect's change (Engine 0.15 T8, lesson D3): with `fromReport`, the played
 * round's report stat when it is a whole number of at least 0 (taken away with `negate`; 0 skips
 * the effect); otherwise (delegated, quit, timed out, or a report without the stat) `add`.
 */
function inventoryDelta(
  effect: Extract<MissionEffect, { type: 'inventory' }>,
  report: MissionReport | undefined,
) {
  if (effect.fromReport === undefined) return effect.add;
  const stat = wholeStat(report, effect.fromReport);
  if (stat === null) return effect.add;
  return effect.negate === true ? -stat : stat;
}
