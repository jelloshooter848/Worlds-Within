import { z } from 'zod';
import type { Order } from '../core/orders';
import { defineComponent } from './component';
import { Health, Member, Owner, Position, Squad, Worker } from './components';
import { FLOW_GROUP_SIZE, STEPS_8, STRAIGHT_COST, findPath, flowField, flowStep, stepCost } from './astar';
import { Building, footprintOf, inReach } from './footprint';
import { distSq, idiv } from './math';
import type { Cell } from './path';
import { heightAt, moveCost, terrainOf, type TerrainData } from './terrain';
import { frozenCheck } from './time';
import type { Entity, System, World } from './world';

/**
 * RTS units (Engine 0.9 T7): orders as data, movement on the 8-way grid, combat and deaths
 * (see "RTS units" in this folder's CLAUDE.md; docs/BUILD-LOG.md, Engine 0.9, items 121-127).
 *
 * Orders arrive between ticks through `applyOrder(world, order)` (`rts-orders.ts`), which checks
 * them against the world and writes intent (`Task`, `Target`) under the cause `order:<id>`; this
 * file checks and writes the unit orders (`move`, `attack`, `stop`), `economy.ts` the others. The
 * systems here carry them out on later ticks: `moveSystem` (`move`, which also walks builders and
 * gatherers up to their target), `attackSystem` (`attack`), `deathSystem` (`death`), run after the
 * economy's in `RTS_SYSTEMS`. Every number they use (speed, damage, range, cooldown,
 * sight, cell costs) is component data; none is a genre rule in code. All integer, no randomness,
 * entities visited in id order.
 *
 *   const world = createWorld(seed, {
 *     components: [...STANDARD_COMPONENTS, Terrain, ...RTS_COMPONENTS],
 *     systems: RTS_SYSTEMS,
 *   });
 *   applyOrder(world, { id: 1, faction: 'red', type: 'move', units: [5], target: { x: 9, y: 2 } });
 *   world.step();
 */

const EntityId = z.int().min(1);
const Count = z.int().min(0);
const CellSchema = z.strictObject({ x: z.int(), y: z.int() });

/**
 * A unit's stats, copied in from the game's unit type data when the unit is made:
 * - `speed`: ticks to cross one cell of cost 1 in a straight line (at least 1). Entering a cell
 *   takes `speed * stepCost / STRAIGHT_COST` ticks, rounded to nearest, at least 1 (a diagonal
 *   step costs 14 against 10, a cell of cost c costs c times as much).
 * - `attack`: damage per hit (0: the unit never hurts anything).
 * - `range`: how far it hits, in whole cells of integer distance (`distFloor`, the floor of the
 *   straight-line distance; 1 reaches all eight neighbours).
 * - `cooldown`: ticks from one hit to the next (1: every tick).
 * - `sight`: how far it sees, in the same distance. Stored for the view and fog of war; no system
 *   here reads it yet (an idle unit fights back only within `range`).
 * - `type`: the unit type it was made from (an id in the world's `RtsTypes`), for the view, or
 *   null (the default); no system reads it.
 */
export const Unit = defineComponent(
  'Unit',
  z.strictObject({
    type: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -')
      .nullable()
      .default(null),
    speed: z.int().min(1),
    attack: Count,
    range: z.int().min(1),
    cooldown: z.int().min(1),
    sight: Count,
  }),
);
export type UnitData = z.infer<typeof Unit.schema>;

/**
 * Where a unit faces, for presentation: `dir` indexes `STEPS_8` (0 north, 1 north-east, 2 east,
 * ... 7 north-west). Set from each step and each hit; a unit without one has not moved or fought.
 */
export const Facing8 = defineComponent('Facing8', z.strictObject({ dir: z.int().min(0).max(7) }));
export type Facing8Data = z.infer<typeof Facing8.schema>;

/**
 * What a unit is doing, set by an order: `order` is its id. A `move` walks to `goal`; an `attack`
 * closes to range of `target` (and `Target` names it for `attackSystem`); a `build` walks up to the
 * building `target` and works on it; a `gather` walks up to `target`, a resource node or, while
 * carrying a load back, a drop-off building (`gatherSystem` switches it). `path` holds the cells
 * still to enter on an A* way (empty when not yet planned, or when the unit follows a flow field:
 * `flow`, set for a group of `FLOW_GROUP_SIZE` or more, and always for `build` and `gather`, which
 * walk by the field to the cells next to their target). The task is removed when the unit
 * arrives, its target is gone or finished, or no way leads there.
 */
export const Task = defineComponent(
  'Task',
  z
    .strictObject({
      order: EntityId,
      kind: z.enum(['move', 'attack', 'build', 'gather']),
      goal: CellSchema.nullable(),
      target: EntityId.nullable(),
      path: z.array(CellSchema),
      flow: z.boolean(),
    })
    .refine((t) => (t.kind === 'move') === (t.goal !== null) && (t.kind === 'move') === (t.target === null), {
      message: 'a move task has a goal and no target, any other task a target and no goal',
    }),
);
export type TaskData = z.infer<typeof Task.schema>;

/** The entity a unit fights now: set by an attack order, or picked by an idle unit in range. */
export const Target = defineComponent('Target', z.strictObject({ entity: EntityId }));
export type TargetData = z.infer<typeof Target.schema>;

/**
 * Ticks a unit still waits before it can step (`move`) or hit (`attack`) again. Present only while
 * one of them is above 0.
 */
export const Cooldown = defineComponent('Cooldown', z.strictObject({ move: Count, attack: Count }));
export type CooldownData = z.infer<typeof Cooldown.schema>;

/** The unit components: `Unit`, `Facing8`, `Task`, `Target`, `Cooldown`. */
export const UNIT_COMPONENTS = Object.freeze([Unit, Facing8, Task, Target, Cooldown]);

/** A fighting entity: alive, placed, with `Health` above 0. */
export function fighting(world: World, id: Entity): boolean {
  if (!world.alive(id) || !world.has(id, Position)) return false;
  const h = world.get(id, Health);
  return h !== undefined && h.hp > 0;
}

/** The faction of `id` (its `Owner`), or null. */
export function factionOf(world: World, id: Entity): string | null {
  return world.get(id, Owner)?.faction ?? null;
}

/**
 * Why the units of `order` cannot take it, or null: every one must exist, be a living `Unit` on the
 * map and belong to the order's faction.
 */
export function unitsRefusal(world: World, order: Order): string | null {
  for (const id of order.units) {
    if (!world.alive(id)) return `unit ${id} does not exist`;
    if (!world.has(id, Unit)) return `entity ${id} is not a unit (no Unit)`;
    if (!fighting(world, id)) return `unit ${id} is dead or not on the map`;
    const faction = factionOf(world, id);
    if (faction !== order.faction) {
      return `unit ${id} belongs to ${faction === null ? 'no faction' : `"${faction}"`}, not "${order.faction}"`;
    }
  }
  return null;
}

type UnitOrder = Extract<Order, { type: 'move' | 'attack' | 'stop' }>;

/**
 * Why a unit order (`move`, `attack`, `stop`) cannot be carried out in `world`, or null when it can:
 * the units (`unitsRefusal`), then a move target on the map and enterable, an attack target a
 * living entity of another faction (or of none) that is not one of the ordered units.
 */
export function unitOrderRefusal(world: World, order: UnitOrder): string | null {
  const units = unitsRefusal(world, order);
  if (units !== null) return units;
  if (order.type === 'move') {
    const { x, y } = order.target;
    const t = terrainOf(world);
    if (x < 0 || y < 0 || x >= t.width || y >= t.height) {
      return `move target (${x}, ${y}) is off the ${t.width}x${t.height} map`;
    }
    if (moveCost(t, x, y) === null) return `move target (${x}, ${y}) cannot be entered`;
  }
  if (order.type === 'attack') {
    const target = order.target;
    if (!world.alive(target)) return `attack target ${target} does not exist`;
    if (!fighting(world, target)) return `attack target ${target} has no Health left or no Position`;
    if (order.units.includes(target)) return `attack target ${target} is one of the ordered units`;
    if (factionOf(world, target) === order.faction) {
      return `attack target ${target} belongs to "${order.faction}", the order's own faction`;
    }
  }
  return null;
}

/** A worker that leaves a build for another order is no longer on that job. */
export function leaveJob(world: World, id: Entity): void {
  const worker = world.get(id, Worker);
  if (worker && worker.job !== null) world.add(id, Worker, { ...worker, job: null });
}

/**
 * Write a checked unit order (inside `withCause`): for each unit in ascending id order, its `Task`
 * (and `Target` for an attack); `move` drops `Target`, `stop` drops both. A worker leaves its job.
 */
export function writeUnitOrder(world: World, order: UnitOrder): void {
  const units = [...order.units].sort((a, b) => a - b);
  const flow = units.length >= FLOW_GROUP_SIZE;
  for (const id of units) {
    leaveJob(world, id);
    if (order.type === 'stop') {
      world.remove(id, Task);
      world.remove(id, Target);
    } else if (order.type === 'move') {
      const goal = { x: order.target.x, y: order.target.y };
      world.add(id, Task, { order: order.id, kind: 'move', goal, target: null, path: [], flow });
      world.remove(id, Target);
    } else {
      world.add(id, Task, {
        order: order.id,
        kind: 'attack',
        goal: null,
        target: order.target,
        path: [],
        flow,
      });
      world.add(id, Target, { entity: order.target });
    }
  }
}

/** Whether `target` is within `range` of `from` in integer distance (`distFloor <= range`). */
export function inRange(from: Cell, target: Cell, range: number): boolean {
  return distSq(from.x, from.y, target.x, target.y) < (range + 1) * (range + 1);
}

/** The `STEPS_8` index nearest to the direction (dx, dy), or null for (0, 0). */
export function facingOf(dx: number, dy: number): number | null {
  if (dx === 0 && dy === 0) return null;
  // Compare against the eight directions by the dot product with each step's unit vector, scaled
  // by 1000 (straight) and 707 (diagonal, about 1000 / sqrt 2) so it stays in integers; ties go to
  // the first in step order.
  let best = 0;
  let bestScore = 0;
  for (let i = 0; i < STEPS_8.length; i++) {
    const s = STEPS_8[i] as Cell;
    const score = (dx * s.x + dy * s.y) * (s.x !== 0 && s.y !== 0 ? 707 : 1000);
    if (i === 0 || score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

function setFacing(world: World, id: Entity, dir: number | null): void {
  if (dir === null || world.get(id, Facing8)?.dir === dir) return;
  world.add(id, Facing8, { dir });
}

/** Write a unit's cooldowns, dropping the component when both are 0. */
function setCooldown(world: World, id: Entity, next: CooldownData): void {
  if (next.move === 0 && next.attack === 0) world.remove(id, Cooldown);
  else world.add(id, Cooldown, next);
}

/** Ticks to enter the next cell by `step` from (x, y): see `Unit.speed`. */
function stepTicks(t: TerrainData, at: Cell, step: Cell, speed: number): number | null {
  const cost = stepCost(t, at.x, at.y, step, 8);
  if (cost === null) return null;
  return Math.max(1, idiv(speed * cost + idiv(STRAIGHT_COST, 2), STRAIGHT_COST));
}

/**
 * The next cell toward `goal` for a unit at `at`, updating the task's A* path as needed, or null
 * when there is no way (or the unit is at the goal). A planned path is kept while its next cell is
 * a legal step from here and it still ends at the goal; otherwise it is planned again.
 */
function nextCell(
  t: TerrainData,
  task: TaskData,
  at: Cell,
  goal: Cell,
): { cell: Cell | null; path: TaskData['path'] } {
  if (task.flow) return { cell: flowStep(t, flowField(t, goal, { neighbourhood: 8 }), at), path: [] };
  let path = task.path;
  const last = path[path.length - 1];
  const head = path[0];
  const usable =
    head !== undefined &&
    last !== undefined &&
    last.x === goal.x &&
    last.y === goal.y &&
    Math.abs(head.x - at.x) <= 1 &&
    Math.abs(head.y - at.y) <= 1 &&
    stepCost(t, at.x, at.y, { x: head.x - at.x, y: head.y - at.y }, 8) !== null;
  if (!usable) {
    const found = findPath(t, at, goal, { neighbourhood: 8 });
    if (!found || found.cells.length === 0) return { cell: null, path: [] };
    path = found.cells.map((c) => ({ x: c.x, y: c.y }));
  }
  return { cell: path[0] as Cell, path: path.slice(1) };
}

/**
 * `move`: every entity with `Unit` and `Position`, in id order. A unit still cooling down from its
 * last step counts down, with or without a task (so a step cut short by a stop, a finished build or
 * a dropped task never leaves a stale wait for the next order). Otherwise, with a `Task`:
 * - a `move` task at its goal is done (removed); else the unit steps toward the goal;
 * - an `attack` task whose target is gone or dead is done (task and `Target` removed); a unit
 *   within range of its target stands; else it steps toward the target's cell;
 * - a `build` or `gather` task stands while its target is gone (the economy systems, which run
 *   first, drop or switch it) or within reach (`inReach`: on or next to its footprint); else it
 *   steps by the shared 8-way flow field to the cells next to the target's `Position`;
 * - with no way there the task is dropped (a worker leaves its job).
 * A step moves the unit one cell on the 8-way grid (by its task's A* path, or the shared flow field
 * for a group), standing at the cell's elevation, sets `Facing8`, and starts the step cooldown
 * (`Unit.speed`). Units do not block each other. A member of a frozen event (`time.ts`) is skipped
 * whole: it neither counts down nor steps.
 */
export const moveSystem: System = {
  name: 'move',
  run(world) {
    const t = terrainOf(world);
    const frozen = frozenCheck(world);
    for (const id of world.query(Unit, Position)) {
      if (frozen(id)) continue;
      const cool = world.get(id, Cooldown);
      if (cool && cool.move > 0) {
        setCooldown(world, id, { ...cool, move: cool.move - 1 });
        continue;
      }
      const task = world.get(id, Task);
      if (task === undefined) continue;
      const unit = world.get(id, Unit) as UnitData;
      const pos = world.get(id, Position) as { x: number; y: number };
      let goal: Cell;
      let near = false;
      if (task.kind === 'build' || task.kind === 'gather') {
        const rect = footprintOf(world, task.target as Entity);
        if (rect === null || inReach(pos, rect)) continue;
        goal = { x: rect.x, y: rect.y };
        near = true;
      } else if (task.kind === 'move') {
        goal = task.goal as Cell;
        if (pos.x === goal.x && pos.y === goal.y) {
          world.remove(id, Task);
          continue;
        }
      } else {
        const target = task.target as Entity;
        if (!fighting(world, target)) {
          world.remove(id, Task);
          world.remove(id, Target);
          continue;
        }
        const at = world.get(target, Position) as { x: number; y: number };
        goal = { x: at.x, y: at.y };
        if (inRange(pos, goal, unit.range)) continue;
      }
      const { cell, path } = near
        ? { cell: flowStep(t, flowField(t, goal, { neighbourhood: 8, near: true }), pos), path: [] }
        : nextCell(t, task, pos, goal);
      if (cell === null) {
        world.remove(id, Task);
        if (task.kind === 'attack') world.remove(id, Target);
        leaveJob(world, id);
        continue;
      }
      const step = { x: cell.x - pos.x, y: cell.y - pos.y };
      const ticks = stepTicks(t, pos, step, unit.speed) as number;
      world.add(id, Position, { x: cell.x, y: cell.y, z: heightAt(t, cell.x, cell.y) });
      setFacing(world, id, facingOf(step.x, step.y));
      if (!task.flow && !samePath(path, task.path)) world.add(id, Task, { ...task, path });
      if (ticks > 1) setCooldown(world, id, { move: ticks - 1, attack: cool?.attack ?? 0 });
    }
  },
};

function samePath(a: readonly Cell[], b: readonly Cell[]): boolean {
  return a.length === b.length && a.every((c, i) => c.x === (b[i] as Cell).x && c.y === (b[i] as Cell).y);
}

/**
 * The nearest living entity of another faction within `range` of `from` (by squared distance; ties
 * go to the lowest id), or null. Only entities with an `Owner` count as enemies.
 */
function nearestEnemy(
  world: World,
  self: Entity,
  from: Cell,
  faction: string | null,
  range: number,
  frozen: (id: Entity) => boolean,
): Entity | null {
  let best: Entity | null = null;
  let bestDist = 0;
  for (const id of world.query(Owner, Health, Position)) {
    if (id === self || !fighting(world, id) || frozen(id)) continue;
    if ((world.get(id, Owner) as { faction: string }).faction === faction) continue;
    const at = world.get(id, Position) as Cell;
    if (!inRange(from, at, range)) continue;
    const d = distSq(from.x, from.y, at.x, at.y);
    if (best === null || d < bestDist) {
      best = id;
      bestDist = d;
    }
  }
  return best;
}

/**
 * `attack`: every living entity with `Unit` and `Position`, in id order. Its attack cooldown counts
 * down first. A unit on a `move` task does not fight. Otherwise its target is its `Target` (set by
 * an attack order) while that is a living entity on the map; a target that is gone is dropped,
 * and a unit with no task picks the nearest enemy within range (`nearestEnemy`: another faction's
 * living entity with `Owner`; ties to the lowest id). With a target within range and no cooldown
 * left it hits: `Health.hp` drops by `Unit.attack` (not below 0), it faces the target, and its
 * attack cooldown starts (`Unit.cooldown`). A hit lands at once, so a unit later in id order that
 * was brought to 0 this tick does not hit back. Frozen events (`time.ts`): a frozen unit is skipped
 * (no countdown, no hit), no unit picks a frozen one as a target, and a unit whose target is frozen
 * holds its hit (keeping the target) until it unfreezes.
 */
export const attackSystem: System = {
  name: 'attack',
  run(world) {
    const frozen = frozenCheck(world);
    for (const id of world.query(Unit, Position)) {
      if (!fighting(world, id) || frozen(id)) continue;
      let cool = world.get(id, Cooldown);
      if (cool && cool.attack > 0) {
        setCooldown(world, id, { ...cool, attack: cool.attack - 1 });
        continue;
      }
      const task = world.get(id, Task);
      if (task?.kind === 'move') continue;
      const unit = world.get(id, Unit) as UnitData;
      const pos = world.get(id, Position) as Cell;

      let target = world.get(id, Target)?.entity ?? null;
      if (target !== null && !fighting(world, target)) {
        world.remove(id, Target);
        target = null;
      }
      if (target === null && task === undefined) {
        target = nearestEnemy(world, id, pos, factionOf(world, id), unit.range, frozen);
        if (target !== null) world.add(id, Target, { entity: target });
      }
      if (target === null || frozen(target)) continue;
      const at = world.get(target, Position) as Cell;
      if (!inRange(pos, at, unit.range)) {
        if (task === undefined) world.remove(id, Target);
        continue;
      }
      const h = world.get(target, Health) as { hp: number; max: number };
      if (unit.attack > 0) world.add(target, Health, { hp: Math.max(0, h.hp - unit.attack), max: h.max });
      setFacing(world, id, facingOf(at.x - pos.x, at.y - pos.y));
      cool = world.get(id, Cooldown);
      if (unit.cooldown > 1) setCooldown(world, id, { move: cool?.move ?? 0, attack: unit.cooldown - 1 });
    }
  },
};

/**
 * `death`: every `Unit` or `Building` whose `Health.hp` is 0, in id order, is destroyed (each
 * removal and the destroy are in the log under `death`). A named squad member that dies leaves its
 * squad first: the squad's strength drops by one and it is taken off `members` (and `captain`).
 * A member of a frozen event does not die until it unfreezes.
 */
export const deathSystem: System = {
  name: 'death',
  run(world) {
    const frozen = frozenCheck(world);
    for (const id of world.query(Health)) {
      if (!world.has(id, Unit) && !world.has(id, Building)) continue;
      if (frozen(id)) continue;
      if ((world.get(id, Health) as { hp: number }).hp > 0) continue;
      const member = world.get(id, Member);
      if (member && member.squad !== null && world.alive(member.squad)) {
        const s = world.get(member.squad, Squad);
        if (s) {
          world.add(member.squad, Squad, {
            strength: s.strength - 1,
            captain: s.captain === id ? null : s.captain,
            members: s.members.filter((m) => m !== id),
          });
        }
      }
      world.destroy(id);
    }
  },
};
