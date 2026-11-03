import { z } from 'zod';
import type { JsonObject, JsonValue } from '../core/headless';
import type { Change } from './events';
import { OPPORTUNITY_STATUSES, type OpportunityState, type OpportunityStatus } from './opportunity';
import type { WorldSave } from './save';
import type { WorldTimeData } from './time';
import { worldInternals, type World } from './world';

/**
 * The timeline record (Engine 0.14 T7; docs/BUILD-LOG.md, Engine 0.14, decision 4, item 250): a
 * world's time as plain data, read by a pure function over the world's plain data only (its
 * snapshot or save and its event log), so it runs the same in Node and in a page and never steps
 * or changes a world. See "Timeline" in this folder's CLAUDE.md.
 *
 *   const record = worldTimeline(world);                       // or timelineOf({ snapshot, events })
 *   record.missions[0];                                        // { mission, status, openTick, commitTick, outcome, ... }
 *   timelineEntries(record);                                   // the same, one entry per happening, by tick
 *
 * World data gives the state now (`WorldTime`, `Opportunities`, `Missions`); the event log gives
 * the past: frozen spans that have ended (read from each `WorldTime` change's `before`) and each
 * opportunity's status history (from its `Opportunities` changes, with their causes). A world
 * whose log keeps fewer ticks gives shorter history and says so with `logFrom`. The `clock` (world
 * tick per game tick) is the one part a world cannot know: the tools fill it while they play a
 * game run (`compressClock`). Integers only, no randomness.
 */

export const TIMELINE_FORMAT = 'worlds-within/timeline';
export const TIMELINE_VERSION = 1;

const Tick = z.int().min(0);

/** One point of the clock: at game tick `game` the world was at tick `world`. */
export const clockEntrySchema = z.strictObject({
  game: Tick.describe('the game tick'),
  world: Tick.describe('the world tick at that game tick'),
});
export type ClockEntry = z.infer<typeof clockEntrySchema>;

/** A frozen span: `event` frozen by `by` from world tick `from` to `to` (null while still frozen). */
export const frozenSpanSchema = z.strictObject({
  event: z.string().describe('the event id'),
  by: z.string().describe('the cause that froze it (`mission:<id>`)'),
  from: Tick.describe('the world tick it froze at'),
  to: Tick.nullable().describe('the world tick it was unfrozen at; null while still frozen'),
});
export type FrozenSpan = z.infer<typeof frozenSpanSchema>;

/** Experience time spent inside one mission (the world standing still). */
export const experienceEntrySchema = z.strictObject({
  mission: z.string().describe('the mission id'),
  from: Tick.nullable().describe('the world tick the mission opened at (null when not known)'),
  ticks: Tick.describe("experience ticks spent inside (a played round's own ticks)"),
});
export type ExperienceEntry = z.infer<typeof experienceEntrySchema>;

/** One status change of an opportunity, with its cause and world tick. */
export const opportunityStepSchema = z.strictObject({
  status: z.enum(OPPORTUNITY_STATUSES).describe('the status it moved to'),
  by: z.string().describe('the cause: `time`, `mission:<id>`, `scenario`, ...'),
  at: Tick.describe("the world tick of the change (a window's own tick when time changed it)"),
});
export type OpportunityStep = z.infer<typeof opportunityStepSchema>;

/** An opportunity's window, its status now and the changes the log still holds. */
export const opportunityWindowSchema = z.strictObject({
  id: z.string().describe('the opportunity id'),
  mission: z.string().describe('the mission it offers'),
  opens: Tick.nullable().describe('the world tick it opens at (null while dormant)'),
  closes: Tick.nullable().describe('the world tick it closes at (null while dormant)'),
  status: z.enum(OPPORTUNITY_STATUSES).describe('its status now'),
  history: z.array(opportunityStepSchema).describe('its status changes, oldest first'),
});
export type OpportunityWindow = z.infer<typeof opportunityWindowSchema>;

/** A mission the world opened: still open, or committed with its record's outcome. */
export const timelineMissionSchema = z.strictObject({
  mission: z.string().describe('the mission id'),
  status: z.enum(['open', 'committed']).describe('open now, or committed'),
  openTick: Tick.describe('the world tick it opened at'),
  commitTick: Tick.describe('the world tick its result commits (or committed) at, fixed at open'),
  resolution: z
    .enum(['played', 'quit', 'delegated', 'timeout'])
    .nullable()
    .describe('how it was resolved (null while open and unresolved)'),
  outcome: z.string().nullable().describe('the outcome (null while open and unresolved)'),
  experienceTicks: Tick.describe('experience ticks recorded in the world (a game run counts its own)'),
});
export type TimelineMission = z.infer<typeof timelineMissionSchema>;

/** The timeline record (`worlds-within/timeline` version 1). */
export const timelineSchema = z.strictObject({
  format: z.literal(TIMELINE_FORMAT).describe('always `worlds-within/timeline`'),
  version: z.literal(TIMELINE_VERSION).describe('the timeline format version'),
  worldTick: Tick.describe('the world tick now'),
  logFrom: Tick.nullable().describe('the oldest world tick the event log still keeps (null: no log)'),
  clock: z
    .array(clockEntrySchema)
    .nullable()
    .describe('world tick per game tick, run-length (filled by the tools for a game run; null otherwise)'),
  frozen: z.array(frozenSpanSchema).describe('frozen spans, by start tick then event'),
  experience: z.array(experienceEntrySchema).describe('experience time per mission, by mission id'),
  opportunities: z.array(opportunityWindowSchema).describe('every opportunity, by id'),
  missions: z
    .array(timelineMissionSchema)
    .describe('committed missions in commit order, then open ones by open tick'),
});
export type Timeline = z.infer<typeof timelineSchema>;

/** What `timelineOf` reads: a world's plain data and its event log. */
export interface TimelineSource {
  /** `World.snapshot()` (components per kind) or a world save (`saveWorld`: components per entity). */
  readonly world: JsonObject | WorldSave;
  /** The kept event log, oldest first (a save's own `log.events` is used when left out). */
  readonly events?: readonly Change[] | readonly JsonObject[];
  /** The oldest world tick the log keeps (worked out from the save's or log's when left out). */
  readonly logFrom?: number | null;
  /** World tick per game tick (`compressClock`), for a game run. */
  readonly clock?: readonly ClockEntry[] | null;
  /**
   * Experience ticks per mission counted outside the world (a game's played rounds,
   * `HeadlessGame.missionExperience`): they replace the world's own count for those missions.
   */
  readonly experience?: readonly { mission: string; ticks: number }[];
}

interface OpenRecord {
  def: { id: string };
  openTick: number;
  commitTick: number;
  resolved: { outcome: string; resolution: 'played' | 'quit' | 'delegated' } | null;
}
interface CommittedRecord {
  mission: string;
  outcome: string;
  resolution: 'played' | 'quit' | 'delegated' | 'timeout';
  openTick: number;
  commitTick: number;
  experienceTicks: number;
}
interface MissionsState {
  open: readonly OpenRecord[];
  committed: readonly CommittedRecord[];
}

const isSave = (w: JsonObject | WorldSave): w is WorldSave =>
  Array.isArray((w as { entities?: unknown }).entities) &&
  typeof (w as { format?: unknown }).format === 'string';

/** The data of component `name` on its first holder, or undefined. */
function componentOf(world: JsonObject | WorldSave, name: string): JsonValue | undefined {
  if (isSave(world)) {
    for (const e of world.entities) if (name in e.components) return e.components[name] as JsonValue;
    return undefined;
  }
  const kinds = (world as { components?: Record<string, [number, JsonValue][]> }).components ?? {};
  return kinds[name]?.[0]?.[1];
}

const frozenOf = (v: unknown): WorldTimeData['frozen'] => (v as WorldTimeData | undefined)?.frozen ?? [];
const listOf = (v: unknown): readonly OpportunityState[] =>
  (v as { list?: readonly OpportunityState[] } | undefined)?.list ?? [];

/**
 * The timeline record of a world's plain data (`TimelineSource`). Pure: it reads only what it is
 * given. Frozen spans that ended come from the log's `WorldTime` changes (the `before` of the change
 * that unfroze them), spans still frozen from `WorldTime` now; opportunity history from the log's
 * `Opportunities` changes (one step per status change, with the change's cause and the state's
 * `at`), completed with the state now when the log no longer holds its last change.
 */
export function timelineOf(source: TimelineSource): Timeline {
  const world = source.world;
  const save = isSave(world) ? world : null;
  const events = (source.events ?? save?.log.events ?? []) as readonly Change[];
  const worldTick = (world as { tick: number }).tick;
  const logFrom =
    source.logFrom !== undefined
      ? source.logFrom
      : save !== null
        ? !save.log.enabled
          ? null
          : save.log.ticks === null
            ? 0
            : Math.max(0, worldTick - save.log.ticks)
        : (events[0]?.tick ?? null);

  const time = componentOf(world, 'WorldTime') as WorldTimeData | undefined;
  const missionsNow = componentOf(world, 'Missions') as MissionsState | undefined;
  const opportunitiesNow = listOf(componentOf(world, 'Opportunities'));

  // Frozen spans: each event leaving `frozen` in a WorldTime change ended a span (its `before`
  // entry says who froze it and since when); the ones frozen now are still open.
  const frozen: FrozenSpan[] = [];
  // Opportunity history: one step per status change.
  const history = new Map<string, OpportunityStep[]>();
  for (const change of events) {
    if (change.component === 'WorldTime' && (change.op === 'set' || change.op === 'remove')) {
      const after = new Set(frozenOf(change.value).map((f) => f.event));
      for (const f of frozenOf(change.before))
        if (!after.has(f.event)) frozen.push({ event: f.event, by: f.by, from: f.since, to: change.tick });
    }
    if (change.component === 'Opportunities' && (change.op === 'add' || change.op === 'set')) {
      const before = new Map(listOf(change.before).map((e) => [e.def.id, e.status]));
      for (const e of listOf(change.value)) {
        if (before.get(e.def.id) === e.status) continue;
        const steps = history.get(e.def.id) ?? [];
        steps.push({ status: e.status, by: e.by ?? change.cause, at: e.at ?? change.tick });
        history.set(e.def.id, steps);
      }
    }
  }
  for (const f of time?.frozen ?? []) frozen.push({ event: f.event, by: f.by, from: f.since, to: null });
  frozen.sort((a, b) => a.from - b.from || (a.event < b.event ? -1 : a.event > b.event ? 1 : 0));

  const opportunities: OpportunityWindow[] = opportunitiesNow.map((e) => {
    const steps = history.get(e.def.id) ?? [];
    const last = steps[steps.length - 1];
    if (e.by !== null && e.at !== null && (last === undefined || last.status !== e.status))
      steps.push({ status: e.status, by: e.by, at: e.at });
    return {
      id: e.def.id,
      mission: e.def.mission,
      opens: e.opens,
      closes: e.closes,
      status: e.status as OpportunityStatus,
      history: steps,
    };
  });

  const missions: TimelineMission[] = [
    ...(missionsNow?.committed ?? []).map((r) => ({
      mission: r.mission,
      status: 'committed' as const,
      openTick: r.openTick,
      commitTick: r.commitTick,
      resolution: r.resolution,
      outcome: r.outcome,
      experienceTicks: r.experienceTicks,
    })),
    ...[...(missionsNow?.open ?? [])]
      .sort((a, b) => a.openTick - b.openTick || (a.def.id < b.def.id ? -1 : 1))
      .map((o) => ({
        mission: o.def.id,
        status: 'open' as const,
        openTick: o.openTick,
        commitTick: o.commitTick,
        resolution: o.resolved?.resolution ?? null,
        outcome: o.resolved?.outcome ?? null,
        experienceTicks: time?.experience.find((e) => e.mission === o.def.id)?.ticks ?? 0,
      })),
  ];

  // Experience: the world's own clocks (open and committed), replaced by a game's own count.
  const experience = new Map<string, ExperienceEntry>();
  for (const c of time?.committed ?? [])
    experience.set(c.mission, { mission: c.mission, from: c.opened, ticks: c.experience });
  for (const e of time?.experience ?? [])
    experience.set(e.mission, { mission: e.mission, from: e.since, ticks: e.ticks });
  for (const e of source.experience ?? []) {
    const opened = missions.find((m) => m.mission === e.mission)?.openTick ?? null;
    experience.set(e.mission, {
      mission: e.mission,
      from: experience.get(e.mission)?.from ?? opened,
      ticks: e.ticks,
    });
  }

  return {
    format: TIMELINE_FORMAT,
    version: TIMELINE_VERSION,
    worldTick,
    logFrom,
    clock: source.clock ? source.clock.map((c) => ({ ...c })) : null,
    frozen,
    experience: [...experience.values()].sort((a, b) => (a.mission < b.mission ? -1 : 1)),
    opportunities,
    missions,
  };
}

/**
 * The oldest world tick `world`'s event log keeps: 0 when it keeps everything, `tick - n` (not
 * below 0) with `log: { ticks: n }`, and null when it records nothing.
 */
export function logFrom(world: World): number | null {
  const { enabled, ticks } = worldInternals(world).log;
  if (!enabled) return null;
  return ticks === undefined ? 0 : Math.max(0, world.tick - ticks);
}

/**
 * A live world's event log from `sinceTick` as plain data (`HeadlessGame.events`): `from` the
 * oldest tick the log keeps (a tool asking for dropped ticks gets what is kept, never an error;
 * the world tick when the log records nothing), `tick` the world tick now, and the changes with
 * `tick >= sinceTick`, oldest first. Reads only.
 */
export function eventsSince(
  world: World,
  sinceTick: number,
): { from: number; tick: number; changes: JsonObject[] } {
  const from = logFrom(world) ?? world.tick;
  return { from, tick: world.tick, changes: world.events(Math.max(sinceTick, 0)) as JsonObject[] };
}

/** The timeline record of a live world (reads its snapshot and log; never changes it). */
export function worldTimeline(
  world: World,
  opts: Pick<TimelineSource, 'clock' | 'experience'> = {},
): Timeline {
  return timelineOf({ world: world.snapshot(), events: world.events(), logFrom: logFrom(world), ...opts });
}

/**
 * The clock, run-length: from one `{ game, world }` sample per game tick (game ticks in order,
 * from 0), the first and last samples and every sample where the world's rate changes (the world
 * moving one tick per game tick, or standing still during a played round). Between two kept
 * entries the world moves at one even rate.
 */
export function compressClock(samples: readonly ClockEntry[]): ClockEntry[] {
  const kept: ClockEntry[] = [];
  samples.forEach((s, i) => {
    const prev = samples[i - 1];
    const next = samples[i + 1];
    if (prev === undefined || next === undefined || s.world - prev.world !== next.world - s.world)
      kept.push({ game: s.game, world: s.world });
  });
  return kept;
}

/** The first game tick at which the world was at `worldTick` or later, by the clock (null past it). */
export function gameTickOf(clock: readonly ClockEntry[], worldTick: number): number | null {
  for (let i = 0; i < clock.length; i++) {
    const at = clock[i] as ClockEntry;
    if (at.world >= worldTick) return at.game;
    const next = clock[i + 1];
    if (next !== undefined && next.world >= worldTick) {
      // Between two entries the world moves at one even rate: one tick per game tick.
      const rate = (next.world - at.world) / (next.game - at.game);
      if (rate > 0) return at.game + Math.ceil((worldTick - at.world) / rate);
    }
  }
  return null;
}

/** What one timeline entry records. */
export type TimelineEntryKind = 'opportunity' | 'freeze' | 'unfreeze' | 'open' | 'commit';

/** One happening on the timeline, at a world tick (and, with a clock, the game tick it fell on). */
export interface TimelineEntry extends JsonObject {
  tick: number;
  game: number | null;
  kind: TimelineEntryKind;
  /** The opportunity, event or mission id. */
  id: string;
  /** The cause (`mission:<id>`, `time`, ...) or null. */
  by: string | null;
  /** `opportunity`: the status it moved to; `commit`: the outcome; else null. */
  detail: string | null;
}

const KIND_ORDER: readonly TimelineEntryKind[] = ['opportunity', 'open', 'freeze', 'unfreeze', 'commit'];

/**
 * The record as one list of happenings in world tick order (then kind, then id): each
 * opportunity's status changes, each mission's open and commit (an open mission's commit is listed
 * at its fixed commit tick only once committed), and each frozen span's start and end. With a
 * clock, `game` is the first game tick the world reached that tick at.
 */
export function timelineEntries(record: Timeline): TimelineEntry[] {
  const game = (tick: number) => (record.clock ? gameTickOf(record.clock, tick) : null);
  const entries: TimelineEntry[] = [];
  const add = (tick: number, kind: TimelineEntryKind, id: string, by: string | null, detail: string | null) =>
    entries.push({ tick, game: game(tick), kind, id, by, detail });
  for (const o of record.opportunities)
    for (const h of o.history) add(h.at, 'opportunity', o.id, h.by, h.status);
  for (const m of record.missions) {
    add(m.openTick, 'open', m.mission, `mission:${m.mission}`, null);
    if (m.status === 'committed') add(m.commitTick, 'commit', m.mission, `mission:${m.mission}`, m.outcome);
  }
  for (const f of record.frozen) {
    add(f.from, 'freeze', f.event, f.by, null);
    if (f.to !== null) add(f.to, 'unfreeze', f.event, f.by, null);
  }
  return entries.sort(
    (a, b) =>
      a.tick - b.tick ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
