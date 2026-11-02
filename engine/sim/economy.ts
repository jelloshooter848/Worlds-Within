import { z } from 'zod';
import type { Order } from '../core/orders';
import { rtsTypesSchema, type RtsTypes as RtsTypesData } from '../core/rts-types';
import { defineComponent } from './component';
import { Construction, Health, Inventory, Owner, Position, Worker, inventoryAdd } from './components';
import { Building, footprintOf, inReach, ringAround, rectsOverlap, type Rect } from './footprint';
import { distSq, idiv } from './math';
import type { Cell } from './path';
import { Target, Task, Unit, factionOf, fighting, leaveJob, unitsRefusal, type TaskData } from './rts';
import { addWork } from './systems';
import { heightAt, moveCost, terrainOf } from './terrain';
import type { Entity, System, World } from './world';

/**
 * The RTS economy (Engine 0.9 T8): placing and constructing buildings, training units and gathering
 * one resource, as world machinery driven by data (see "RTS economy" in this folder's CLAUDE.md;
 * docs/BUILD-LOG.md, Engine 0.9, decisions 2 and 7).
 *
 * Unit and building types (stats, costs, build and training time, what a building trains) are
 * never code: they are the world's `RtsTypes` table (the schema is `engine/core/rts-types.ts`),
 * held by one entity like `Terrain` and so saved and hashed with the world. A building or unit
 * made from a type gets the type's numbers copied into its components. A faction's resources are
 * the `Inventory` of its `Stockpile` entity; costs are paid from it when an order is accepted, and
 * an order the faction cannot afford is refused and changes nothing.
 *
 * Systems, run before the unit systems in `RTS_SYSTEMS`: `gatherSystem` (`gather`),
 * `constructSystem` (`construct`), `trainSystem` (`train`). All integer, no randomness, entities in
 * id order, all state in components.
 */

const Id = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -');
const EntityId = z.int().min(1);
const Count = z.int().min(0);

/** The world's unit and building types (one entity holds it; `rtsTypesOf`). */
export const RtsTypes = defineComponent('RtsTypes', rtsTypesSchema);

/** A faction's stockpile: the entity's `Inventory` is what the faction has to spend. One per faction. */
export const Stockpile = defineComponent('Stockpile', z.strictObject({ faction: Id }));
export type StockpileData = z.infer<typeof Stockpile.schema>;

/**
 * A resource node: gatherers take `item` from its `Inventory`, one at a time. It is destroyed when
 * gathering empties it.
 */
export const Resource = defineComponent('Resource', z.strictObject({ item: Id }));
export type ResourceData = z.infer<typeof Resource.schema>;

/**
 * A building that trains units: the unit types it can train (`trains`, from its building type), the
 * units queued (each with its training time, `ticks`, copied from its unit type when ordered; the
 * cost was paid then) and the ticks spent on the first one (`progress`).
 */
export const Producer = defineComponent(
  'Producer',
  z.strictObject({
    trains: z.array(Id),
    queue: z.array(z.strictObject({ unit: Id, ticks: z.int().min(1) })),
    progress: Count,
  }),
);
export type ProducerData = z.infer<typeof Producer.schema>;

/**
 * A unit that gathers: `capacity` items at most, one every `ticks` ticks next to a node (copied
 * from its unit type). `node` is the node it works, `item` and `carry` what it holds now, and
 * `progress` the ticks spent on the next item.
 */
export const Gatherer = defineComponent(
  'Gatherer',
  z
    .strictObject({
      capacity: z.int().min(1),
      ticks: z.int().min(1),
      node: EntityId.nullable(),
      item: Id.nullable(),
      carry: Count,
      progress: Count,
    })
    .refine((g) => g.carry <= g.capacity, { message: 'carry must not exceed capacity' })
    .refine((g) => g.carry === 0 || g.item !== null, {
      message: 'a gatherer carrying something names its item',
    }),
);
export type GathererData = z.infer<typeof Gatherer.schema>;

/** The economy components (with `Building`, from `footprint.ts`). */
export const ECONOMY_COMPONENTS = Object.freeze([
  Building,
  RtsTypes,
  Stockpile,
  Resource,
  Producer,
  Gatherer,
]);

// ---- Lookups ----

/** The world's type table (the lowest id holding `RtsTypes`), or null. */
export function rtsTypesOf(world: World): RtsTypesData | null {
  for (const id of world.query(RtsTypes)) return world.get(id, RtsTypes) as RtsTypesData;
  return null;
}

/** The stockpile entity of `faction` (the lowest id with that `Stockpile`), or null. */
export function stockpileOf(world: World, faction: string): Entity | null {
  for (const id of world.query(Stockpile)) {
    if ((world.get(id, Stockpile) as StockpileData).faction === faction) return id;
  }
  return null;
}

/** Whether a building is up: alive and with no `Construction`, or a finished one. */
export function finished(world: World, id: Entity): boolean {
  if (!world.alive(id)) return false;
  const c = world.get(id, Construction);
  return c === undefined || c.done;
}

/** What `times` of `cost` lacks in `stock`, as `needs 100 gold, has 40` (items sorted), or null. */
function shortfall(
  stock: Readonly<Record<string, number>>,
  cost: Readonly<Record<string, number>>,
  times: number,
): string | null {
  const lacks: string[] = [];
  for (const item of Object.keys(cost).sort()) {
    const need = (cost[item] as number) * times;
    const have = stock[item] ?? 0;
    if (have < need) lacks.push(`needs ${need} ${item}, has ${have}`);
  }
  return lacks.length === 0 ? null : lacks.join('; ');
}

/** Why `faction` cannot pay `times` of `cost` for `what`, or null when it can. */
function costRefusal(
  world: World,
  faction: string,
  cost: Readonly<Record<string, number>>,
  times: number,
  what: string,
): string | null {
  const stockpile = stockpileOf(world, faction);
  if (stockpile === null) return `faction "${faction}" has no stockpile`;
  const lacks = shortfall(world.get(stockpile, Inventory) ?? {}, cost, times);
  return lacks === null ? null : `faction "${faction}" cannot afford ${what}: ${lacks}`;
}

/** Take `times` of `cost` from the faction's stockpile (checked first by `costRefusal`). */
function pay(world: World, faction: string, cost: Readonly<Record<string, number>>, times: number): void {
  const stockpile = stockpileOf(world, faction) as Entity;
  for (const item of Object.keys(cost).sort())
    inventoryAdd(world, stockpile, item, -(cost[item] as number) * times);
}

/**
 * Why a building cannot stand on `rect`, or null when it can: every cell must be on the map and
 * enterable, and none may be under another building's footprint or a resource node.
 */
export function placementRefusal(world: World, rect: Rect): string | null {
  const t = terrainOf(world);
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > t.width || rect.y + rect.h > t.height) {
    return `a ${rect.w}x${rect.h} building at (${rect.x}, ${rect.y}) does not fit on the ${t.width}x${t.height} map`;
  }
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (moveCost(t, x, y) === null) return `cell (${x}, ${y}) cannot be built on (impassable)`;
    }
  }
  for (const id of world.query(Position)) {
    if (!world.has(id, Building) && !world.has(id, Resource)) continue;
    if (rectsOverlap(rect, footprintOf(world, id) as Rect)) {
      return `the footprint overlaps ${world.has(id, Building) ? 'building' : 'resource node'} ${id}`;
    }
  }
  return null;
}

/** Squared distance from `cell` to the nearest cell of `rect`. */
function rectDistSq(cell: Cell, rect: Rect): number {
  const x = Math.min(Math.max(cell.x, rect.x), rect.x + rect.w - 1);
  const y = Math.min(Math.max(cell.y, rect.y), rect.y + rect.h - 1);
  return distSq(cell.x, cell.y, x, y);
}

/** The entity among `ids` nearest to `from` (squared distance to its footprint; ties to the lowest id). */
function nearest(world: World, from: Cell, ids: Iterable<Entity>): Entity | null {
  let best: Entity | null = null;
  let bestDist = 0;
  for (const id of ids) {
    const d = rectDistSq(from, footprintOf(world, id) as Rect);
    if (best === null || d < bestDist) {
      best = id;
      bestDist = d;
    }
  }
  return best;
}

/** Whether `id` is a resource node with some of its item left. */
function isNode(world: World, id: Entity | null): id is Entity {
  if (id === null || !world.alive(id) || !world.has(id, Position)) return false;
  const r = world.get(id, Resource);
  return r !== undefined && (world.get(id, Inventory)?.[r.item] ?? 0) > 0;
}

/** Whether `id` is a finished, standing drop-off building of `faction`. */
function isDropoff(world: World, id: Entity, faction: string | null): boolean {
  return (
    world.get(id, Building)?.dropoff === true &&
    finished(world, id) &&
    fighting(world, id) &&
    factionOf(world, id) === faction
  );
}

function* nodesOf(world: World, item: string | null): Generator<Entity> {
  for (const id of world.query(Resource, Position)) {
    if (isNode(world, id) && (item === null || world.get(id, Resource)?.item === item)) yield id;
  }
}

function* dropoffsOf(world: World, faction: string | null): Generator<Entity> {
  for (const id of world.query(Building, Position)) if (isDropoff(world, id, faction)) yield id;
}

// ---- Making units and buildings from their types ----

function typesOrThrow(world: World): RtsTypesData {
  const types = rtsTypesOf(world);
  if (!types) throw new Error('the world has no RtsTypes table');
  return types;
}

/**
 * Spawn a unit of `type` (an id in the world's `RtsTypes`) for `faction` (null: no `Owner`) on
 * `cell`, with the type's numbers copied in: `Position`, `Owner`, `Health` (full), `Unit`, and
 * `Worker` (if the type has `work`) and `Gatherer` (if it has `gather`). Throws for an unknown type.
 */
export function spawnUnit(world: World, faction: string | null, type: string, cell: Cell): Entity {
  const t = typesOrThrow(world).units[type];
  if (!t) throw new Error(`unit type "${type}" is not in the world's RtsTypes`);
  const id = world.spawn();
  world.add(id, Position, { x: cell.x, y: cell.y, z: heightAt(terrainOf(world), cell.x, cell.y) });
  if (faction !== null) world.add(id, Owner, { faction });
  world.add(id, Health, { hp: t.health, max: t.health });
  world.add(id, Unit, {
    type,
    speed: t.speed,
    attack: t.attack,
    range: t.range,
    cooldown: t.cooldown,
    sight: t.sight,
  });
  if (t.work !== null) world.add(id, Worker, { job: null, rate: t.work });
  if (t.gather !== null) {
    world.add(id, Gatherer, {
      capacity: t.gather.capacity,
      ticks: t.gather.ticks,
      node: null,
      item: null,
      carry: 0,
      progress: 0,
    });
  }
  return id;
}

/**
 * Place a building of `kind` (an id in the world's `RtsTypes`) for `faction` with its north-west
 * cell at `at`, with the type's numbers copied in: `Position`, `Owner`, `Building`, `Health`, and
 * `Producer` when the type trains anything. Unless `built`, it is a site: `Construction` at 0 of
 * the type's `work` and `Health.hp` 1. Placement and cost are not checked here (`build` orders
 * check both); throws for an unknown kind.
 */
export function placeBuilding(
  world: World,
  faction: string | null,
  kind: string,
  at: Cell,
  built = false,
): Entity {
  const b = typesOrThrow(world).buildings[kind];
  if (!b) throw new Error(`building type "${kind}" is not in the world's RtsTypes`);
  const id = world.spawn();
  world.add(id, Position, { x: at.x, y: at.y, z: heightAt(terrainOf(world), at.x, at.y) });
  if (faction !== null) world.add(id, Owner, { faction });
  world.add(id, Building, { kind, w: b.size.w, h: b.size.h, dropoff: b.dropoff });
  if (!built) world.add(id, Construction, { kind, progress: 0, work: b.work, done: false });
  world.add(id, Health, { hp: built ? b.health : 1, max: b.health });
  if (b.trains.length > 0) world.add(id, Producer, { trains: [...b.trains], queue: [], progress: 0 });
  return id;
}

// ---- Orders ----

export type EconomyOrder = Extract<Order, { type: 'build' | 'train' | 'gather' }>;

/** Why an economy order cannot be carried out in `world`, or null when it can. */
export function economyOrderRefusal(world: World, order: EconomyOrder): string | null {
  if (order.type === 'build') {
    const units = unitsRefusal(world, order);
    if (units !== null) return units;
    for (const id of order.units) if (!world.has(id, Worker)) return `unit ${id} cannot build (no Worker)`;
    const types = rtsTypesOf(world);
    if (!types) return 'the world has no RtsTypes table';
    const b = types.buildings[order.building];
    if (!b) return `building type "${order.building}" is not in the world's RtsTypes`;
    const placement = placementRefusal(world, { ...order.target, w: b.size.w, h: b.size.h });
    if (placement !== null) return placement;
    return costRefusal(world, order.faction, b.cost, 1, order.building);
  }
  if (order.type === 'train') {
    const types = rtsTypesOf(world);
    if (!types) return 'the world has no RtsTypes table';
    const u = types.units[order.target];
    if (!u) return `unit type "${order.target}" is not in the world's RtsTypes`;
    for (const id of order.units) {
      if (!world.alive(id)) return `building ${id} does not exist`;
      const p = world.get(id, Producer);
      if (!p) return `entity ${id} cannot train (no Producer)`;
      const faction = factionOf(world, id);
      if (faction !== order.faction) {
        return `building ${id} belongs to ${faction === null ? 'no faction' : `"${faction}"`}, not "${order.faction}"`;
      }
      if (!finished(world, id) || !fighting(world, id))
        return `building ${id} is not finished or not standing`;
      if (!p.trains.includes(order.target)) return `building ${id} cannot train "${order.target}"`;
    }
    const what = order.units.length === 1 ? order.target : `${order.units.length} ${order.target}`;
    return costRefusal(world, order.faction, u.cost, order.units.length, what);
  }
  const units = unitsRefusal(world, order);
  if (units !== null) return units;
  for (const id of order.units) if (!world.has(id, Gatherer)) return `unit ${id} cannot gather (no Gatherer)`;
  if (
    !world.alive(order.target) ||
    !world.has(order.target, Resource) ||
    !world.has(order.target, Position)
  ) {
    return `gather target ${order.target} is not a resource node`;
  }
  if (stockpileOf(world, order.faction) === null) return `faction "${order.faction}" has no stockpile`;
  return null;
}

/**
 * Write a checked economy order (inside `withCause`). `build`: pay the cost, place the site
 * (`placeBuilding`) and set each worker's `Worker.job` and a `build` task on it. `train`: pay the
 * cost once per building and queue the unit at each. `gather`: each unit's `Gatherer.node` and a
 * `gather` task on the node (a load of another item is dropped). Units in ascending id order; any
 * `Target` is dropped.
 */
export function writeEconomyOrder(world: World, order: EconomyOrder): void {
  const ids = [...order.units].sort((a, b) => a - b);
  if (order.type === 'train') {
    const types = rtsTypesOf(world) as RtsTypesData;
    const u = types.units[order.target] as RtsTypesData['units'][string];
    pay(world, order.faction, u.cost, ids.length);
    for (const id of ids) {
      world.update(id, Producer, (p) => ({
        ...p,
        queue: [...p.queue, { unit: order.target, ticks: u.trainTicks }],
      }));
    }
    return;
  }
  let target: Entity;
  if (order.type === 'build') {
    const b = (rtsTypesOf(world) as RtsTypesData).buildings[
      order.building
    ] as RtsTypesData['buildings'][string];
    pay(world, order.faction, b.cost, 1);
    target = placeBuilding(world, order.faction, order.building, order.target);
  } else {
    target = order.target;
  }
  const item = order.type === 'gather' ? (world.get(target, Resource) as ResourceData).item : null;
  for (const id of ids) {
    world.remove(id, Target);
    if (order.type === 'build') {
      world.update(id, Worker, (w) => ({ ...w, job: target }));
    } else {
      leaveJob(world, id);
      const g = world.get(id, Gatherer) as GathererData;
      const keep = g.item === item;
      world.add(id, Gatherer, { ...g, node: target, item, carry: keep ? g.carry : 0, progress: 0 });
    }
    world.add(id, Task, { order: order.id, kind: order.type, goal: null, target, path: [], flow: true });
  }
}

// ---- Systems ----

function retarget(world: World, id: Entity, task: TaskData, target: Entity): void {
  if (task.target !== target) world.add(id, Task, { ...task, target, path: [] });
}

/**
 * `gather`: every entity with `Gatherer`, `Task` and `Position` on a `gather` task, in id order.
 * While its task targets its node it gathers: next to the node, one item every `ticks` ticks from
 * the node's `Inventory` (a node emptied is destroyed); full, or with its node empty and a load,
 * it turns to the nearest finished drop-off building of its faction (none: it waits). A node gone
 * or empty is replaced by the nearest node of the same item, or with nothing to carry the task
 * ends. Next to a drop-off it adds its load to its faction's stockpile and turns back to its node
 * (or the nearest other one; none: the task ends). Nearest is by squared distance to the
 * footprint, ties to the lowest id.
 */
export const gatherSystem: System = {
  name: 'gather',
  run(world) {
    for (const id of world.query(Gatherer, Task, Position)) {
      const task = world.get(id, Task) as TaskData;
      if (task.kind !== 'gather') continue;
      const g = world.get(id, Gatherer) as GathererData;
      const pos = world.get(id, Position) as Cell;
      const faction = factionOf(world, id);
      const toDropoff = (): void => {
        const d = nearest(world, pos, dropoffsOf(world, faction));
        if (d !== null) retarget(world, id, task, d);
      };

      if (task.target === g.node) {
        if (!isNode(world, g.node)) {
          const next = nearest(world, pos, nodesOf(world, g.item));
          if (next !== null) {
            world.add(id, Gatherer, { ...g, node: next, progress: 0 });
            retarget(world, id, task, next);
          } else if (g.carry > 0) toDropoff();
          else world.remove(id, Task);
          continue;
        }
        if (g.carry >= g.capacity) {
          toDropoff();
          continue;
        }
        const node = g.node;
        if (!inReach(pos, footprintOf(world, node) as Rect)) continue;
        if (g.progress + 1 < g.ticks) {
          world.add(id, Gatherer, { ...g, progress: g.progress + 1 });
          continue;
        }
        const item = (world.get(node, Resource) as ResourceData).item;
        const left = inventoryAdd(world, node, item, -1)[item] ?? 0;
        world.add(id, Gatherer, { ...g, item, carry: g.carry + 1, progress: 0 });
        if (left === 0) world.destroy(node);
        if (left === 0 || g.carry + 1 >= g.capacity) toDropoff();
        continue;
      }

      // Carrying a load back.
      let dropoff: Entity | null = task.target as Entity;
      if (!isDropoff(world, dropoff, faction)) {
        dropoff = nearest(world, pos, dropoffsOf(world, faction));
        if (dropoff === null) continue;
        retarget(world, id, task, dropoff);
      }
      if (!inReach(pos, footprintOf(world, dropoff) as Rect)) continue;
      const stockpile = faction === null ? null : stockpileOf(world, faction);
      if (stockpile === null) continue;
      if (g.carry > 0) inventoryAdd(world, stockpile, g.item as string, g.carry);
      const node = isNode(world, g.node) ? g.node : nearest(world, pos, nodesOf(world, g.item));
      world.add(id, Gatherer, { ...g, node, carry: 0, progress: 0 });
      const now = world.get(id, Task) as TaskData;
      if (node === null) world.remove(id, Task);
      else retarget(world, id, now, node);
    }
  },
};

/**
 * `construct`: every entity with `Task`, `Worker` and `Position` on a `build` task, in id order. A
 * task whose building is gone, dead or finished ends (the worker leaves its job). Next to the
 * building (`inReach`) the worker adds `Worker.rate` work (`addWork`, as the village's haulers do),
 * and the building's `Health.hp` rises by what the work adds to `max * progress / work` (rounded
 * down; never above `max`), so damage taken while it goes up stays. The worker that finishes it
 * ends its task at once.
 */
export const constructSystem: System = {
  name: 'construct',
  run(world) {
    for (const id of world.query(Task, Worker, Position)) {
      const task = world.get(id, Task) as TaskData;
      if (task.kind !== 'build') continue;
      const site = task.target as Entity;
      const c = world.get(site, Construction);
      if (!fighting(world, site) || c === undefined || c.done) {
        world.remove(id, Task);
        leaveJob(world, id);
        continue;
      }
      if (!inReach(world.get(id, Position) as Cell, footprintOf(world, site) as Rect)) continue;
      const { before, after } = addWork(world, site, (world.get(id, Worker) as { rate: number }).rate);
      const h = world.get(site, Health) as { hp: number; max: number };
      const gain = idiv(h.max * after, c.work) - idiv(h.max * before, c.work);
      if (gain > 0) world.add(site, Health, { hp: Math.min(h.max, h.hp + gain), max: h.max });
      if (after === c.work) {
        world.remove(id, Task);
        leaveJob(world, id);
      }
    }
  },
};

/**
 * `train`: every finished, standing building with `Producer` and `Position`, in id order, spends a
 * tick on the first unit of its queue. When the unit's `ticks` are spent it appears
 * (`spawnUnit`, for the building's faction) on the first enterable cell around the footprint
 * (`ringAround`: south side first) and leaves the queue; with no such cell it waits there, done.
 */
export const trainSystem: System = {
  name: 'train',
  run(world) {
    const t = terrainOf(world);
    for (const id of world.query(Producer, Position)) {
      if (!finished(world, id) || !fighting(world, id)) continue;
      const p = world.get(id, Producer) as ProducerData;
      const head = p.queue[0];
      if (head === undefined) continue;
      if (p.progress + 1 < head.ticks) {
        world.add(id, Producer, { ...p, progress: p.progress + 1 });
        continue;
      }
      const cell = ringAround(footprintOf(world, id) as Rect).find((c) => moveCost(t, c.x, c.y) !== null);
      if (cell === undefined) {
        if (p.progress !== head.ticks) world.add(id, Producer, { ...p, progress: head.ticks });
        continue;
      }
      spawnUnit(world, factionOf(world, id), head.unit, cell);
      world.add(id, Producer, { ...p, queue: p.queue.slice(1), progress: 0 });
    }
  },
};
