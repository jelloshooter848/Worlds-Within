import { z } from 'zod';
import type { Facing } from '@engine/core/present';
import { fateState, type SnapshotFate } from '@engine/core/mission-adapter';
import { rtsTypesSchema, type RtsTypes } from '@engine/core/rts-types';

/**
 * The kit's own reader of a world snapshot (docs/BUILD-LOG.md, Engine 0.9, decision 2, item 122):
 * the plain JSON `World.snapshot()` gives (`{ seed, tick, nextId, rng, entities, components: {
 * <Name>: [[id, data], ...] } }`), read into a typed view of what the RTS kit needs, with no
 * `engine/sim` import. It only reads the components named below, and only the fields it uses
 * (extra fields are allowed, so the sim can grow without breaking the kit). Pure.
 *
 *   const view = readWorld(world.snapshot());   // in a game's glue, which may import the sim
 *   view.units.filter((u) => u.faction === 'red');
 *
 * Since Engine 0.11 (decision 4, item 175) it also reads the world's mission state, loosely and
 * only when present: offered opportunities (`Opportunities`), open and committed missions
 * (`Missions`), frozen events (`WorldTime.frozen`) and each entity's `EventMember`, into
 * `view.missions` and each unit's and building's `event` / `frozen`. A snapshot without them (a
 * 0.9 world) reads as before, with no missions and nothing frozen.
 *
 * Since Engine 0.13 (decision 3, item 222) it reads fates (`Fate`, through `engine/core`'s
 * `fateState`, as every kit does): a captured or dead person is never a unit of the view (the sim
 * takes them off the map, and the kit skips them by the data too), and `view.named` lists every
 * named person (`Member`) with their fate and current hp, on the map or not, for a HUD.
 *
 * Bad data (a component of the wrong shape, a snapshot that is not one) throws, naming the field:
 * a snapshot comes from the sim, so a bad one is a bug, not a player mistake.
 */

/** One terrain type, as the sim's `Terrain` lists it. */
export interface RtsTerrainType {
  name: string;
  cost: number;
  passable: boolean;
}

/** The world's terrain grid: `cells[y * width + x]` indexes `types`. */
export interface RtsTerrain {
  width: number;
  height: number;
  types: RtsTerrainType[];
  cells: number[];
}

/** A unit as the view sees it. */
export interface RtsUnitView {
  id: number;
  /** Its unit type id (`Unit.type`), or null. */
  type: string | null;
  faction: string | null;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** `Facing8.dir` (0 north ... 7 north-west), or null when it has not moved or fought. */
  dir: number | null;
  /** Its `Task` kind, or null when it has none. */
  task: 'move' | 'attack' | 'build' | 'gather' | null;
  /** The entity it fights (`Target`), or null. */
  target: number | null;
  /** Ticks before it may step again (0 when it has no `Cooldown`). */
  moveWait: number;
  /** Ticks before it may hit again. */
  attackWait: number;
  /** True when it can build (`Worker`). */
  worker: boolean;
  /** True when it can gather (`Gatherer`). */
  gatherer: boolean;
  /** What it carries (`Gatherer.carry`; 0 for a non-gatherer). */
  carry: number;
  /** Its squad role (`Member.role`), or null when it is not a named member. */
  role: 'regular' | 'hero' | 'captain' | null;
  /** The event it takes part in (`EventMember.event`), or null. */
  event: string | null;
  /** True while its event is frozen (an open mission holds it). */
  frozen: boolean;
  /** How far it sees in whole cells (`Unit.sight`), when the snapshot has it (Engine 0.16 part D). */
  sight?: number;
  /** Its move task's goal cell (`Task.goal`), when it has one (Engine 0.16 part D, path dots). */
  goal?: { x: number; y: number };
  /** The cells still to enter on its A* way (`Task.path`), when not empty (Engine 0.16 part D). */
  path?: { x: number; y: number }[];
}

/** A building as the view sees it. */
export interface RtsBuildingView {
  id: number;
  kind: string;
  faction: string | null;
  /** North-west cell and size in cells. */
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  dropoff: boolean;
  /** Its construction, or null when it was placed built. */
  construction: { progress: number; work: number; done: boolean } | null;
  /** What it trains and its queue, or null when it trains nothing. */
  producer: { trains: string[]; queue: { unit: string; ticks: number }[]; progress: number } | null;
  /** The event it takes part in (`EventMember.event`), or null. */
  event: string | null;
  /** True while its event is frozen. */
  frozen: boolean;
}

/** A resource node. */
export interface RtsResourceView {
  id: number;
  item: string;
  x: number;
  y: number;
  /** What is left (`Inventory[item]`). */
  amount: number;
}

/** An opportunity offered now: taking it opens `mission`; it closes at world tick `closes`. */
export interface RtsOffer {
  opportunity: string;
  mission: string;
  closes: number | null;
}

/** An open mission: opened at `openTick`, its result commits at `commitTick` (world ticks). */
export interface RtsOpenMission {
  id: string;
  title: string;
  /** The event it holds frozen, or null. */
  event: string | null;
  openTick: number;
  commitTick: number;
  /** True once it was played, quit or delegated (it still waits for its commit tick). */
  resolved: boolean;
}

/**
 * The world's missions as the kit reads them (Engine 0.11, decision 4, item 175): all empty when
 * the world has none (a 0.9 snapshot). The kit only reads them; opening one is the sim's answer.
 */
export interface RtsMissionsView {
  /** The opportunities offered now, by opportunity id. */
  offered: RtsOffer[];
  /** The open missions, by mission id. */
  open: RtsOpenMission[];
  /** The committed missions' ids, in commit order. */
  committed: string[];
  /** Every mission some opportunity names (it opens only through one), sorted. */
  gated: string[];
  /** The frozen events' ids, sorted. */
  frozen: string[];
}

/**
 * A named person (`Member`) as the view lists them for a HUD (Engine 0.13): their fate, their hp
 * now (an injured person's reduced hp) and their cell, or null when they are off the map (captured
 * or dead).
 */
export interface RtsNamedView {
  id: number;
  name: string;
  role: 'regular' | 'hero' | 'captain';
  faction: string | null;
  fate: SnapshotFate;
  hp: number;
  maxHp: number;
  x: number | null;
  y: number | null;
}

/** The world as the RTS kit reads it. Lists are in ascending id order. */
export interface RtsView {
  tick: number;
  terrain: RtsTerrain | null;
  units: RtsUnitView[];
  buildings: RtsBuildingView[];
  resources: RtsResourceView[];
  /** Each faction's stockpile (`Stockpile` + `Inventory`): faction -> item -> count. */
  stock: Record<string, Record<string, number>>;
  /** The world's unit and building types (`RtsTypes`, the lowest id), or null when it has none. */
  types: RtsTypes | null;
  /** Offered opportunities, open missions and frozen events. */
  missions: RtsMissionsView;
  /** Every named person with their fate (Engine 0.13), on the map or not. */
  named: RtsNamedView[];
}

const Id = z.int().min(1);
const Cell = z.looseObject({ x: z.int(), y: z.int() });

/** Each component the kit reads: the schema of one entity's data (extra fields allowed). */
const ROW_DATA = {
  Terrain: z.looseObject({
    width: z.int().min(1),
    height: z.int().min(1),
    types: z.array(z.looseObject({ name: z.string(), cost: z.int(), passable: z.boolean() })),
    cells: z.array(z.int().min(0)),
  }),
  Position: Cell,
  Owner: z.looseObject({ faction: z.string() }),
  Health: z.looseObject({ hp: z.int(), max: z.int() }),
  Unit: z.looseObject({ type: z.string().nullable().default(null), sight: z.int().min(0).optional() }),
  Facing8: z.looseObject({ dir: z.int().min(0).max(7) }),
  Task: z.looseObject({
    kind: z.enum(['move', 'attack', 'build', 'gather']),
    goal: Cell.nullable().optional(),
    path: z.array(Cell).optional(),
  }),
  Target: z.looseObject({ entity: Id }),
  Cooldown: z.looseObject({ move: z.int(), attack: z.int() }),
  Worker: z.looseObject({}),
  Gatherer: z.looseObject({ carry: z.int() }),
  Member: z.looseObject({ name: z.string().default(''), role: z.enum(['regular', 'hero', 'captain']) }),
  // Fates (Engine 0.13): left out of a snapshot until someone's fate moves.
  Fate: z.looseObject({ state: z.enum(['injured', 'captured', 'freed', 'dead']) }),
  Building: z.looseObject({ kind: z.string(), w: z.int(), h: z.int(), dropoff: z.boolean() }),
  Construction: z.looseObject({ progress: z.int(), work: z.int(), done: z.boolean() }),
  Producer: z.looseObject({
    trains: z.array(z.string()),
    queue: z.array(z.looseObject({ unit: z.string(), ticks: z.int() })),
    progress: z.int(),
  }),
  Resource: z.looseObject({ item: z.string() }),
  Inventory: z.record(z.string(), z.int()),
  Stockpile: z.looseObject({ faction: z.string() }),
  RtsTypes: rtsTypesSchema,
  // Time and missions (Engine 0.10-0.11): all left out of a snapshot until used.
  EventMember: z.looseObject({ event: z.string() }),
  WorldTime: z.looseObject({ frozen: z.array(z.looseObject({ event: z.string() })).default([]) }),
  Missions: z.looseObject({
    open: z
      .array(
        z.looseObject({
          def: z.looseObject({ id: z.string(), title: z.string(), event: z.string().optional() }),
          openTick: z.int().min(0),
          commitTick: z.int().min(0),
          resolved: z.unknown().optional(),
        }),
      )
      .default([]),
    committed: z.array(z.looseObject({ mission: z.string() })).default([]),
  }),
  Opportunities: z.looseObject({
    list: z
      .array(
        z.looseObject({
          def: z.looseObject({ id: z.string(), mission: z.string() }),
          status: z.string(),
          closes: z.int().nullable().default(null),
        }),
      )
      .default([]),
  }),
};

type RowData = typeof ROW_DATA;
type Components = { [K in keyof RowData]: [number, z.output<RowData[K]>][] };

/**
 * The parsed data of each frozen component value seen (Engine 0.16 part D, D9): a world's
 * `peek()` hands the kit its stored values, which are deep-frozen and keep their identity until
 * changed, so a value parsed once (the terrain, the types, every unit that did not move) is not
 * parsed again. Parsed values are frozen too: views share them.
 */
const parsedData = new WeakMap<object, unknown>();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function bad(path: readonly PropertyKey[], message: string): never {
  throw new Error(`not an RTS world snapshot: ${path.join('.')}: ${message}`);
}

/** One component kind's rows `[id, data]`, each data parsed by its schema (cached when frozen). */
function readRows(name: keyof RowData, list: unknown): [number, unknown][] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) bad(['components', name], 'expected an array');
  return list.map((row: unknown, i): [number, unknown] => {
    if (!Array.isArray(row) || row.length !== 2) bad(['components', name, i], 'expected an [id, data] pair');
    const [id, data] = row as [unknown, unknown];
    if (!Id.safeParse(id).success) bad(['components', name, i, 0], 'expected an entity id');
    const frozen = data !== null && typeof data === 'object' && Object.isFrozen(data);
    if (frozen && parsedData.has(data)) return [id as number, parsedData.get(data)];
    const parsed = ROW_DATA[name].safeParse(data);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      bad(['components', name, i, 1, ...issue.path], issue.message);
    }
    if (!frozen) return [id as number, parsed.data];
    const value = deepFreeze(parsed.data);
    parsedData.set(data, value);
    return [id as number, value];
  });
}

/** The snapshot's tick and the components the kit reads (a kind left out has no rows). */
function readSnapshot(json: unknown): { tick: number; components: Components } {
  if (json === null || typeof json !== 'object') bad([], 'expected an object');
  const { tick, components } = json as { tick?: unknown; components?: unknown };
  if (!z.int().min(0).safeParse(tick).success) bad(['tick'], 'expected a whole number >= 0');
  if (components === null || typeof components !== 'object' || Array.isArray(components))
    bad(['components'], 'expected an object');
  const all = components as Record<string, unknown>;
  const out = {} as Record<string, unknown>;
  for (const name of Object.keys(ROW_DATA) as (keyof RowData)[]) out[name] = readRows(name, all[name]);
  return { tick: tick as number, components: out as Components };
}

/** Reads a world snapshot (see the file comment). Throws naming the first bad field. */
export function readWorld(json: unknown): RtsView {
  const parsed = readSnapshot(json);
  const c = parsed.components;
  const byId = <T>(list: readonly (readonly [number, T])[]) => new Map(list.map(([id, v]) => [id, v]));
  const pos = byId(c.Position);
  const owner = byId(c.Owner);
  const health = byId(c.Health);
  const facing = byId(c.Facing8);
  const task = byId(c.Task);
  const target = byId(c.Target);
  const cooldown = byId(c.Cooldown);
  const worker = byId(c.Worker);
  const gatherer = byId(c.Gatherer);
  const member = byId(c.Member);
  const construction = byId(c.Construction);
  const producer = byId(c.Producer);
  const inventory = byId(c.Inventory);
  const eventOf = byId(c.EventMember);
  const fates = byId(c.Fate);
  const fateOf = (id: number): SnapshotFate => {
    const fate = fates.get(id);
    return fate === undefined ? 'active' : fateState({ id, components: { Fate: { state: fate.state } } });
  };
  const lost = (id: number) => fateOf(id) === 'captured' || fateOf(id) === 'dead';
  const missions = readMissions(c.WorldTime, c.Missions, c.Opportunities);
  const frozenEvents = new Set(missions.frozen);
  const membership = (id: number) => {
    const event = eventOf.get(id)?.event ?? null;
    return { event, frozen: event !== null && frozenEvents.has(event) };
  };

  const t = c.Terrain[0]?.[1];
  const terrain: RtsTerrain | null = t
    ? {
        width: t.width,
        height: t.height,
        types: t.types.map((ty) => ({ name: ty.name, cost: ty.cost, passable: ty.passable })),
        cells: [...t.cells],
      }
    : null;

  const units: RtsUnitView[] = [];
  for (const [id, unit] of c.Unit) {
    const p = pos.get(id);
    if (!p || lost(id)) continue;
    const h = health.get(id);
    const cd = cooldown.get(id);
    const tk = task.get(id);
    units.push({
      id,
      type: unit.type,
      faction: owner.get(id)?.faction ?? null,
      x: p.x,
      y: p.y,
      hp: h?.hp ?? 1,
      maxHp: h?.max ?? 1,
      dir: facing.get(id)?.dir ?? null,
      task: tk?.kind ?? null,
      target: target.get(id)?.entity ?? null,
      moveWait: cd?.move ?? 0,
      attackWait: cd?.attack ?? 0,
      worker: worker.has(id),
      gatherer: gatherer.has(id),
      carry: gatherer.get(id)?.carry ?? 0,
      role: member.get(id)?.role ?? null,
      ...membership(id),
      ...(unit.sight !== undefined && { sight: unit.sight }),
      ...(tk?.goal != null && { goal: { x: tk.goal.x, y: tk.goal.y } }),
      ...(tk?.path !== undefined && tk.path.length > 0 && { path: tk.path.map((c) => ({ x: c.x, y: c.y })) }),
    });
  }

  const buildings: RtsBuildingView[] = [];
  for (const [id, b] of c.Building) {
    const p = pos.get(id);
    if (!p || lost(id)) continue;
    const h = health.get(id);
    const k = construction.get(id);
    const pr = producer.get(id);
    buildings.push({
      id,
      kind: b.kind,
      faction: owner.get(id)?.faction ?? null,
      x: p.x,
      y: p.y,
      w: b.w,
      h: b.h,
      hp: h?.hp ?? 1,
      maxHp: h?.max ?? 1,
      dropoff: b.dropoff,
      construction: k ? { progress: k.progress, work: k.work, done: k.done } : null,
      producer: pr
        ? {
            trains: [...pr.trains],
            queue: pr.queue.map((q) => ({ unit: q.unit, ticks: q.ticks })),
            progress: pr.progress,
          }
        : null,
      ...membership(id),
    });
  }

  const resources: RtsResourceView[] = [];
  for (const [id, r] of c.Resource) {
    const p = pos.get(id);
    if (!p) continue;
    resources.push({ id, item: r.item, x: p.x, y: p.y, amount: inventory.get(id)?.[r.item] ?? 0 });
  }

  const stock: Record<string, Record<string, number>> = {};
  for (const [id, s] of c.Stockpile) {
    if (stock[s.faction] !== undefined) continue; // the lowest id wins, as in the sim
    stock[s.faction] = { ...(inventory.get(id) ?? {}) };
  }

  const named: RtsNamedView[] = c.Member.map(([id, m]) => {
    const p = lost(id) ? undefined : pos.get(id);
    const h = health.get(id);
    return {
      id,
      name: m.name,
      role: m.role,
      faction: owner.get(id)?.faction ?? null,
      fate: fateOf(id),
      hp: h?.hp ?? 1,
      maxHp: h?.max ?? 1,
      x: p?.x ?? null,
      y: p?.y ?? null,
    };
  });

  return {
    tick: parsed.tick,
    terrain,
    units,
    buildings,
    resources,
    stock,
    types: c.RtsTypes[0]?.[1] ?? null,
    missions,
    named,
  };
}

/** The missions view from the world-level time, missions and opportunities state (the lowest id). */
function readMissions(
  time: Components['WorldTime'],
  missions: Components['Missions'],
  opportunities: Components['Opportunities'],
): RtsMissionsView {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const list = opportunities[0]?.[1].list ?? [];
  const m = missions[0]?.[1];
  return {
    offered: list
      .filter((o) => o.status === 'offered')
      .map((o) => ({ opportunity: o.def.id, mission: o.def.mission, closes: o.closes }))
      .sort((a, b) => cmp(a.opportunity, b.opportunity)),
    open: (m?.open ?? [])
      .map((o) => ({
        id: o.def.id,
        title: o.def.title,
        event: o.def.event ?? null,
        openTick: o.openTick,
        commitTick: o.commitTick,
        resolved: o.resolved !== undefined && o.resolved !== null,
      }))
      .sort((a, b) => cmp(a.id, b.id)),
    committed: (m?.committed ?? []).map((r) => r.mission),
    gated: [...new Set(list.map((o) => o.def.mission))].sort(cmp),
    frozen: [...new Set((time[0]?.[1].frozen ?? []).map((f) => f.event))].sort(cmp),
  };
}

/** Whether a building is finished (placed built, or its construction done). */
export function isFinished(b: RtsBuildingView): boolean {
  return b.construction === null || b.construction.done;
}

/** The facing a `Facing8.dir` shows: 0 north is `up`, 2 east `right`, ..., 7 north-west `up-left`. */
export const DIR_FACINGS: readonly Facing[] = Object.freeze([
  'up',
  'up-right',
  'right',
  'down-right',
  'down',
  'down-left',
  'left',
  'up-left',
]);

/** The facing of a unit: from its `dir`, `down` when it has none. */
export function facingOfDir(dir: number | null): Facing {
  return dir === null ? 'down' : (DIR_FACINGS[dir] ?? 'down');
}

/** What stands on cell (x, y), in pick order: a unit (lowest id first), a building, a resource node. */
export type RtsThing =
  | { what: 'unit'; unit: RtsUnitView }
  | { what: 'building'; building: RtsBuildingView }
  | { what: 'resource'; resource: RtsResourceView };

/**
 * What stands on a cell: the unit there (the player's own first, then the lowest id), else the
 * building whose footprint covers it, else the resource node there, else null.
 */
export function thingAt(view: RtsView, x: number, y: number, faction: string | null = null): RtsThing | null {
  const here = view.units.filter((u) => u.x === x && u.y === y);
  const unit = here.find((u) => u.faction === faction) ?? here[0];
  if (unit) return { what: 'unit', unit };
  const building = view.buildings.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  if (building) return { what: 'building', building };
  const resource = view.resources.find((r) => r.x === x && r.y === y);
  if (resource) return { what: 'resource', resource };
  return null;
}
