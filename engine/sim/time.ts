import { z } from 'zod';
import { defineComponent } from './component';
import type { Cause } from './events';
import { checkCause } from './events';
import type { Entity, World } from './world';
import { worldInternals } from './world';

/**
 * The time service and frozen events (Engine 0.10 T3; docs/BUILD-LOG.md, Engine 0.10, items 150-152;
 * see "Time" in this folder's CLAUDE.md).
 *
 * - **World time** is the world's integer `tick`; only `world.step()` moves it.
 * - **Experience time** is the ticks spent inside an open mission, counted on the mission's clock
 *   (`startExperience`, `addExperience`); it never moves the world.
 * - **Commitment time** is the world tick a mission's result is committed at (`stampCommitment`),
 *   kept in an append-only list.
 * - **Frozen events**: an event is the entities with `EventMember { event }`; freezing it
 *   (`freezeEvent`) makes the RTS and village systems skip them (see "Time" for the list) while
 *   everything else moves on.
 *
 *   const time = timeOf(world);
 *   freezeEvent(world, 'battle', 'mission:raid');
 *   startExperience(world, 'raid', 'mission:raid');
 *   addExperience(world, 'raid', 240, 'mission:raid');   // the world's tick does not move
 *   time.experience('raid');                             // 240
 *
 * All the state is world data: `EventMember` on the members, and `WorldTime` on one world-level
 * entity spawned by the first write. Both kinds are `omitWhenEmpty`, so a world that never uses
 * them snapshots, saves and hashes exactly as before. Writes go through the World API under the
 * cause given (between ticks; during a step the running system is the logged cause and the cause
 * given is kept in the data, e.g. `Frozen.by`). Integers only, no randomness.
 */

const Id = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -');
const Tick = z.int().min(0);
const CauseText = z
  .string()
  .min(1)
  .refine((s) => s.trim() === s, 'must not start or end with a space');

/** An entity taking part in one critical happening (a battle): `event` names it. */
export const EventMember = defineComponent('EventMember', z.strictObject({ event: Id }), {
  omitWhenEmpty: true,
});
export type EventMemberData = z.infer<typeof EventMember.schema>;

/** A frozen event: its id and the cause that froze it. */
export const frozenSchema = z.strictObject({ event: Id, by: CauseText, since: Tick });
export type Frozen = z.infer<typeof frozenSchema>;

/** An open mission's clock: opened at world tick `since`, `ticks` of experience time so far. */
export const experienceSchema = z.strictObject({ mission: Id, since: Tick, ticks: Tick });
export type Experience = z.infer<typeof experienceSchema>;

/** A committed result's times: opened at `opened`, committed at `tick`, `experience` ticks inside. */
export const commitmentSchema = z.strictObject({
  mission: Id,
  opened: Tick,
  tick: Tick,
  experience: Tick,
});
export type Commitment = z.infer<typeof commitmentSchema>;

/**
 * The world's time state, on one world-level entity: frozen events (sorted by event id), open
 * mission clocks (sorted by mission id) and commitments (in commit order, append-only).
 */
export const WorldTime = defineComponent(
  'WorldTime',
  z.strictObject({
    frozen: z.array(frozenSchema),
    experience: z.array(experienceSchema),
    committed: z.array(commitmentSchema),
  }),
  { omitWhenEmpty: true },
);
export type WorldTimeData = z.infer<typeof WorldTime.schema>;

/** The time components: `EventMember` and `WorldTime`. Both are left out of snapshots until used. */
export const TIME_COMPONENTS = Object.freeze([EventMember, WorldTime]);

/** Why a time change was refused (and nothing changed). */
export type TimeRefusal =
  | 'event_frozen'
  | 'event_not_frozen'
  | 'mission_open'
  | 'mission_not_open'
  | 'mission_committed'
  | 'bad_ticks'
  | 'bad_id';

/** The result of a time change: done, or refused with a code and a one-line reason. */
export type TimeResult = { ok: true } | { ok: false; code: TimeRefusal; error: string };

/** The time service: read the three kinds of time and the frozen events. */
export interface TimeService {
  /** World time: the world's tick. */
  readonly world: number;
  /** The experience ticks of open mission `mission`, or null when it has no open clock. */
  experience(mission: string): number | null;
  /** The open mission clocks, by mission id. */
  open(): Experience[];
  /** The commitment of `mission`, or null when it has none. */
  commitment(mission: string): Commitment | null;
  /** Every commitment, in commit order. */
  commitments(): Commitment[];
  /** The frozen events, by event id. */
  frozen(): Frozen[];
  /** Whether entity `id` is a member of a frozen event. */
  isFrozen(id: Entity): boolean;
}

const EMPTY: WorldTimeData = { frozen: [], experience: [], committed: [] };

/** The world-level entity holding `WorldTime`, or null when nothing has used time yet. */
function holder(world: World): Entity | null {
  if (!world.registered(WorldTime)) return null;
  return world.query(WorldTime)[0] ?? null;
}

function stateOf(world: World): WorldTimeData {
  const id = holder(world);
  return id === null ? EMPTY : (world.get(id, WorldTime) as WorldTimeData);
}

/** Register the time components the world lacks (a world built without `TIME_COMPONENTS`). */
function ensureRegistered(world: World): void {
  for (const def of TIME_COMPONENTS) if (!world.registered(def)) world.registerComponent(def);
}

/** Run `fn` under `cause` between ticks; during a step, the running system stays the cause. */
function under(world: World, cause: Cause, fn: () => void): void {
  checkCause(cause);
  if (worldInternals(world).stepping()) fn();
  else world.withCause(cause, fn);
}

/** Write the next time state (spawning the holder entity on first use). */
function write(world: World, cause: Cause, next: WorldTimeData): void {
  under(world, cause, () => {
    ensureRegistered(world);
    const id = holder(world) ?? world.spawn();
    world.add(id, WorldTime, next);
  });
}

const refuse = (code: TimeRefusal, error: string): TimeResult => ({ ok: false, code, error });

/** A refusal when `id` is not a valid event or mission id, else null. */
function badId(kind: string, id: string): TimeResult | null {
  return Id.safeParse(id).success
    ? null
    : refuse(
        'bad_id',
        `${kind} id ${JSON.stringify(id)} must be a letter followed by letters, digits, _ or -`,
      );
}

/**
 * A predicate for "is `id` frozen now", built once per system run: false for every entity when no
 * event is frozen (and the world never touches the time components then).
 */
export function frozenCheck(world: World): (id: Entity) => boolean {
  const frozen = stateOf(world).frozen;
  if (frozen.length === 0 || !world.registered(EventMember)) return () => false;
  const events = new Set(frozen.map((f) => f.event));
  return (id) => {
    const m = world.get(id, EventMember);
    return m !== undefined && events.has(m.event);
  };
}

/** The time service over `world` (read-only; the write functions below change it). */
export function timeOf(world: World): TimeService {
  return {
    get world() {
      return world.tick;
    },
    experience: (mission) => stateOf(world).experience.find((e) => e.mission === mission)?.ticks ?? null,
    open: () => stateOf(world).experience.map((e) => ({ ...e })),
    commitment: (mission) => {
      const c = stateOf(world).committed.find((e) => e.mission === mission);
      return c ? { ...c } : null;
    },
    commitments: () => stateOf(world).committed.map((c) => ({ ...c })),
    frozen: () => stateOf(world).frozen.map((f) => ({ ...f })),
    isFrozen: (id) => frozenCheck(world)(id),
  };
}

/** Make `id` a member of `event` (logged under `cause`). */
export function joinEvent(world: World, id: Entity, event: string, cause: Cause): void {
  under(world, cause, () => {
    ensureRegistered(world);
    world.add(id, EventMember, { event });
  });
}

/** Take `id` out of its event; returns whether it was in one. */
export function leaveEvent(world: World, id: Entity, cause: Cause): boolean {
  if (!world.registered(EventMember)) return false;
  let was = false;
  under(world, cause, () => {
    was = world.remove(id, EventMember);
  });
  return was;
}

/** The members of `event`, ascending by id. */
export function eventMembers(world: World, event: string): Entity[] {
  if (!world.registered(EventMember)) return [];
  return world.query(EventMember).filter((id) => world.get(id, EventMember)?.event === event);
}

/** Freeze `event`: its members are held still until `unfreezeEvent`. Refused when already frozen. */
export function freezeEvent(world: World, event: string, cause: Cause): TimeResult {
  const bad = badId('event', event);
  if (bad) return bad;
  const s = stateOf(world);
  if (s.frozen.some((f) => f.event === event))
    return refuse('event_frozen', `event "${event}" is already frozen`);
  const frozen = [...s.frozen, { event, by: cause, since: world.tick }].sort((a, b) =>
    a.event < b.event ? -1 : 1,
  );
  write(world, cause, { ...s, frozen });
  return { ok: true };
}

/** Unfreeze `event`: its members move on from the next system that runs. Refused when not frozen. */
export function unfreezeEvent(world: World, event: string, cause: Cause): TimeResult {
  const s = stateOf(world);
  if (!s.frozen.some((f) => f.event === event)) {
    return refuse('event_not_frozen', `event "${event}" is not frozen`);
  }
  write(world, cause, { ...s, frozen: s.frozen.filter((f) => f.event !== event) });
  return { ok: true };
}

/** Open `mission`'s clock at the current world tick with 0 experience ticks. */
export function startExperience(world: World, mission: string, cause: Cause): TimeResult {
  const bad = badId('mission', mission);
  if (bad) return bad;
  const s = stateOf(world);
  if (s.committed.some((c) => c.mission === mission)) {
    return refuse('mission_committed', `mission "${mission}" is already committed`);
  }
  if (s.experience.some((e) => e.mission === mission)) {
    return refuse('mission_open', `mission "${mission}" is already open`);
  }
  const experience = [...s.experience, { mission, since: world.tick, ticks: 0 }].sort((a, b) =>
    a.mission < b.mission ? -1 : 1,
  );
  write(world, cause, { ...s, experience });
  return { ok: true };
}

/** Add `ticks` (a whole number, at least 0) of experience time to open `mission`. The tick stays. */
export function addExperience(world: World, mission: string, ticks: number, cause: Cause): TimeResult {
  if (!Number.isInteger(ticks) || ticks < 0) {
    return refuse('bad_ticks', `experience ticks must be a whole number >= 0, got ${ticks}`);
  }
  const s = stateOf(world);
  const open = s.experience.find((e) => e.mission === mission);
  if (!open) return notOpen(s, mission);
  if (ticks === 0) return { ok: true };
  const experience = s.experience.map((e) => (e === open ? { ...e, ticks: e.ticks + ticks } : e));
  write(world, cause, { ...s, experience });
  return { ok: true };
}

/**
 * Commit `mission`'s times: close its clock and append `{ mission, opened, tick, experience }` to
 * the commitments. `tick` is the commitment time, the current tick by default; it may not be before
 * the mission opened. A mission commits once: a second commit is refused (`mission_committed`).
 */
export function stampCommitment(
  world: World,
  mission: string,
  cause: Cause,
  tick: number = world.tick,
): TimeResult {
  const s = stateOf(world);
  const open = s.experience.find((e) => e.mission === mission);
  if (!open) return notOpen(s, mission);
  if (!Number.isInteger(tick) || tick < open.since) {
    return refuse('bad_ticks', `commit tick must be a whole number >= ${open.since}, got ${tick}`);
  }
  write(world, cause, {
    ...s,
    experience: s.experience.filter((e) => e !== open),
    committed: [...s.committed, { mission, opened: open.since, tick, experience: open.ticks }],
  });
  return { ok: true };
}

function notOpen(s: WorldTimeData, mission: string): TimeResult {
  return s.committed.some((c) => c.mission === mission)
    ? refuse('mission_committed', `mission "${mission}" is already committed`)
    : refuse('mission_not_open', `mission "${mission}" is not open`);
}
