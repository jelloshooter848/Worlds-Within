import { z } from 'zod';
import type { JsonObject } from '@engine/core/headless';
import type { Rng } from '@engine/core/rng';
import type { RuleSwitch } from '@engine/core/rules';
import type { OrderDraft } from './commands';
import { isFinished, type RtsUnitView, type RtsView } from './snapshot';

/**
 * The scripted enemy (Engine 0.9): a side played by a plan written as data (the `rts-enemy`
 * content kind, `schema.ts`), which only issues orders, like the player. It reads the world
 * snapshot (`RtsView`) and holds no world rules: an order it cannot carry out is refused by the
 * simulation. Same plan, seed (its `Rng`) and snapshots: the same orders, every run.
 *
 *   { "faction": "blue",
 *     "steps": [
 *       { "id": "gather", "order": { "type": "gather", "units": { "type": "worker" }, "resource": "gold" } },
 *       { "id": "train", "at": 20, "repeat": { "every": 60, "times": 4 },
 *         "order": { "type": "train", "building": "barracks", "unit": "soldier" } },
 *       { "id": "attack", "when": { "count": "units", "side": "enemy", "op": "gte", "value": 6 },
 *         "order": { "type": "attack", "units": { "type": "soldier" }, "target": "nearest-enemy" } } ] }
 *
 * A step fires on the first tick at or after `at` (default 0) on which its `when` holds (rule
 * `enemy-waits-for-trigger`) and its order can be made (it has units and a target; otherwise it
 * waits and is tried again next tick). With `repeat`, it fires again every `every` ticks after
 * that, `times` times in all (null: for ever). Steps are tried in file order each tick.
 *
 * Units are chosen by a selector: the plan's own units, optionally of one `type`, only `idle`
 * ones (no task), only `heroes`, at most `max` of them (lowest ids first). Targets:
 * - `move`: a `cell`, or `area` (a box of cells; the cell is drawn with the seeded `Rng`);
 * - `attack`: `nearest-enemy` (unit), `nearest-building` (enemy building) or `random-enemy`
 *   (any enemy unit, drawn with the `Rng`), nearest to the first chosen unit by squared distance,
 *   ties to the lowest id;
 * - `gather`: the nearest node of `resource` to the first chosen unit;
 * - `build`: `building` with its north-west cell at `cell`, by the chosen builders;
 * - `train`: one `unit` at each of the plan's finished `building`s that trains it and has fewer
 *   than `queueMax` (default 1) queued.
 */

const Id = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -');
const Cell = z.strictObject({ x: z.int(), y: z.int() });

/** Which of the plan's own units an order goes to. */
export const unitSelectorSchema = z
  .strictObject({
    type: Id.optional().describe('only units of this unit type'),
    idle: z.boolean().default(false).describe('only units with no task'),
    heroes: z.boolean().default(false).describe('only heroes (squad role `hero`)'),
    max: z.int().min(1).optional().describe('at most this many, lowest ids first'),
  })
  .describe("which of the plan's own units: all of them when every field is left out");

const units = unitSelectorSchema.default({ idle: false, heroes: false });

const planOrderSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('move'),
    units,
    cell: Cell.optional().describe('the cell to walk to'),
    area: z
      .strictObject({ x: z.int(), y: z.int(), w: z.int().min(1), h: z.int().min(1) })
      .optional()
      .describe('or a box of cells, one drawn with the seeded RNG'),
  }),
  z.strictObject({
    type: z.literal('attack'),
    units,
    target: z
      .enum(['nearest-enemy', 'nearest-building', 'random-enemy'])
      .describe('which enemy: the nearest unit, the nearest building, or a unit drawn with the RNG'),
  }),
  z.strictObject({ type: z.literal('stop'), units }),
  z.strictObject({
    type: z.literal('gather'),
    units,
    resource: Id.describe('the item whose nearest node to gather'),
  }),
  z.strictObject({
    type: z.literal('build'),
    units,
    building: Id.describe('the building type'),
    cell: Cell.describe("the new building's north-west cell"),
  }),
  z.strictObject({
    type: z.literal('train'),
    building: Id.describe('the building type that trains it'),
    unit: Id.describe('the unit type to train'),
    queueMax: z.int().min(1).default(1).describe('skip a building with this many queued already'),
  }),
]);
export type PlanOrder = z.infer<typeof planOrderSchema>;

/** A condition on the world: a count of units or buildings, or a stockpile, against a value. */
export const planConditionSchema = z.discriminatedUnion('count', [
  z.strictObject({
    count: z.enum(['units', 'buildings']),
    side: z.enum(['self', 'enemy']).describe("`self`: the plan's own; `enemy`: every other faction's"),
    type: Id.optional().describe('only this unit or building type'),
    op: z.enum(['gte', 'lte']),
    value: z.int().min(0),
  }),
  z.strictObject({
    count: z.literal('stock'),
    item: Id.describe("the item in the plan's own stockpile"),
    op: z.enum(['gte', 'lte']),
    value: z.int().min(0),
  }),
]);
export type PlanCondition = z.infer<typeof planConditionSchema>;

export const planStepSchema = z
  .strictObject({
    id: Id.describe('names the step in the enemy state'),
    at: z.int().min(0).default(0).describe('the first tick it may fire'),
    when: planConditionSchema.optional().describe('it fires only once this holds'),
    repeat: z
      .strictObject({
        every: z.int().min(1).describe('ticks between firings'),
        times: z.int().min(1).nullable().default(null).describe('firings in all (null: for ever)'),
      })
      .optional()
      .describe('fire again every `every` ticks, `times` times in all'),
    order: planOrderSchema.describe('the order to give, told apart by `type`'),
  })
  .superRefine((s, ctx) => {
    if (s.order.type === 'move' && (s.order.cell === undefined) === (s.order.area === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['order'], message: 'a move gives exactly one of cell and area' });
    }
  });
export type PlanStep = z.infer<typeof planStepSchema>;

/** A scripted enemy's plan: its faction and its steps. */
export const enemyPlanSchema = z
  .strictObject({
    faction: Id.describe('the side the plan plays'),
    steps: z.array(planStepSchema).describe('tried in this order every tick'),
  })
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    plan.steps.forEach((s, i) => {
      if (seen.has(s.id))
        ctx.addIssue({ code: 'custom', path: ['steps', i, 'id'], message: `step "${s.id}" twice` });
      seen.add(s.id);
    });
  });
export type EnemyPlan = z.infer<typeof enemyPlanSchema>;

/** One step's progress: how often it fired and the tick it last did (null: never). */
interface StepState {
  fired: number;
  last: number | null;
}

/** Squared distance between two cells. */
function distSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
}

/** The nearest of `list` to `from` (squared distance to the cell or footprint; ties to the lowest id). */
function nearest<T extends { id: number; x: number; y: number; w?: number; h?: number }>(
  from: { x: number; y: number },
  list: readonly T[],
): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const t of list) {
    const w = t.w ?? 1;
    const h = t.h ?? 1;
    const p = {
      x: Math.max(t.x, Math.min(from.x, t.x + w - 1)),
      y: Math.max(t.y, Math.min(from.y, t.y + h - 1)),
    };
    const d = distSq(from, p);
    if (d < bestD || (d === bestD && best !== null && t.id < best.id)) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

export class ScriptedEnemy {
  private readonly state: Map<string, StepState>;

  constructor(
    readonly plan: EnemyPlan,
    private readonly rng: Rng,
    private readonly rules: RuleSwitch | null = null,
  ) {
    this.state = new Map(plan.steps.map((s) => [s.id, { fired: 0, last: null }]));
  }

  private on(id: string): boolean {
    return this.rules === null || this.rules.isOn(id);
  }

  /** The orders the plan gives on `view` (its tick), in step order; changes the steps' state. */
  think(view: RtsView): OrderDraft[] {
    if (!this.on('enemy-follows-plan')) return [];
    const out: OrderDraft[] = [];
    for (const step of this.plan.steps) {
      const st = this.state.get(step.id)!;
      if (!this.due(step, st, view.tick)) continue;
      if (step.when !== undefined && this.on('enemy-waits-for-trigger') && !this.holds(step.when, view))
        continue;
      const order = this.make(step.order, view);
      if (order === null) continue;
      st.fired += 1;
      st.last = view.tick;
      out.push(order);
    }
    return out;
  }

  /** The steps' progress as JSON (for the game's snapshot, so hashes cover it). */
  snapshot(): JsonObject {
    const out: JsonObject = {};
    for (const s of this.plan.steps) {
      const st = this.state.get(s.id)!;
      out[s.id] = { fired: st.fired, last: st.last };
    }
    return out;
  }

  private due(step: PlanStep, st: StepState, tick: number): boolean {
    if (tick < step.at) return false;
    if (st.fired === 0) return true;
    if (step.repeat === undefined) return false;
    if (step.repeat.times !== null && st.fired >= step.repeat.times) return false;
    return st.last !== null && tick >= st.last + step.repeat.every;
  }

  private holds(c: PlanCondition, view: RtsView): boolean {
    const me = this.plan.faction;
    let n: number;
    if (c.count === 'stock') n = view.stock[me]?.[c.item] ?? 0;
    else {
      const mine = (f: string | null) => (c.side === 'self' ? f === me : f !== null && f !== me);
      n =
        c.count === 'units'
          ? view.units.filter((u) => mine(u.faction) && (c.type === undefined || u.type === c.type)).length
          : view.buildings.filter((b) => mine(b.faction) && (c.type === undefined || b.kind === c.type))
              .length;
    }
    return c.op === 'gte' ? n >= c.value : n <= c.value;
  }

  private pick(sel: z.infer<typeof unitSelectorSchema>, view: RtsView): RtsUnitView[] {
    const list = view.units.filter(
      (u) =>
        u.faction === this.plan.faction &&
        (sel.type === undefined || u.type === sel.type) &&
        (!sel.idle || u.task === null) &&
        (!sel.heroes || u.role === 'hero'),
    );
    return sel.max === undefined ? list : list.slice(0, sel.max);
  }

  private make(o: PlanOrder, view: RtsView): OrderDraft | null {
    const faction = this.plan.faction;
    if (o.type === 'train') {
      const at = view.buildings.filter(
        (b) =>
          b.faction === faction &&
          b.kind === o.building &&
          isFinished(b) &&
          b.producer !== null &&
          b.producer.trains.includes(o.unit) &&
          b.producer.queue.length < o.queueMax,
      );
      if (at.length === 0) return null;
      return { faction, type: 'train', units: at.map((b) => b.id), target: o.unit };
    }
    const chosen = this.pick(o.units, view);
    if (chosen.length === 0) return null;
    const ids = chosen.map((u) => u.id);
    const lead = chosen[0]!;
    switch (o.type) {
      case 'stop':
        return { faction, type: 'stop', units: ids };
      case 'move': {
        if (o.cell !== undefined) return { faction, type: 'move', units: ids, target: { ...o.cell } };
        const a = o.area!;
        return {
          faction,
          type: 'move',
          units: ids,
          target: { x: a.x + this.rng.int(a.w), y: a.y + this.rng.int(a.h) },
        };
      }
      case 'build':
        return { faction, type: 'build', units: ids, target: { ...o.cell }, building: o.building };
      case 'gather': {
        const node = nearest(
          lead,
          view.resources.filter((r) => r.item === o.resource && r.amount > 0),
        );
        return node === null ? null : { faction, type: 'gather', units: ids, target: node.id };
      }
      case 'attack': {
        const enemyUnits = view.units.filter((u) => u.faction !== null && u.faction !== faction);
        let target: number | null;
        if (o.target === 'nearest-enemy') target = nearest(lead, enemyUnits)?.id ?? null;
        else if (o.target === 'random-enemy')
          target = enemyUnits.length === 0 ? null : enemyUnits[this.rng.int(enemyUnits.length)]!.id;
        else {
          const enemyBuildings = view.buildings.filter((b) => b.faction !== null && b.faction !== faction);
          target = nearest(lead, enemyBuildings)?.id ?? null;
        }
        return target === null ? null : { faction, type: 'attack', units: ids, target };
      }
    }
  }
}
