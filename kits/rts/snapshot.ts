import { z } from 'zod';
import type { Facing } from '@engine/core/present';
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
}

const Id = z.int().min(1);
const rows = <T extends z.ZodType>(data: T) => z.array(z.tuple([Id, data])).default([]);
const Cell = z.looseObject({ x: z.int(), y: z.int() });

const snapshotSchema = z.looseObject({
  tick: z.int().min(0),
  components: z.looseObject({
    Terrain: rows(
      z.looseObject({
        width: z.int().min(1),
        height: z.int().min(1),
        types: z.array(z.looseObject({ name: z.string(), cost: z.int(), passable: z.boolean() })),
        cells: z.array(z.int().min(0)),
      }),
    ),
    Position: rows(Cell),
    Owner: rows(z.looseObject({ faction: z.string() })),
    Health: rows(z.looseObject({ hp: z.int(), max: z.int() })),
    Unit: rows(z.looseObject({ type: z.string().nullable().default(null) })),
    Facing8: rows(z.looseObject({ dir: z.int().min(0).max(7) })),
    Task: rows(z.looseObject({ kind: z.enum(['move', 'attack', 'build', 'gather']) })),
    Target: rows(z.looseObject({ entity: Id })),
    Cooldown: rows(z.looseObject({ move: z.int(), attack: z.int() })),
    Worker: rows(z.looseObject({})),
    Gatherer: rows(z.looseObject({ carry: z.int() })),
    Member: rows(z.looseObject({ role: z.enum(['regular', 'hero', 'captain']) })),
    Building: rows(z.looseObject({ kind: z.string(), w: z.int(), h: z.int(), dropoff: z.boolean() })),
    Construction: rows(z.looseObject({ progress: z.int(), work: z.int(), done: z.boolean() })),
    Producer: rows(
      z.looseObject({
        trains: z.array(z.string()),
        queue: z.array(z.looseObject({ unit: z.string(), ticks: z.int() })),
        progress: z.int(),
      }),
    ),
    Resource: rows(z.looseObject({ item: z.string() })),
    Inventory: rows(z.record(z.string(), z.int())),
    Stockpile: rows(z.looseObject({ faction: z.string() })),
    RtsTypes: rows(rtsTypesSchema),
  }),
});

/** Reads a world snapshot (see the file comment). Throws naming the first bad field. */
export function readWorld(json: unknown): RtsView {
  const parsed = snapshotSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new Error(`not an RTS world snapshot: ${issue.path.join('.')}: ${issue.message}`);
  }
  const c = parsed.data.components;
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
    if (!p) continue;
    const h = health.get(id);
    const cd = cooldown.get(id);
    units.push({
      id,
      type: unit.type,
      faction: owner.get(id)?.faction ?? null,
      x: p.x,
      y: p.y,
      hp: h?.hp ?? 1,
      maxHp: h?.max ?? 1,
      dir: facing.get(id)?.dir ?? null,
      task: task.get(id)?.kind ?? null,
      target: target.get(id)?.entity ?? null,
      moveWait: cd?.move ?? 0,
      attackWait: cd?.attack ?? 0,
      worker: worker.has(id),
      gatherer: gatherer.has(id),
      carry: gatherer.get(id)?.carry ?? 0,
      role: member.get(id)?.role ?? null,
    });
  }

  const buildings: RtsBuildingView[] = [];
  for (const [id, b] of c.Building) {
    const p = pos.get(id);
    if (!p) continue;
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

  return {
    tick: parsed.data.tick,
    terrain,
    units,
    buildings,
    resources,
    stock,
    types: c.RtsTypes[0]?.[1] ?? null,
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
