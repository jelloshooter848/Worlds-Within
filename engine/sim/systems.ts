import { z } from 'zod';
import { defineComponent } from './component';
import { Construction, Health, Inventory, Patrol, Position, Worker, inventoryAdd } from './components';
import { idiv, imod, manhattan } from './math';
import { distanceField, nextStep, type Cell } from './path';
import { heightAt, moveCost, terrainOf, type TerrainData } from './terrain';
import type { Entity, System, World } from './world';

/**
 * The world's first systems (Engine 0.8): walking on the terrain, hauling materials to buildings
 * that are going up, keeping a building's health in step with its construction, and walking a
 * patrol. They are machinery, not game rules: every number they use (capacity, work rate, rest
 * odds, waypoints, costs) is component data from the scenario. All integer, all randomness through
 * `world.rng`, all state in components (see "Systems" in this folder's CLAUDE.md).
 *
 *   createWorld(seed, { components: [...STANDARD_COMPONENTS, Terrain, ...SYSTEM_COMPONENTS],
 *                       systems: [haulSystem, buildSystem, patrolSystem] });
 */

const Id = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -');
const Count = z.int().min(0);

/**
 * Something that walks on the terrain. `wait` is the ticks it still spends in the cell it entered
 * before it can step again: entering a cell of cost c takes c ticks (the step, then c - 1 waits).
 */
export const Walk = defineComponent('Walk', z.strictObject({ wait: Count }));
export type WalkData = z.infer<typeof Walk.schema>;

/**
 * A worker that fetches `item` from `source` (an entity with an `Inventory`), `capacity` at a time,
 * and carries it to its job (`Worker.job`, a `Construction`): each item delivered adds
 * `Worker.rate` work. `carry` is what it holds now. Each tick it works, it rests with odds one in
 * `restOdds` (0: never) for 1 to `restTicks` ticks, drawn from the world RNG; `rest` is the ticks
 * of rest left.
 */
export const Hauler = defineComponent(
  'Hauler',
  z.strictObject({
    item: Id,
    source: z.int().min(1),
    capacity: z.int().min(1),
    carry: Count,
    rest: Count,
    restOdds: Count,
    restTicks: z.int().min(1),
  }),
);
export type HaulerData = z.infer<typeof Hauler.schema>;

/** The components the systems here use beyond the standard ones and `Terrain`. */
export const SYSTEM_COMPONENTS = Object.freeze([Walk, Hauler]);

/**
 * Take one tick of walking toward the goal of `field` (from `distanceField`). Returns true when the
 * entity is already at the goal (it does not move then). Otherwise it waits out its `Walk.wait`, or
 * steps into the next cell of the cheapest way (standing at that cell's elevation) and starts
 * waiting out the cell's cost; with no way there it stays put. An entity without `Walk` steps every
 * tick whatever the cost.
 */
export function walkToward(world: World, id: Entity, t: TerrainData, field: Int32Array): boolean {
  const pos = world.get(id, Position);
  if (!pos) throw new Error(`entity ${id} has no Position to walk from`);
  if (moveCost(t, pos.x, pos.y) !== null && field[pos.y * t.width + pos.x] === 0) return true;
  const walk = world.get(id, Walk);
  if (walk && walk.wait > 0) {
    world.add(id, Walk, { wait: walk.wait - 1 });
    return false;
  }
  const step = nextStep(t, field, pos);
  if (!step) return false;
  world.add(id, Position, { x: step.x, y: step.y, z: heightAt(t, step.x, step.y) });
  if (walk) world.add(id, Walk, { wait: (moveCost(t, step.x, step.y) as number) - 1 });
  return false;
}

function cellOf(world: World, id: Entity): Cell | null {
  const pos = world.get(id, Position);
  return pos ? { x: pos.x, y: pos.y } : null;
}

/** Whether `id` is a building still going up (alive, placed, `Construction` not done). */
function unfinished(world: World, id: Entity | null): id is Entity {
  if (id === null || !world.alive(id) || !world.has(id, Position)) return false;
  const c = world.get(id, Construction);
  return c !== undefined && !c.done;
}

/** The unfinished building nearest to `from` (Manhattan distance; ties go to the lowest id), or null. */
function nearestSite(world: World, from: Cell): Entity | null {
  let best: Entity | null = null;
  let bestDist = 0;
  for (const id of world.query(Construction, Position)) {
    if (!unfinished(world, id)) continue;
    const at = cellOf(world, id) as Cell;
    const d = manhattan(from.x, from.y, at.x, at.y);
    if (best === null || d < bestDist) {
      best = id;
      bestDist = d;
    }
  }
  return best;
}

/**
 * `haul`: every entity with `Worker`, `Hauler` and `Position`, in id order. A worker whose job is
 * missing or finished takes the nearest unfinished building (none: it idles). Then, unless it is
 * resting or starts a rest (an RNG draw), it walks to its source and takes up to `capacity` items,
 * or, carrying, walks next to its job and delivers them as `carry * rate` work (capped at what the
 * building still needs). Arriving and acting take the same tick.
 */
export const haulSystem: System = {
  name: 'haul',
  run(world) {
    const t = terrainOf(world);
    for (const id of world.query(Worker, Hauler, Position)) {
      const worker = world.get(id, Worker) as { job: Entity | null; rate: number };
      let job = worker.job;
      if (!unfinished(world, job)) {
        job = nearestSite(world, cellOf(world, id) as Cell);
        if (job !== worker.job) world.add(id, Worker, { ...worker, job });
      }
      if (job === null) continue;

      const h = world.get(id, Hauler) as HaulerData;
      if (h.rest > 0) {
        world.add(id, Hauler, { ...h, rest: h.rest - 1 });
        continue;
      }
      if (h.restOdds > 0 && world.rng.int(h.restOdds) === 0) {
        world.add(id, Hauler, { ...h, rest: 1 + world.rng.int(h.restTicks) });
        continue;
      }

      if (h.carry === 0) {
        const source = world.alive(h.source) ? cellOf(world, h.source) : null;
        if (!source) continue;
        if (!walkToward(world, id, t, distanceField(t, source, true))) continue;
        const stock = world.get(h.source, Inventory)?.[h.item] ?? 0;
        const take = Math.min(h.capacity, stock);
        if (take === 0) continue;
        inventoryAdd(world, h.source, h.item, -take);
        world.add(id, Hauler, { ...h, carry: take });
        continue;
      }

      const site = cellOf(world, job) as Cell;
      if (!walkToward(world, id, t, distanceField(t, site, true))) continue;
      const c = world.get(job, Construction) as { kind: string; progress: number; work: number };
      const progress = Math.min(c.work, c.progress + h.carry * worker.rate);
      world.add(job, Construction, { kind: c.kind, progress, work: c.work, done: progress === c.work });
      world.add(id, Hauler, { ...h, carry: 0 });
    }
  },
};

/**
 * `build`: every building with `Construction` and `Health`, in id order, has its health follow its
 * progress: `max * progress / work` (rounded down, at least 1) while it goes up, `max` once done.
 * Only a changed value is written.
 */
export const buildSystem: System = {
  name: 'build',
  run(world) {
    for (const id of world.query(Construction, Health)) {
      const c = world.get(id, Construction) as { progress: number; work: number; done: boolean };
      const h = world.get(id, Health) as { hp: number; max: number };
      const hp = c.done ? h.max : Math.max(1, idiv(h.max * c.progress, c.work));
      if (hp !== h.hp) world.add(id, Health, { hp, max: h.max });
    }
  },
};

/**
 * `patrol`: every entity with `Patrol` and `Position`, in id order, walks to its current waypoint
 * (standing on it; the waypoint's `z` is not checked). On arriving it turns to the next waypoint,
 * looping, and walks toward it from the next tick.
 */
export const patrolSystem: System = {
  name: 'patrol',
  run(world) {
    const t = terrainOf(world);
    for (const id of world.query(Patrol, Position)) {
      const p = world.get(id, Patrol) as { waypoints: Cell[]; index: number };
      const goal = p.waypoints[p.index] as Cell;
      if (!walkToward(world, id, t, distanceField(t, { x: goal.x, y: goal.y }, false))) continue;
      world.update(id, Patrol, (cur) => ({ ...cur, index: imod(cur.index + 1, cur.waypoints.length) }));
    }
  },
};
