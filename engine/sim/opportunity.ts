import { z } from 'zod';
import type { JsonValue } from '../core/headless';
import type { MissionEffect, OpportunityDef } from '../core/missions';
import { opportunitySchema, parseOpportunity } from '../core/missions';
import { defineComponent } from './component';
import type { Cause } from './events';
import { worldTimeEntity } from './time';
import type { Entity, World } from './world';
import { worldInternals } from './world';

/**
 * Opportunities (Engine 0.10 T5; docs/BUILD-LOG.md, Engine 0.10, decision 6, item 155; see
 * "Opportunities" in this folder's CLAUDE.md): windows of world time in which a mission can be
 * taken, where taking one can close others.
 *
 *   addOpportunities(world, [
 *     { id: 'convoy', mission: 'ambush', opens: 10, closes: 40, exclusive: 'road' },
 *     { id: 'transfer', mission: 'free-them', opens: 20, closes: 60, exclusive: 'road' },
 *   ], 'scenario');
 *   world.step(); settleMissions(world);     // settles the windows, then commits what is due
 *   openMission(world, ambush);              // takes "convoy" and closes "transfer"
 *
 * The data (`OpportunityDef`, `opportunitySchema`) is the plain JSON contract in
 * `engine/core/missions.ts`; this file keeps each window's state as world data, `Opportunities` on
 * the `WorldTime` entity (`omitWhenEmpty`, so a world without opportunities snapshots, saves and
 * hashes as before). Every status change is one logged write with its cause: `time` when a window
 * opens or runs out, `mission:<id>` when taking a mission or a mission's effect does it. Integers
 * only, no randomness.
 */

const Tick = z.int().min(0);

/**
 * Where an opportunity stands:
 * - `dormant`: a `relative` one no effect has opened yet (it has no window);
 * - `waiting`: its window has not opened yet;
 * - `offered`: open and not taken, so its mission may be opened;
 * - `taken`: its mission was opened through it;
 * - `closed`: it ran out, or taking another (or an effect) closed it.
 */
export const OPPORTUNITY_STATUSES = ['dormant', 'waiting', 'offered', 'taken', 'closed'] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

/** The cause logged when a window opens or runs out as world time passes. */
export const TIME_CAUSE = 'time';

/**
 * One opportunity's state: its data, its window in world ticks (null while dormant), its status,
 * and the cause (`by`) and world tick (`at`) of its last status change (null until one). When time
 * changed it, `at` is the window's own tick (`opens` or `closes`).
 */
export const opportunityStateSchema = z.strictObject({
  def: opportunitySchema,
  status: z.enum(OPPORTUNITY_STATUSES),
  opens: Tick.nullable(),
  closes: Tick.nullable(),
  by: z.string().min(1).nullable(),
  at: Tick.nullable(),
});
export interface OpportunityState {
  readonly def: OpportunityDef;
  readonly status: OpportunityStatus;
  readonly opens: number | null;
  readonly closes: number | null;
  readonly by: string | null;
  readonly at: number | null;
}

export interface OpportunitiesData {
  /** Every opportunity the world knows, sorted by id. */
  readonly list: readonly OpportunityState[];
}

/** The world's opportunities, on the `WorldTime` entity. Left out of snapshots until one is added. */
export const Opportunities = defineComponent(
  'Opportunities',
  z.strictObject({ list: z.array(opportunityStateSchema) }) as unknown as z.ZodType<
    OpportunitiesData & JsonValue
  >,
  { omitWhenEmpty: true },
);

/** The opportunity components: `Opportunities`. */
export const OPPORTUNITY_COMPONENTS = Object.freeze([Opportunities]);

/** Why adding opportunities was refused (and nothing changed). */
export type OpportunityRefusal =
  'bad_opportunity' | 'opportunity_exists' | 'unknown_opportunity' | 'stepping';
export type OpportunityRefused = { ok: false; code: OpportunityRefusal; error: string };

const refuse = (code: OpportunityRefusal, error: string): OpportunityRefused => ({ ok: false, code, error });

/** One status change, as settling or taking made it. */
export interface OpportunityChange {
  readonly id: string;
  readonly status: OpportunityStatus;
  readonly by: string;
  readonly at: number;
}

const EMPTY: OpportunitiesData = { list: [] };

function holder(world: World): Entity | null {
  if (!world.registered(Opportunities)) return null;
  return world.query(Opportunities)[0] ?? null;
}

function stateOf(world: World): OpportunitiesData {
  const id = holder(world);
  return id === null ? EMPTY : (world.get(id, Opportunities) as OpportunitiesData);
}

/** Write the next state onto the `WorldTime` entity (spawned on first use), under the world's cause. */
function write(world: World, next: OpportunitiesData): void {
  if (!world.registered(Opportunities)) world.registerComponent(Opportunities);
  const id = holder(world) ?? worldTimeEntity(world, world.cause);
  world.add(id, Opportunities, next as OpportunitiesData & JsonValue);
}

/** Replace one opportunity's state (one logged write). */
function change(world: World, id: string, next: Partial<OpportunityState>): OpportunityChange {
  const s = stateOf(world);
  const list = s.list.map((e) => (e.def.id === id ? { ...e, ...next } : e));
  write(world, { list });
  const e = list.find((x) => x.def.id === id) as OpportunityState;
  return { id, status: e.status, by: e.by as string, at: e.at as number };
}

/** The status `e` has at world tick `tick` once time has had its say. */
function statusAt(e: OpportunityState, tick: number): OpportunityStatus {
  if (e.status !== 'waiting' && e.status !== 'offered') return e.status;
  if (e.closes !== null && tick >= e.closes) return 'closed';
  if (e.opens !== null && tick >= e.opens) return 'offered';
  return e.status;
}

function notStepping(world: World, what: string): void {
  if (worldInternals(world).stepping()) throw new Error(`${what} runs between ticks, not during a step`);
}

/** Read the world's opportunities. */
export interface OpportunitiesView {
  /** Every opportunity's state, by id. */
  all(): OpportunityState[];
  /** The state of `id`, or null when the world does not know it. */
  get(id: string): OpportunityState | null;
  /** The status of `id`, or null when the world does not know it. */
  status(id: string): OpportunityStatus | null;
  /** The opportunities offered now, by id. */
  offered(): OpportunityState[];
}

export function opportunitiesOf(world: World): OpportunitiesView {
  const find = (id: string) => stateOf(world).list.find((e) => e.def.id === id) ?? null;
  return {
    all: () => [...stateOf(world).list],
    get: find,
    status: (id) => find(id)?.status ?? null,
    offered: () => stateOf(world).list.filter((e) => e.status === 'offered'),
  };
}

/**
 * Problems with a list of opportunity data taken together with those the world knows: one line per
 * bad field (`0.closes: ...`), a repeated id, or a `closesOthers` id named nowhere.
 */
function listIssues(
  world: World,
  defs: readonly unknown[],
): { ok: true; defs: OpportunityDef[] } | OpportunityRefused {
  const parsed: OpportunityDef[] = [];
  const lines: string[] = [];
  defs.forEach((json, i) => {
    const one = parseOpportunity(json);
    if (one.ok) parsed.push(one.opportunity);
    else lines.push(...one.error.split('\n').map((l) => `${i}.${l}`));
  });
  if (lines.length > 0) return refuse('bad_opportunity', lines.join('; '));
  const known = new Set(stateOf(world).list.map((e) => e.def.id));
  for (const def of parsed) {
    if (known.has(def.id)) return refuse('opportunity_exists', `opportunity "${def.id}" is already known`);
    known.add(def.id);
  }
  for (const def of parsed)
    for (const other of def.closesOthers ?? [])
      if (!known.has(other))
        return refuse(
          'unknown_opportunity',
          `opportunity "${def.id}" closes "${other}", which is not an opportunity`,
        );
  return { ok: true, defs: parsed };
}

/**
 * Add opportunities (each checked with `opportunitySchema`) under `cause`, then settle them at the
 * current tick: a window already open is offered at once, one already over is closed. A `relative`
 * one stays `dormant` until an effect opens it. Refused (nothing changes) when one is bad, an id is
 * repeated or already known, or a `closesOthers` id names no opportunity.
 */
export function addOpportunities(
  world: World,
  defs: readonly unknown[],
  cause: Cause,
): { ok: true; added: string[] } | OpportunityRefused {
  if (worldInternals(world).stepping()) return refuse('stepping', 'cannot add opportunities during a step');
  const checked = listIssues(world, defs);
  if (!checked.ok) return checked;
  if (checked.defs.length === 0) return { ok: true, added: [] };
  world.withCause(cause, () => {
    const added: OpportunityState[] = checked.defs.map((def) => ({
      def,
      status: def.relative ? 'dormant' : 'waiting',
      opens: def.relative ? null : def.opens,
      closes: def.relative ? null : def.closes,
      by: null,
      at: null,
    }));
    const list = [...stateOf(world).list, ...added].sort((a, b) => (a.def.id < b.def.id ? -1 : 1));
    write(world, { list });
  });
  settleOpportunities(world);
  return { ok: true, added: checked.defs.map((d) => d.id) };
}

/**
 * The time-service hook: bring every window up to the current tick, in id order. A waiting one
 * whose `opens` has come is offered; a waiting or offered one whose `closes` has come is closed.
 * Each change is one write logged under the cause `time`, with `at` the window's own tick. Runs
 * between ticks; `settleMissions` and `commitMission` call it after every step, so windows open and
 * close during a mission's world-time cost too. Returns the changes made.
 */
export function settleOpportunities(world: World): OpportunityChange[] {
  notStepping(world, 'settleOpportunities');
  const changes: OpportunityChange[] = [];
  if (holder(world) === null) return changes;
  for (const e of stateOf(world).list) {
    const status = statusAt(e, world.tick);
    if (status === e.status) continue;
    const at = (status === 'closed' ? e.closes : e.opens) as number;
    changes.push(world.withCause(TIME_CAUSE, () => change(world, e.def.id, { status, by: TIME_CAUSE, at })));
  }
  return changes;
}

/**
 * Whether `mission` may be opened now: `{ ok, take }` with the opportunity it is taken through
 * (the lowest id offered now), or `take: null` when no opportunity names it (it is not gated).
 * Refused when opportunities name it and none is offered at the current tick. Reads only.
 */
export function opportunityGate(
  world: World,
  mission: string,
): { ok: true; take: string | null } | { ok: false; error: string } {
  const named = stateOf(world).list.filter((e) => e.def.mission === mission);
  if (named.length === 0) return { ok: true, take: null };
  const offered = named.find((e) => statusAt(e, world.tick) === 'offered');
  if (offered) return { ok: true, take: offered.def.id };
  const why = named.map((e) => `"${e.def.id}" is ${describe(e, world.tick)}`).join(', ');
  return {
    ok: false,
    error: `mission "${mission}" is taken through an opportunity, and none is open: ${why}`,
  };
}

function describe(e: OpportunityState, tick: number): string {
  const status = statusAt(e, tick);
  if (status === 'waiting') return `not open until tick ${e.opens}`;
  if (status === 'dormant') return 'not opened';
  if (status === 'closed' && e.by !== null && e.by !== TIME_CAUSE) return `closed by ${e.by}`;
  if (status === 'closed') return `closed at tick ${e.closes}`;
  return status;
}

/** The opportunities taking `id` closes: the same mission's others, its exclusive group, `closesOthers`. */
function closedByTaking(list: readonly OpportunityState[], taken: OpportunityDef): string[] {
  const ids = new Set(taken.closesOthers ?? []);
  for (const e of list) {
    if (e.def.id === taken.id) continue;
    if (e.def.mission === taken.mission) ids.add(e.def.id);
    if (taken.exclusive !== undefined && e.def.exclusive === taken.exclusive) ids.add(e.def.id);
  }
  return [...ids].sort();
}

const isLive = (s: OpportunityStatus): boolean => s === 'dormant' || s === 'waiting' || s === 'offered';

/**
 * Take opportunity `id` (offered now; check with {@link opportunityGate}) under `cause`: settle the
 * windows, mark it `taken`, then close every other opportunity of the same mission, of its
 * `exclusive` group and in its `closesOthers` that is not already taken or closed, one logged write
 * each. Returns the changes, the take first.
 */
export function takeOpportunity(world: World, id: string, cause: Cause): OpportunityChange[] {
  notStepping(world, 'takeOpportunity');
  const changes = settleOpportunities(world);
  const taken = stateOf(world).list.find((e) => e.def.id === id);
  if (!taken || taken.status !== 'offered') throw new Error(`opportunity "${id}" is not offered`);
  world.withCause(cause, () => {
    changes.push(change(world, id, { status: 'taken', by: cause, at: world.tick }));
    for (const other of closedByTaking(stateOf(world).list, taken.def)) {
      const e = stateOf(world).list.find((x) => x.def.id === other);
      if (e && isLive(e.status))
        changes.push(change(world, other, { status: 'closed', by: cause, at: world.tick }));
    }
  });
  return changes;
}

/** Whether every opportunity an effect names is known to the world (for opening a mission). */
export function knowsOpportunity(world: World, id: string): boolean {
  return stateOf(world).list.some((e) => e.def.id === id);
}

/**
 * Apply an `opportunity` effect at the current tick, under the world's current cause (a commit's
 * `mission:<id>`). `open`: a dormant `relative` one gets its window counted from now (offered at
 * once when its `opens` is 0); a waiting one is offered now, early. `close`: a dormant, waiting or
 * offered one closes. Returns false (the effect is skipped) when the opportunity is unknown, or
 * already taken or closed; opening one already offered changes nothing and returns true.
 */
export function applyOpportunityEffect(
  world: World,
  effect: Extract<MissionEffect, { type: 'opportunity' }>,
): boolean {
  const id = effect.open ?? (effect.close as string);
  const e = stateOf(world).list.find((x) => x.def.id === id);
  if (!e) return false;
  const status = statusAt(e, world.tick);
  const by = world.cause;
  const tick = world.tick;
  if (effect.close !== undefined) {
    if (!isLive(status)) return false;
    change(world, id, { status: 'closed', by, at: tick });
    return true;
  }
  if (status === 'offered') return true;
  if (status === 'waiting') {
    change(world, id, { status: 'offered', opens: tick, by, at: tick });
    return true;
  }
  if (status !== 'dormant') return false;
  const opens = tick + e.def.opens;
  const closes = tick + e.def.closes;
  change(
    world,
    id,
    opens === tick
      ? { status: 'offered', opens, closes, by, at: tick }
      : { status: 'waiting', opens, closes, by, at: tick },
  );
  return true;
}
