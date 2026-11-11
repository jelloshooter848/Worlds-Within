import { z } from 'zod';
import type { JsonObject } from '@engine/core/headless';
import type { Rng } from '@engine/core/rng';
import type { RuleSwitch } from '@engine/core/rules';
import type { OrderDraft } from './commands';
import type { RtsVisibility } from './fog';
import { RtsKnowledge } from './knowledge';
import { isFinished, type RtsBuildingView, type RtsUnitView, type RtsView } from './snapshot';

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
 * ones (no task), only `heroes`, at most `max` of them (lowest ids first). A unit whose event is
 * frozen (the view's `frozen` flag: an open mission holds it) is never chosen, and a frozen
 * building never trains (Engine 0.15 T9, gap M20), so a plan gives no orders the world would only
 * hold still while a mission is open. Targets:
 * - `move`: a `cell`, or `area` (a box of cells; the cell is drawn with the seeded `Rng`);
 * - `attack`: `nearest-enemy` (unit), `nearest-building` (enemy building) or `random-enemy`
 *   (any enemy unit, drawn with the `Rng`), nearest to the first chosen unit by squared distance,
 *   ties to the lowest id;
 * - `gather`: the nearest node of `resource` to the first chosen unit;
 * - `build`: `building` with its north-west cell at `cell`, by the chosen builders;
 * - `train`: one `unit` at each of the plan's finished `building`s that trains it and has fewer
 *   than `queueMax` (default 1) queued.
 *
 * **A skirmish opponent** (Engine 0.16 part D, D6), all optional so an older plan gives the same
 * orders and the same kit snapshot:
 * - `knowledge`: `all` (the default: the plan reads the whole view) or `fog`: its targets and its
 *   conditions about the enemy side see only the other units on cells its side sees now and the
 *   other buildings it sees now or remembers (`RtsKnowledge`, `knowledge.ts`; rule
 *   `enemy-knows-only-what-it-saw`, off: a fog plan reads the whole view). A building it only
 *   remembers is not attacked by id (it may be gone): the units are moved to its nearest footprint
 *   cell instead, where they see what is there. The memory is in the kit snapshot (`seen`) only
 *   for a plan that keeps one (`fog`, or a `scout` step), so older runs' hashes stay.
 * - `scout`: the chosen units walk to the nearest unexplored passable cell (to the first chosen
 *   unit, squared distance, ties to the lowest row then column), in the first of the listed
 *   `areas` that still has one, or anywhere on the map without `areas`; none left: it waits.
 * - `attack` targets `enemy-base` (the nearest known enemy drop-off building, its town centre,
 *   else the nearest known enemy building) and `last-seen-building` (the known enemy building
 *   seen most recently, then the nearest).
 * - A selector's `min`: the order is made only once at least that many units match (a wave goes
 *   when `min` soldiers are idle).
 * - `build` with `cells`: at the first listed cell where the footprint (the world's types) is on
 *   the map, passable, and clear of every building it knows of and every resource node.
 * - `train` with `upTo`: only while the plan's units of that type plus those queued are fewer than
 *   `upTo`, and at no more buildings than are missing.
 * - Workers are kept on gold with a repeating `gather` step for idle workers (`idle: true`).
 * None of these draws from the RNG.
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
    min: z
      .int()
      .min(1)
      .optional()
      .describe('the order waits until at least this many units match (a wave once N are idle)'),
  })
  .describe("which of the plan's own units: all of them when every field is left out");

const units = unitSelectorSchema.default({ idle: false, heroes: false });
const Box = z.strictObject({ x: z.int(), y: z.int(), w: z.int().min(1), h: z.int().min(1) });

const planOrderSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('move'),
    units,
    cell: Cell.optional().describe('the cell to walk to'),
    area: Box.optional().describe('or a box of cells, one drawn with the seeded RNG'),
  }),
  z.strictObject({
    type: z.literal('attack'),
    units,
    target: z
      .enum(['nearest-enemy', 'nearest-building', 'random-enemy', 'enemy-base', 'last-seen-building'])
      .describe(
        'which enemy: the nearest unit, the nearest building, a unit drawn with the RNG, the nearest drop-off building (its base), or the building seen most recently',
      ),
  }),
  z.strictObject({
    type: z.literal('scout'),
    units,
    areas: z
      .array(Box)
      .min(1)
      .optional()
      .describe('boxes of cells to scout, in order (left out: the whole map)'),
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
    cell: Cell.optional().describe("the new building's north-west cell"),
    cells: z
      .array(Cell)
      .min(1)
      .optional()
      .describe('or north-west cells to try in order: the first where it fits is used'),
  }),
  z.strictObject({
    type: z.literal('train'),
    building: Id.describe('the building type that trains it'),
    unit: Id.describe('the unit type to train'),
    queueMax: z.int().min(1).default(1).describe('skip a building with this many queued already'),
    upTo: z
      .int()
      .min(1)
      .optional()
      .describe("only while the plan's units of this type plus those queued are fewer than this"),
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
    if (s.order.type === 'build' && (s.order.cell === undefined) === (s.order.cells === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['order'],
        message: 'a build gives exactly one of cell and cells',
      });
    }
  });
export type PlanStep = z.infer<typeof planStepSchema>;

/** A scripted enemy's plan: its faction and its steps. */
export const enemyPlanSchema = z
  .strictObject({
    faction: Id.describe('the side the plan plays'),
    knowledge: z
      .enum(['all', 'fog'])
      .default('all')
      .describe(
        'what the plan knows of the other sides: `all` the whole world, `fog` only what its side sees and the buildings it remembers',
      ),
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

/**
 * Whether condition `c` holds on `view` for `faction` (`self` is `faction`, `enemy` every other
 * faction): the plan's `when` and a game's end rule (`end.ts`). Pure.
 */
export function conditionHolds(view: RtsView, faction: string, c: PlanCondition): boolean {
  let n: number;
  if (c.count === 'stock') n = view.stock[faction]?.[c.item] ?? 0;
  else {
    const mine = (f: string | null) => (c.side === 'self' ? f === faction : f !== null && f !== faction);
    n =
      c.count === 'units'
        ? view.units.filter((u) => mine(u.faction) && (c.type === undefined || u.type === c.type)).length
        : view.buildings.filter((b) => mine(b.faction) && (c.type === undefined || b.kind === c.type)).length;
  }
  return c.op === 'gte' ? n >= c.value : n <= c.value;
}

/** What the plan reads on one tick: the world, what it knows of it, and what its side sees. */
interface Reading {
  view: RtsView;
  known: RtsView;
  /** What its side sees now when it keeps a memory, else null. */
  vis: RtsVisibility | null;
  /** True when its targets read only what it knows (`knowledge: "fog"` and the rule on). */
  fogged: boolean;
}

export class ScriptedEnemy {
  private readonly state: Map<string, StepState>;
  private readonly memory: RtsKnowledge | null;

  constructor(
    readonly plan: EnemyPlan,
    private readonly rng: Rng,
    private readonly rules: RuleSwitch | null = null,
  ) {
    this.state = new Map(plan.steps.map((s) => [s.id, { fired: 0, last: null }]));
    const keeps = plan.knowledge === 'fog' || plan.steps.some((s) => s.order.type === 'scout');
    this.memory = keeps ? new RtsKnowledge(plan.faction) : null;
  }

  private on(id: string): boolean {
    return this.rules === null || this.rules.isOn(id);
  }

  /** The orders the plan gives on `view` (its tick), in step order; changes the steps' state. */
  think(view: RtsView): OrderDraft[] {
    if (!this.on('enemy-follows-plan')) return [];
    const vis = this.memory?.update(view) ?? null;
    const fogged =
      this.memory !== null && this.plan.knowledge === 'fog' && this.on('enemy-knows-only-what-it-saw');
    const r: Reading = { view, known: fogged ? this.memory!.known(view, vis!) : view, vis, fogged };
    const out: OrderDraft[] = [];
    for (const step of this.plan.steps) {
      const st = this.state.get(step.id)!;
      if (!this.due(step, st, view.tick)) continue;
      if (
        step.when !== undefined &&
        this.on('enemy-waits-for-trigger') &&
        !conditionHolds(r.known, this.plan.faction, step.when)
      )
        continue;
      const order = this.make(step.order, r);
      if (order === null) continue;
      st.fired += 1;
      st.last = view.tick;
      out.push(order);
    }
    return out;
  }

  /** What the plan knows (null for a plan that keeps no memory: `knowledge: "all"` and no `scout`). */
  knowledge(): RtsKnowledge | null {
    return this.memory;
  }

  /** The memory as JSON for the kit's snapshot (`seen`), or null when the plan keeps none. */
  memorySnapshot(): JsonObject | null {
    return this.memory?.snapshot() ?? null;
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

  private pick(sel: z.infer<typeof unitSelectorSchema>, view: RtsView): RtsUnitView[] {
    const list = view.units.filter(
      (u) =>
        u.faction === this.plan.faction &&
        !u.frozen &&
        (sel.type === undefined || u.type === sel.type) &&
        (!sel.idle || u.task === null) &&
        (!sel.heroes || u.role === 'hero'),
    );
    if (sel.min !== undefined && list.length < sel.min) return [];
    return sel.max === undefined ? list : list.slice(0, sel.max);
  }

  private make(o: PlanOrder, r: Reading): OrderDraft | null {
    const { view } = r;
    const faction = this.plan.faction;
    if (o.type === 'train') {
      let at = view.buildings.filter(
        (b) =>
          b.faction === faction &&
          !b.frozen &&
          b.kind === o.building &&
          isFinished(b) &&
          b.producer !== null &&
          b.producer.trains.includes(o.unit) &&
          b.producer.queue.length < o.queueMax,
      );
      if (o.upTo !== undefined) {
        const missing = o.upTo - this.ownCount(view, o.unit);
        at = missing > 0 ? at.slice(0, missing) : [];
      }
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
      case 'scout': {
        const cell = this.unexplored(view, lead, o.areas);
        return cell === null ? null : { faction, type: 'move', units: ids, target: cell };
      }
      case 'build': {
        const cell = o.cell ?? this.freeCell(r, o.building, o.cells!);
        if (cell === null) return null;
        return { faction, type: 'build', units: ids, target: { ...cell }, building: o.building };
      }
      case 'gather': {
        const node = nearest(
          lead,
          view.resources.filter((n) => n.item === o.resource && n.amount > 0),
        );
        return node === null ? null : { faction, type: 'gather', units: ids, target: node.id };
      }
      case 'attack': {
        const known = r.known;
        const enemyUnits = known.units.filter((u) => u.faction !== null && u.faction !== faction);
        const enemyBuildings = known.buildings.filter((b) => b.faction !== null && b.faction !== faction);
        if (o.target === 'nearest-enemy') {
          const target = nearest(lead, enemyUnits)?.id ?? null;
          return target === null ? null : { faction, type: 'attack', units: ids, target };
        }
        if (o.target === 'random-enemy') {
          if (enemyUnits.length === 0) return null;
          return {
            faction,
            type: 'attack',
            units: ids,
            target: enemyUnits[this.rng.int(enemyUnits.length)]!.id,
          };
        }
        let building: RtsBuildingView | null;
        if (o.target === 'nearest-building') building = nearest(lead, enemyBuildings);
        else if (o.target === 'enemy-base') {
          const bases = enemyBuildings.filter((b) => b.dropoff);
          building = nearest(lead, bases.length > 0 ? bases : enemyBuildings);
        } else {
          const latest = Math.max(...enemyBuildings.map((b) => this.seenAt(r, b)));
          building = nearest(
            lead,
            enemyBuildings.filter((b) => this.seenAt(r, b) === latest),
          );
        }
        if (building === null) return null;
        // A building it only remembers may be gone: walk there and look (see the file comment).
        if (r.fogged && this.memory!.outOfSight(building.id, r.vis!)) {
          return { faction, type: 'move', units: ids, target: nearestCell(lead, building) };
        }
        return { faction, type: 'attack', units: ids, target: building.id };
      }
    }
  }

  /** The plan's units of `type` plus those queued at its buildings. */
  private ownCount(view: RtsView, type: string): number {
    let n = view.units.filter((u) => u.faction === this.plan.faction && u.type === type).length;
    for (const b of view.buildings)
      if (b.faction === this.plan.faction && b.producer !== null)
        n += b.producer.queue.filter((q) => q.unit === type).length;
    return n;
  }

  /** The tick another side's building was last seen at: now unless it is only remembered. */
  private seenAt(r: Reading, b: RtsBuildingView): number {
    if (!r.fogged || !this.memory!.outOfSight(b.id, r.vis!)) return r.view.tick;
    return this.memory!.lastSeen(b.id) ?? r.view.tick;
  }

  /** The nearest unexplored passable cell to `from` in the first area that has one (see the file comment). */
  private unexplored(
    view: RtsView,
    from: { x: number; y: number },
    areas: readonly { x: number; y: number; w: number; h: number }[] | undefined,
  ): { x: number; y: number } | null {
    const t = view.terrain;
    if (t === null || this.memory === null) return null;
    const boxes = areas ?? [{ x: 0, y: 0, w: t.width, h: t.height }];
    for (const a of boxes) {
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (let y = Math.max(0, a.y); y < Math.min(t.height, a.y + a.h); y++) {
        for (let x = Math.max(0, a.x); x < Math.min(t.width, a.x + a.w); x++) {
          if (this.memory.isExplored(x, y) || !passableAt(view, x, y)) continue;
          const d = distSq(from, { x, y });
          if (d < bestD) {
            best = { x, y };
            bestD = d;
          }
        }
      }
      if (best !== null) return best;
    }
    return null;
  }

  /** The first of `cells` where `kind` fits: on the map, passable, clear of known buildings and nodes. */
  private freeCell(
    r: Reading,
    kind: string,
    cells: readonly { x: number; y: number }[],
  ): { x: number; y: number } | null {
    const size = r.view.types?.buildings[kind]?.size ?? { w: 1, h: 1 };
    const t = r.view.terrain;
    const overlaps = (x: number, y: number, w: number, h: number, c: { x: number; y: number }) =>
      x < c.x + size.w && c.x < x + w && y < c.y + size.h && c.y < y + h;
    for (const c of cells) {
      if (t !== null && (c.x < 0 || c.y < 0 || c.x + size.w > t.width || c.y + size.h > t.height)) continue;
      let ok = true;
      for (let y = c.y; ok && y < c.y + size.h; y++)
        for (let x = c.x; ok && x < c.x + size.w; x++)
          if (t !== null && !passableAt(r.view, x, y)) ok = false;
      if (!ok) continue;
      if (r.known.buildings.some((b) => overlaps(b.x, b.y, b.w, b.h, c))) continue;
      if (r.view.resources.some((n) => overlaps(n.x, n.y, 1, 1, c))) continue;
      return { x: c.x, y: c.y };
    }
    return null;
  }
}

/** Whether cell (x, y) of the view's terrain can be entered (off the grid or no terrain: not). */
function passableAt(view: RtsView, x: number, y: number): boolean {
  const t = view.terrain;
  if (t === null || x < 0 || y < 0 || x >= t.width || y >= t.height) return false;
  return t.types[t.cells[y * t.width + x]!]?.passable === true;
}

/** The cell of a building's footprint nearest to `from`. */
function nearestCell(from: { x: number; y: number }, b: RtsBuildingView): { x: number; y: number } {
  return {
    x: Math.max(b.x, Math.min(from.x, b.x + b.w - 1)),
    y: Math.max(b.y, Math.min(from.y, b.y + b.h - 1)),
  };
}
