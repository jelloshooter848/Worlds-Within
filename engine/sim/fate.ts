import { z } from 'zod';
import { defineComponent } from './component';
import { Building } from './footprint';
import { Health, Member, Owner, Position, Worker, type MemberData, type Role } from './components';
import { Gatherer } from './economy';
import type { Cause } from './events';
import { checkCause } from './events';
import { Cooldown, Facing8, Target, Task, Unit } from './rts';
import { leaveSquad } from './squad';
import { Terrain, heightAt, moveCost, type TerrainData } from './terrain';
import { EventMember, frozenCheck } from './time';
import type { AnyComponent, Entity, System, World } from './world';
import { worldInternals } from './world';

/**
 * Fates of named individuals (Engine 0.13 T2; docs/BUILD-LOG.md, Engine 0.13, decision 1, item 220;
 * see "Fates" in this folder's CLAUDE.md).
 *
 * A named person is an entity with `Member`. Their fate is the `Fate` component: none means
 * **active**; the states are `injured`, `captured`, `freed` and `dead`, and they only move forward:
 *
 *   active, freed           -> injured
 *   active, freed, injured  -> captured
 *   captured                -> freed
 *   any living state        -> dead (final)
 *
 * Every other write is refused (`fate_final`) and changes nothing. `history` keeps every state
 * reached, oldest first, and is append-only.
 *
 * - **Injured** is a label set by data; it never changes `Health` (battle damage alone injures no one).
 * - **Captured**: the person leaves the map (`MAP_COMPONENTS` are removed) and their squad
 *   (`leaveSquad`), but stays in the world with `Member`, `Health` and `Owner`; `held` keeps their
 *   `Unit` and `Owner` data so `freePerson` can put them back on a cell.
 * - **Freed**: back on the given cell with the held `Unit`, in no squad.
 * - **Dead**: off the map and out of their squad like a capture, `Health.hp` set to 0, kept as a
 *   record. `deathSystem` does this for a named person brought to 0 hp in battle.
 *
 *   capturePerson(world, captain, { by: 'raiders', cause: 'mission:sabotage' });
 *   fateOf(world, captain)?.state;    // "captured"
 *   freePerson(world, captain, { x: 4, y: 2 }, 'mission:rescue');
 *
 * The writes (`setFate` and its helpers) run between ticks under the cause given, which is also
 * kept in `history`; during a step they are refused (`stepping`). `Fate` is `omitWhenEmpty`, so a
 * world in which no fate was ever set snapshots, saves and hashes exactly as before. Integers
 * only, no randomness.
 */

const Id = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -');
const Tick = z.int().min(0);
const CauseText = z
  .string()
  .min(1)
  .refine((s) => s.trim() === s, 'must not start or end with a space');

/** The states a `Fate` holds. A named person with no `Fate` is `active`. */
export const FATE_STATES = ['injured', 'captured', 'freed', 'dead'] as const;
export type FateState = (typeof FATE_STATES)[number];
/** A named person's state as read: one of `FATE_STATES`, or `active` when they have no `Fate`. */
export type FateReading = FateState | 'active';

/** One state reached: when, by whom (a faction id, or null when not known) and under what cause. */
export const fateStepSchema = z.strictObject({
  state: z.enum(FATE_STATES),
  by: Id.nullable(),
  at: Tick,
  cause: CauseText,
});
export type FateStep = z.infer<typeof fateStepSchema>;

/**
 * A named person's fate: the current `state`, `by` whom and `at` which world tick it was reached,
 * `held` (a captured person's map data, kept to free them; null in every other state) and
 * `history` (every state reached, oldest first; its last entry is the current state).
 */
export const Fate = defineComponent(
  'Fate',
  z
    .strictObject({
      state: z.enum(FATE_STATES),
      by: Id.nullable(),
      at: Tick,
      held: z.strictObject({ unit: Unit.schema.nullable(), owner: Owner.schema.nullable() }).nullable(),
      history: z.array(fateStepSchema).min(1),
    })
    .refine((f) => (f.state === 'captured') === (f.held !== null), {
      message: 'held is set exactly when the state is captured',
    })
    .refine(
      (f) => {
        const last = f.history[f.history.length - 1];
        return last !== undefined && last.state === f.state && last.by === f.by && last.at === f.at;
      },
      { message: "history's last entry must be the current state" },
    ),
  { omitWhenEmpty: true },
);
export type FateData = z.infer<typeof Fate.schema>;

/** The fate components: `Fate`. Left out of snapshots until used. */
export const FATE_COMPONENTS = Object.freeze([Fate]);

/**
 * The components a captured or dead person loses: everything that puts them on the map or in
 * play (`Member`, `Health` and `Owner` stay).
 */
export const MAP_COMPONENTS: readonly AnyComponent[] = Object.freeze([
  Position,
  Unit,
  Task,
  Target,
  Cooldown,
  Facing8,
  Worker,
  Gatherer,
  EventMember,
]);

/** Which states each state may move to (`active` is no `Fate`). */
const NEXT: Readonly<Record<FateReading, readonly FateState[]>> = Object.freeze({
  active: ['injured', 'captured', 'dead'],
  freed: ['injured', 'captured', 'dead'],
  injured: ['captured', 'dead'],
  captured: ['freed', 'dead'],
  dead: [],
});

/** Why a fate write was refused (and nothing changed). */
export type FateRefusal = 'bad_id' | 'not_named' | 'fate_final' | 'bad_cell' | 'stepping';

/** The result of a fate write: done (with the fate now held), or refused with a code and a reason. */
export type FateResult = { ok: true; fate: FateData } | { ok: false; code: FateRefusal; error: string };

/** A named person's fate as read (`fateOf`). */
export interface FateView {
  readonly state: FateReading;
  /** Who captured or killed them, or null (always null while active). */
  readonly by: string | null;
  /** The world tick the state was reached, or null while active. */
  readonly at: number | null;
  readonly history: readonly FateStep[];
}

/** A named person and their fate (`namedPeople`). */
export interface NamedPerson {
  readonly id: Entity;
  readonly name: string;
  readonly role: Role;
  readonly squad: Entity | null;
  readonly fate: FateReading;
}

/** Options for `setFate`. */
export interface FateOptions {
  /** The cause the changes are logged under, and kept in `history`. */
  readonly cause: Cause;
  /** Who captured or killed them (a faction id); default null. */
  readonly by?: string | null;
  /** The world tick to record (default: the world's tick now), for a fate carried from another world. */
  readonly at?: number;
  /** For `freed` only (and required then): the cell they are put back on. */
  readonly cell?: { readonly x: number; readonly y: number };
}

const ACTIVE: FateView = Object.freeze({ state: 'active', by: null, at: null, history: Object.freeze([]) });

/**
 * The fate of named person `id`: `active` (with no history) when they have no `Fate`, or null when
 * `id` is not a living entity with `Member`.
 */
export function fateOf(world: World, id: Entity): FateView | null {
  if (!world.alive(id) || !world.has(id, Member)) return null;
  if (!world.registered(Fate)) return ACTIVE;
  const f = world.get(id, Fate);
  if (f === undefined) return ACTIVE;
  return { state: f.state, by: f.by, at: f.at, history: f.history };
}

/** Every named person (entity with `Member`), ascending by id, with their fate. */
export function namedPeople(world: World): NamedPerson[] {
  if (!world.registered(Member)) return [];
  return world.query(Member).map((id) => {
    const m = world.get(id, Member) as MemberData;
    return { id, name: m.name, role: m.role, squad: m.squad, fate: (fateOf(world, id) as FateView).state };
  });
}

const refuse = (code: FateRefusal, error: string): FateResult => ({ ok: false, code, error });

/** Why `cell` cannot take a freed person, or null. Without a terrain any integer cell will do. */
function cellRefusal(world: World, cell: FateOptions['cell']): string | null {
  if (cell === undefined) return 'freeing someone needs a cell to put them on';
  if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) {
    return `cell (${cell.x}, ${cell.y}) must be whole numbers`;
  }
  const t = terrain(world);
  if (t !== null && moveCost(t, cell.x, cell.y) === null) {
    return `cell (${cell.x}, ${cell.y}) is off the map or cannot be entered`;
  }
  return null;
}

function terrain(world: World): TerrainData | null {
  if (!world.registered(Terrain)) return null;
  const holder = world.query(Terrain)[0];
  return holder === undefined ? null : (world.get(holder, Terrain) as TerrainData);
}

/** Why `id` cannot move to `state`, or null when it can. */
function fateRefusal(world: World, id: Entity, state: FateState, options: FateOptions): FateResult | null {
  if (!Number.isInteger(id) || !world.alive(id)) return refuse('bad_id', `entity ${id} does not exist`);
  if (!world.has(id, Member)) return refuse('not_named', `entity ${id} is not a named person (no Member)`);
  if (!(FATE_STATES as readonly string[]).includes(state)) {
    return refuse('fate_final', `"${String(state)}" is not a fate (${FATE_STATES.join(', ')})`);
  }
  const from = (fateOf(world, id) as FateView).state;
  if (!NEXT[from].includes(state)) {
    return refuse(
      'fate_final',
      from === 'dead'
        ? `entity ${id} is dead; a death is final`
        : `entity ${id} is ${from} and cannot become ${state}`,
    );
  }
  if (options.by !== undefined && options.by !== null && !Id.safeParse(options.by).success) {
    return refuse(
      'bad_id',
      `faction id ${JSON.stringify(options.by)} must be a letter followed by letters, digits, _ or -`,
    );
  }
  if (options.at !== undefined && !Tick.safeParse(options.at).success) {
    return refuse('bad_id', `tick ${options.at} must be a whole number of at least 0`);
  }
  if (state === 'freed') {
    const why = cellRefusal(world, options.cell);
    if (why !== null) return refuse('bad_cell', `entity ${id}: ${why}`);
  }
  return null;
}

/** Take a person off the map and out of their squad (for a capture or a death). */
function leaveMap(world: World, id: Entity): void {
  leaveSquad(world, id);
  for (const def of MAP_COMPONENTS) if (world.registered(def)) world.remove(id, def);
}

/**
 * Write a checked fate (no refusal left): the map and squad changes the state needs, then `Fate`.
 * Runs inside the caller's cause (a `withCause`, or a running system).
 */
function writeFate(world: World, id: Entity, state: FateState, options: FateOptions): FateData {
  if (!world.registered(Fate)) world.registerComponent(Fate);
  const before = world.get(id, Fate);
  const by = options.by ?? null;
  const at = options.at ?? world.tick;
  let held: FateData['held'] = null;
  if (state === 'captured') {
    held = { unit: world.get(id, Unit) ?? null, owner: world.get(id, Owner) ?? null };
    leaveMap(world, id);
  } else if (state === 'dead') {
    leaveMap(world, id);
    const h = world.get(id, Health);
    if (h && h.hp > 0) world.add(id, Health, { hp: 0, max: h.max });
  } else if (state === 'freed') {
    const cell = options.cell as { x: number; y: number };
    const t = terrain(world);
    world.add(id, Position, { x: cell.x, y: cell.y, z: t === null ? 0 : heightAt(t, cell.x, cell.y) });
    const unit = before?.held?.unit ?? null;
    if (unit !== null) world.add(id, Unit, unit);
  }
  const step: FateStep = { state, by, at, cause: options.cause };
  return world.add(id, Fate, { state, by, at, held, history: [...(before?.history ?? []), step] });
}

/**
 * Move named person `id` to `state`, between ticks, logged under `options.cause`. Refused (with
 * nothing changed) when `id` is not a living entity (`bad_id`), has no `Member` (`not_named`), the
 * move is not forward (`fate_final`: see the top of this file), a `freed` has no enterable cell
 * (`bad_cell`), or a step is running (`stepping`).
 */
export function setFate(world: World, id: Entity, state: FateState, options: FateOptions): FateResult {
  checkCause(options.cause);
  if (worldInternals(world).stepping()) return refuse('stepping', 'cannot set a fate during a step');
  const why = fateRefusal(world, id, state, options);
  if (why !== null) return why;
  const fate = world.withCause(options.cause, (w) => writeFate(w, id, state, options));
  return { ok: true, fate };
}

/** Options for `startFate`: the cause, and who and when, as the other world recorded them. */
export interface StartFateOptions {
  readonly cause: Cause;
  readonly by: string | null;
  readonly at: number;
}

/**
 * Give named person `id`, who has no `Fate` yet (a person just built from a scenario), the fate
 * `state` reached in another world (carry-over, `carry.ts`), between ticks, under `options.cause`.
 * The forward-only rule is not asked here: the state was reached in the other world, so any state
 * may start. `captured` and `dead` take them off the map as `setFate` does (a captured person's
 * `held` is their `Unit` and `Owner` here); `injured` and `freed` leave them where the scenario put
 * them. `history` holds the one step, with `by`, `at` and the cause given. Refused (nothing changed)
 * when `id` is not a living `Member` or already has a `Fate`, or during a step.
 */
export function startFate(world: World, id: Entity, state: FateState, options: StartFateOptions): FateResult {
  checkCause(options.cause);
  if (worldInternals(world).stepping()) return refuse('stepping', 'cannot set a fate during a step');
  if (!Number.isInteger(id) || !world.alive(id)) return refuse('bad_id', `entity ${id} does not exist`);
  if (!world.has(id, Member)) return refuse('not_named', `entity ${id} is not a named person (no Member)`);
  if (world.registered(Fate) && world.has(id, Fate)) {
    return refuse('fate_final', `entity ${id} already has a fate; a carried fate starts a fresh person`);
  }
  if (!(FATE_STATES as readonly string[]).includes(state)) {
    return refuse('fate_final', `"${String(state)}" is not a fate (${FATE_STATES.join(', ')})`);
  }
  if (options.by !== null && !Id.safeParse(options.by).success) {
    return refuse(
      'bad_id',
      `faction id ${JSON.stringify(options.by)} must be a letter followed by letters, digits, _ or -`,
    );
  }
  if (!Tick.safeParse(options.at).success) {
    return refuse('bad_id', `tick ${options.at} must be a whole number of at least 0`);
  }
  const { by, at, cause } = options;
  const fate = world.withCause(cause, (w) => {
    if (state !== 'freed') return writeFate(w, id, state, { cause, by, at });
    if (!w.registered(Fate)) w.registerComponent(Fate);
    return w.add(id, Fate, { state, by, at, held: null, history: [{ state, by, at, cause }] });
  });
  return { ok: true, fate };
}

/** Options for the one-state helpers: the cause, and who did it. */
export interface FateWriteOptions {
  readonly cause: Cause;
  readonly by?: string | null;
}

/** Mark named person `id` injured (a label; `Health` is not changed). See `setFate`. */
export function injurePerson(world: World, id: Entity, options: FateWriteOptions): FateResult {
  return setFate(world, id, 'injured', options);
}

/** Capture named person `id` (`by` the faction holding them): off the map and out of their squad. */
export function capturePerson(world: World, id: Entity, options: FateWriteOptions): FateResult {
  return setFate(world, id, 'captured', options);
}

/** Kill named person `id`: off the map and out of their squad, hp 0, kept as a dead record. */
export function killPerson(world: World, id: Entity, options: FateWriteOptions): FateResult {
  return setFate(world, id, 'dead', options);
}

/** Free captured person `id` onto `cell` (enterable), with the `Unit` they had; they join no squad. */
export function freePerson(
  world: World,
  id: Entity,
  cell: { readonly x: number; readonly y: number },
  cause: Cause,
  by: string | null = null,
): FateResult {
  return setFate(world, id, 'freed', { cause, by, cell });
}

/**
 * `death`: every `Unit` or `Building` whose `Health.hp` is 0, in id order. A named person (with
 * `Member`) is kept as a dead record: they leave their squad (`leaveSquad`) and the map
 * (`MAP_COMPONENTS`) and get `Fate { state: "dead", by: null, at: tick }` (the attack system does
 * not record who struck). Anything else is destroyed (each removal and the destroy are in the log
 * under `death`). A member of a frozen event does not die until it unfreezes.
 */
export const deathSystem: System = {
  name: 'death',
  run(world) {
    const frozen = frozenCheck(world);
    for (const id of world.query(Health)) {
      if (!world.has(id, Unit) && !world.has(id, Building)) continue;
      if (frozen(id)) continue;
      if ((world.get(id, Health) as { hp: number }).hp > 0) continue;
      if (!world.has(id, Member)) world.destroy(id);
      else if (fateOf(world, id)?.state !== 'dead')
        writeFate(world, id, 'dead', { cause: 'death', by: null });
    }
  },
};
