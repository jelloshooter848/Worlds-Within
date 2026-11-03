import { z } from 'zod';
import { DEFAULT_SCREEN, type ScreenSize } from '@engine/core/gfx/screen';
import type { JsonObject, JsonValue } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import { snapshotEntities, type MiniGameEnd, type SnapshotEntity } from '@engine/core/mission-adapter';
import type {
  MiniGame,
  MiniGameContext,
  MiniGameDef,
  MiniGameInputMap,
  MiniGameResult,
  MiniGameUseProblem,
} from '@engine/core/minigame';
import type { MissionAdapter, MissionDef, MissionReport } from '@engine/core/missions';
import type { PresentFrame } from '@engine/core/present';
import { TdGame } from './game';
import { cellKinds, LEGEND, type Cell } from './map';
import { describeWorld } from './present';
import type { TdMap, TdWaves, TowerTable } from './schema';
import type { TdEvent } from './world';

/**
 * The data-driven tower-defense mission (Engine 0.12 T6; docs/BUILD-LOG.md, Engine 0.12,
 * decisions 5-6, items 201-202): a mission over a world (`engine/sim`) played as one
 * tower-defense round, with no adapter code in the game. Everything is in the mission file's
 * `params` (`tdDefenceParamsSchema`), in the pattern of the topdown kit's `mission-room`:
 *
 *   "play": "td-defence",
 *   "params": {
 *     "map": "wall-road", "lives": 3, "timer": 200,
 *     "build": { "select": { "faction": "village", "types": ["wall"] } },
 *     "budget": { "faction": "village", "item": "gold", "cap": 60 },
 *     "wave": [{ "kind": "raider", "select": { "faction": "raiders" }, "hpPer": 10, "speed": 4, "spacing": 8 }],
 *     "outcomes": [
 *       { "outcome": "held-cheap", "when": { "leaksAtMost": 0, "spentAtMost": 20 } },
 *       { "outcome": "held", "when": { "leaksAtMost": 0 } },
 *       { "outcome": "breached" }
 *     ]
 *   }
 *
 * Two halves, both plain data, so the kit never imports the sim:
 *
 * - {@link towerdefenseMissionAdapter}, the `MissionAdapter`: `input(snapshot, mission)` reads the
 *   plain world snapshot the mission opened with (`snapshotEntities`): the walls `build.select`
 *   picks (ascending id), the budget (the item in the `Inventory` of the entity holding the
 *   faction's `Stockpile`, at most `cap`), and the wave: each `wave` entry's units, in entry order
 *   and then ascending id (an entity goes to the first entry that selects it), with their hp from
 *   `Health.hp` (divided by `hpPer`, rounded up). `outcome(end, mission)` walks the `outcomes`
 *   rules in order over the round's report (a quit goes to `onQuit`).
 * - {@link tdDefence}, the `MiniGameDef` (id `td-defence`): its round is the `td-map` named by
 *   `map` with each wall on the next build cell (of the `build.slot` character, or every build
 *   cell) in reading order (spare ones become blocked ground; more walls than cells refuses the
 *   round), the starting gold the budget and the lives the param, and one wave of the world's units
 *   in order, played as a `TdGame`. Select quits. Its report says which world entity stood where,
 *   so the adapter needs no state between the two calls.
 *
 * World names: an entity is named by the scenario key the open mission's `refs` give it (the keys
 * its outcomes' effects name, as the snapshot's `Missions` component holds them), else by its id
 * as a string; a build cell no wall stands on is named by its cell, `"<col>,<row>"`. The rules'
 * `killed` uses the same names.
 *
 * Walls lost (`fallen`): the round's rules have no wall damage, so the report counts a breach per
 * leak: each enemy that leaks brings down one build cell, the one nearest the path's exit (squared
 * cell distance, ties in reading order) not already fallen. This is how the report reads the round,
 * not a round rule (no `TOWERDEFENSE_RULES` id). Pure: nothing random but the round's seed.
 */

/** The mini game id a mission names in `play`. */
export const TD_DEFENCE = 'td-defence';

const NAME = z.union([z.string().min(1), z.int().min(1)]);

/** Which world entities a `build` or `wave` entry picks. */
const selectSchema = z.strictObject({
  event: z
    .string()
    .min(1)
    .exactOptional()
    .describe(
      "only members of this event (`EventMember`); for `wave` the mission's `event` when left out, for `build` any",
    ),
  faction: z.string().min(1).exactOptional().describe('only entities of this faction (`Owner`)'),
  types: z
    .array(z.string().min(1))
    .min(1)
    .exactOptional()
    .describe('only units (`Unit.type`) or buildings (`Building.kind`) of these types'),
  keys: z
    .array(NAME)
    .min(1)
    .exactOptional()
    .describe("only entities with these world names (the mission's scenario keys, or ids)"),
});

type Select = z.infer<typeof selectSchema>;

const buildSchema = z.strictObject({
  select: selectSchema.describe('which world entities (the walls) stand on the build cells'),
  slot: z
    .string()
    .length(1)
    .exactOptional()
    .describe(
      "the map character (a build cell's) whose cells the walls stand on; every build cell when left out",
    ),
});

const budgetSchema = z.strictObject({
  faction: z.string().min(1).describe('the faction whose stockpile pays (the entity with its `Stockpile`)'),
  item: z.string().min(1).describe('the stockpile item that is the gold (`Inventory.<item>`)'),
  cap: z.int().min(0).exactOptional().describe('at most this much of it goes to the round'),
});

const waveEntrySchema = z.strictObject({
  kind: z.string().min(1).describe('the enemy kind they are in the round (for skins and reports)'),
  select: selectSchema.default({}).describe('which world units become these enemies'),
  hpPer: z
    .int()
    .min(1)
    .exactOptional()
    .describe('world hit points per round hit point (rounded up, at least 1); `Health.hp` when left out'),
  speed: z.int().min(1).max(16).describe('sub-cell units walked each tick (16 to a cell)'),
  spacing: z.int().min(0).default(0).describe('ticks from one of them entering to the next'),
  bounty: z.int().min(0).default(0).describe('the gold a kill pays in the round'),
});

const whenSchema = z.strictObject({
  result: z
    .enum(['pass', 'fail'])
    .exactOptional()
    .describe(
      'how the round ended: every enemy dealt with and lives left (`pass`), or no lives left (`fail`)',
    ),
  leaksAtMost: z.int().min(0).exactOptional().describe('at most this many enemies reached the exit'),
  spentAtMost: z.int().min(0).exactOptional().describe('at most this much gold spent on towers'),
  killed: z
    .array(NAME)
    .min(1)
    .exactOptional()
    .describe('world units (scenario keys or ids) that were all killed in the round'),
});

const ruleSchema = z.strictObject({
  outcome: z.string().min(1).describe("the mission's declared outcome this rule gives"),
  when: whenSchema
    .exactOptional()
    .describe('what must all hold (left out: always; the last rule must have none)'),
});

/**
 * The shape of a `td-defence` mission's `params`, the `paramsSchema` `validate` checks them with.
 * Beyond the shape: only the last rule without `when`, so every report maps. Checks that need the
 * game's maps or the mission's outcomes are the def's `checkUse` ({@link tdDefenceProblems}).
 */
export const tdDefenceParamsSchema = z
  .strictObject({
    map: z.string().min(1).describe("the id of the game's `td-map` the round is played on"),
    build: buildSchema
      .exactOptional()
      .describe(
        "which world entities (walls) stand on the map's build cells; the map's own cells when left out",
      ),
    budget: budgetSchema
      .exactOptional()
      .describe("where the round's gold comes from; the map's `start.gold` when left out"),
    lives: z
      .int()
      .min(1)
      .exactOptional()
      .describe("the round's lives; the map's `start.lives` when left out"),
    timer: z
      .int()
      .min(1)
      .exactOptional()
      .describe('ticks after which the wave starts by itself; left out, only the start button starts it'),
    wave: z.array(waveEntrySchema).min(1).describe('which world units come down the path, in this order'),
    outcomes: z
      .array(ruleSchema)
      .min(1)
      .describe('rules from the round to a declared outcome, tried in order; the first that holds wins'),
  })
  .superRefine((params, ctx) => {
    params.outcomes.forEach((rule, i) => {
      const last = i === params.outcomes.length - 1;
      if (last && rule.when !== undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['outcomes', i, 'when'],
          message: 'the last rule must have no `when`, so every round maps to an outcome',
        });
      if (!last && rule.when === undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['outcomes', i],
          message: 'only the last rule may leave out `when` (the rules after it could never hold)',
        });
    });
  });

export type TdDefenceParams = z.infer<typeof tdDefenceParamsSchema>;
export type TdDefenceRule = TdDefenceParams['outcomes'][number];

/** The params from a mission, checked; throws naming the field (`td-defence params "map": ...`). */
export function tdDefenceParams(raw: JsonObject | undefined): TdDefenceParams {
  const parsed = tdDefenceParamsSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0]!;
  const at = issue.path.map(String).join('.');
  throw new Error(`td-defence params${at ? ` "${at}"` : ''}: ${issue.message}`);
}

/** A world entity the adapter picked: its id and its world name. */
export interface TdWorldRef extends JsonObject {
  entity: number;
  name: string;
}

/** One enemy of the wave: its kind and numbers, and the world unit it is. */
export interface TdDefenceFoe extends TdWorldRef {
  kind: string;
  hp: number;
  speed: number;
  spacing: number;
  bounty: number;
}

/** What the adapter gives the round (`MiniGameContext.params`). */
export interface TdDefenceInput extends JsonObject {
  map: string;
  /** The round's gold (the budget), or the map's `start.gold` when left out. */
  gold?: number;
  /** The round's lives, or the map's `start.lives` when left out. */
  lives?: number;
  timer?: number;
  /** The walls in order, or null for the map's own build cells. */
  walls: TdWorldRef[] | null;
  /** With `walls`: the map character whose cells they stand on (every build cell when left out). */
  slot?: string;
  foes: TdDefenceFoe[];
}

const refSchema = z.strictObject({ entity: z.int(), name: z.string().min(1) });
const roundInputSchema = z.strictObject({
  map: z.string().min(1),
  gold: z.int().min(0).exactOptional(),
  lives: z.int().min(1).exactOptional(),
  timer: z.int().min(1).exactOptional(),
  walls: z.array(refSchema).nullable(),
  slot: z.string().length(1).exactOptional(),
  foes: z
    .array(
      refSchema.extend({
        kind: z.string().min(1),
        hp: z.int().min(1),
        speed: z.int().min(1).max(16),
        spacing: z.int().min(0),
        bounty: z.int().min(0),
      }),
    )
    .min(1),
});

/** A build cell of the round: its cell (`"<col>,<row>"`), name and the wall on it, if any. */
export interface TdDefenceCell extends JsonObject {
  cell: string;
  name: string;
  entity: number | null;
}

/**
 * The round's report (`report()`): how it ended, what was placed and spent, and what was lost and
 * killed, by world name. `placed` counts towers placed by type (sold ones too), `towers` are the
 * ones standing at the end; `killed` and `escaped` name the wave's units, `fallen` the build cells
 * (walls) lost to breaches; `cells` and `foes` map the round back to the world.
 */
export interface TdDefenceReport extends JsonObject {
  result: MiniGameResult | null;
  ticks: number;
  lives: number;
  livesLeft: number;
  leaked: number;
  spent: number;
  refunded: number;
  goldLeft: number;
  placed: Record<string, number>;
  towers: { cell: string; name: string; type: string }[];
  killed: string[];
  escaped: string[];
  fallen: string[];
  cells: TdDefenceCell[];
  foes: { enemy: number; entity: number; name: string; kind: string }[];
}

// ---- The adapter ----

const record = (v: JsonValue | undefined): Record<string, JsonValue> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? v : null;

/** The open mission's scenario keys by entity id, read loosely from the snapshot's `Missions`. */
function namesOf(snapshot: JsonObject, missionId: string): Map<number, string> {
  const names = new Map<number, string>();
  const missions = record(snapshot['components'])?.['Missions'];
  if (!Array.isArray(missions)) return names;
  for (const pair of missions) {
    const open = Array.isArray(pair) ? record(pair[1])?.['open'] : undefined;
    if (!Array.isArray(open)) continue;
    for (const entry of open) {
      const e = record(entry);
      if (record(e?.['def'])?.['id'] !== missionId) continue;
      for (const [key, id] of Object.entries(record(e?.['refs']) ?? {}))
        if (typeof id === 'number' && !names.has(id)) names.set(id, key);
    }
  }
  return names;
}

const field = (e: SnapshotEntity, component: string, key: string): JsonValue | undefined =>
  record(e.components[component])?.[key];

/** Whether `select` picks entity `e` (named `name`; `event` already resolved). */
function selects(e: SnapshotEntity, name: string, select: Select, event: string | undefined): boolean {
  if (!('Position' in e.components)) return false;
  const hp = field(e, 'Health', 'hp');
  if (typeof hp === 'number' && hp <= 0) return false;
  if (event !== undefined && field(e, 'EventMember', 'event') !== event) return false;
  if (select.faction !== undefined && field(e, 'Owner', 'faction') !== select.faction) return false;
  if (select.types !== undefined) {
    const type = field(e, 'Unit', 'type') ?? field(e, 'Building', 'kind');
    if (!select.types.includes(type as string)) return false;
  }
  if (select.keys !== undefined && !select.keys.some((k) => String(k) === name || k === e.id)) return false;
  return true;
}

/** The budget: the item in the `Inventory` of the entity with the faction's `Stockpile`, capped. */
function budgetOf(entities: readonly SnapshotEntity[], budget: NonNullable<TdDefenceParams['budget']>) {
  const store = entities.find((e) => field(e, 'Stockpile', 'faction') === budget.faction);
  if (store === undefined) throw new Error(`budget: no entity holds faction "${budget.faction}"'s Stockpile`);
  const have = field(store, 'Inventory', budget.item);
  const gold = typeof have === 'number' ? Math.max(0, Math.floor(have)) : 0;
  return budget.cap === undefined ? gold : Math.min(gold, budget.cap);
}

/**
 * The round's params from the plain world snapshot (`MissionAdapter.input`); a left-out `budget`
 * or `lives` is left out of the input too, and the round takes the map's own. Throws (the host refuses the round as
 * `bad_mission_input`) on malformed params, a wave that selects no unit, or a rule naming a world
 * unit that is not in the wave.
 */
export function tdDefenceInput(snapshot: JsonObject, mission: MissionDef): TdDefenceInput {
  const params = tdDefenceParams(mission.params);
  const names = namesOf(snapshot, mission.id);
  const entities = snapshotEntities(snapshot);
  const nameOf = (e: SnapshotEntity) => names.get(e.id) ?? String(e.id);
  let walls: TdWorldRef[] | null = null;
  if (params.build) {
    const select = params.build.select;
    walls = entities
      .filter((e) => selects(e, nameOf(e), select, select.event))
      .map((e) => ({ entity: e.id, name: nameOf(e) }));
  }
  const taken = new Set<number>();
  const foes: TdDefenceFoe[] = [];
  for (const entry of params.wave) {
    const event = entry.select.event ?? mission.event;
    for (const e of entities) {
      if (taken.has(e.id) || !selects(e, nameOf(e), entry.select, event)) continue;
      taken.add(e.id);
      const hp = field(e, 'Health', 'hp');
      const worldHp = typeof hp === 'number' ? hp : 1;
      foes.push({
        entity: e.id,
        name: nameOf(e),
        kind: entry.kind,
        hp: Math.max(1, Math.ceil(worldHp / (entry.hpPer ?? 1))),
        speed: entry.speed,
        spacing: entry.spacing,
        bounty: entry.bounty,
      });
    }
  }
  if (foes.length === 0) throw new Error('the wave selects no world unit');
  const known = new Set(foes.flatMap((f) => [f.name, String(f.entity)]));
  params.outcomes.forEach((rule, i) => {
    for (const name of rule.when?.killed ?? [])
      if (!known.has(String(name)))
        throw new Error(
          `outcomes.${i}.when.killed names "${name}", which is not in the wave (${[...known].join(', ')})`,
        );
  });
  const input: TdDefenceInput = { map: params.map, walls, foes };
  if (params.budget) input.gold = budgetOf(entities, params.budget);
  if (params.lives !== undefined) input.lives = params.lives;
  if (params.timer !== undefined) input.timer = params.timer;
  if (params.build?.slot !== undefined) input.slot = params.build.slot;
  return input;
}

/** Whether `rule` holds for a round that ended in `result` with this report. */
function holds(rule: TdDefenceRule, result: MiniGameResult, report: TdDefenceReport): boolean {
  const when = rule.when;
  if (when === undefined) return true;
  if (when.result !== undefined && when.result !== result) return false;
  if (when.leaksAtMost !== undefined && report.leaked > when.leaksAtMost) return false;
  if (when.spentAtMost !== undefined && report.spent > when.spentAtMost) return false;
  if (when.killed !== undefined) {
    const dead = new Set(
      report.foes.filter((f) => report.killed.includes(f.name)).flatMap((f) => [f.name, String(f.entity)]),
    );
    if (when.killed.some((n) => !dead.has(String(n)))) return false;
  }
  return true;
}

/**
 * The mission report for a round's end (`MissionAdapter.outcome`): a quit goes to the mission's
 * `onQuit`; otherwise the first rule that holds names the outcome. `stats`: `placed` (towers by
 * type), `spent`, `leaked`, `livesLeft`, `killed`, `escaped` and `fallen` (world names) and
 * `ticks`. Throws (refused as `unmappable_report`) on a round with no report or one that is not a
 * `td-defence` report.
 */
export function tdDefenceOutcome(end: MiniGameEnd, mission: MissionDef): MissionReport {
  if (end.result === 'quit') return { outcome: mission.onQuit };
  const params = tdDefenceParams(mission.params);
  if (end.report === null) throw new Error('the round gave no report');
  const report = end.report as TdDefenceReport;
  if (!Array.isArray(report.foes) || !Array.isArray(report.cells))
    throw new Error('the round\'s report has no "foes" and "cells" lists (is it a td-defence round?)');
  const rule = params.outcomes.find((r) => holds(r, end.result, report));
  if (rule === undefined) throw new Error('no outcome rule holds for the round');
  return {
    outcome: rule.outcome,
    stats: {
      placed: { ...report.placed },
      spent: report.spent,
      leaked: report.leaked,
      livesLeft: report.livesLeft,
      killed: [...report.killed],
      escaped: [...report.escaped],
      fallen: [...report.fallen],
      ticks: end.ticks,
    },
  };
}

/**
 * The kit's mission adapter for `td-defence` missions (`MissionAdapter<JsonObject, MiniGameEnd>`,
 * the shape `MissionHost` takes by mini game id): `input` is {@link tdDefenceInput}, `outcome`
 * {@link tdDefenceOutcome}. It keeps no state, so one serves every round.
 */
export const towerdefenseMissionAdapter: MissionAdapter<JsonObject, MiniGameEnd> = {
  input: (snapshot, mission) => tdDefenceInput(snapshot, mission),
  outcome: (end, mission) => tdDefenceOutcome(end, mission),
};

// ---- The round ----

/** What a game gives `tdDefence`: its maps and tower types, and how the round shows. */
export interface TdDefenceOptions {
  /** The game's `td-map`s a mission may name. */
  maps: readonly TdMap[];
  /** The game's tower types (`towerTable`). */
  towers: TowerTable;
  /** The mini game's title ('DEFENCE' when left out; a host shows the mission's own title). */
  title?: string;
  /** The host HUD status keys the round shows (`['mission']` by default). */
  hostStatus?: readonly string[];
  /** The round's own controls (host action to round action). */
  inputMap?: MiniGameInputMap;
  /** The picture size `present()` describes (`DEFAULT_SCREEN` when left out). */
  size?: ScreenSize;
  /** Kit rules switched off in every round. */
  disabledRules?: readonly string[];
}

const cellKey = (c: Cell) => `${c.col},${c.row}`;

/** The map with the walls on its slot cells, and every build cell's name, in reading order. */
function placeWalls(map: TdMap, input: z.infer<typeof roundInputSchema>) {
  const kinds = cellKinds(map.map, map.legend);
  const queue = input.walls === null ? null : [...input.walls];
  const cells: TdDefenceCell[] = [];
  const rows = map.map.map((line, row) =>
    [...line]
      .map((char, col) => {
        if (kinds[row]![col] !== 'build') return char;
        const cell = `${col},${row}`;
        const isSlot = queue !== null && (input.slot === undefined || input.slot === char);
        if (!isSlot) {
          cells.push({ cell, name: cell, entity: null });
          return char;
        }
        const wall = queue.shift();
        if (wall === undefined) return '.';
        cells.push({ cell, name: wall.name, entity: wall.entity });
        return char;
      })
      .join(''),
  );
  if (queue !== null && queue.length > 0)
    throw new Error(
      `td-map "${map.id}" has too few ${input.slot === undefined ? 'build' : `"${input.slot}"`} cells: ${queue.length} more wall(s) (${queue.map((w) => w.name).join(', ')})`,
    );
  return { rows, cells };
}

/** One tower-defense mission round: a `TdGame` over the world's walls and units. */
export class TdDefenceRound implements MiniGame {
  readonly game: TdGame;
  private ticks = 0;
  private quit = false;
  private pending: TdEvent[] = [];
  private readonly placedByType: Record<string, number> = {};
  private readonly killedIds = new Set<number>();
  private readonly escapedIds = new Set<number>();

  constructor(
    def: { map: TdMap; towers: TowerTable; waves: TdWaves },
    seed: number,
    readonly cells: readonly TdDefenceCell[],
    readonly foes: readonly TdDefenceFoe[],
    private readonly ctx: MiniGameContext,
    private readonly opts: { size?: ScreenSize; disabledRules?: readonly string[] } = {},
  ) {
    this.game = new TdGame({ ...def, seed, disabledRules: opts.disabledRules });
  }

  step(input: InputFrame): void {
    if (this.result() !== null) return;
    if (input.pressed('select')) {
      this.quit = true;
      return;
    }
    this.game.step(input);
    this.ticks++;
    for (const e of this.game.events) {
      if (e.type === 'placed') this.placedByType[e.towerType] = (this.placedByType[e.towerType] ?? 0) + 1;
      if (e.type === 'kill') this.killedIds.add(e.enemy);
      if (e.type === 'leak') this.escapedIds.add(e.enemy);
    }
    this.pending.push(...this.game.events);
  }

  result(): MiniGameResult | null {
    if (this.quit) return 'quit';
    const outcome = this.game.world.outcome;
    return outcome === 'won' ? 'pass' : outcome === 'lost' ? 'fail' : null;
  }

  snapshot(): JsonObject {
    return { ...this.game.snapshot(), mission: { ticks: this.ticks, result: this.result() } };
  }

  /** The world name of the unit that is enemy `id` (enemies enter, ids from 1, in the wave's order). */
  private foeName(id: number): string {
    return this.foes[id - 1]?.name ?? String(id);
  }

  /** The build cells lost to breaches: one per leak, nearest the exit first (see the file comment). */
  private fallen(): string[] {
    const w = this.game.world;
    const exit = w.path[w.path.length - 1]!;
    const byExit = this.cells
      .map((c, i) => {
        const [col, row] = c.cell.split(',').map(Number) as [number, number];
        return { c, i, d: (col - exit.col) ** 2 + (row - exit.row) ** 2 };
      })
      .sort((a, b) => a.d - b.d || a.i - b.i);
    return byExit.slice(0, w.stats.leaked).map((x) => x.c.name);
  }

  report(): TdDefenceReport {
    const w = this.game.world;
    const nameAt = new Map(this.cells.map((c) => [c.cell, c.name]));
    const ids = (set: ReadonlySet<number>) => [...set].sort((a, b) => a - b).map((id) => this.foeName(id));
    return {
      result: this.result(),
      ticks: this.ticks,
      lives: w.map.start.lives,
      livesLeft: w.lives,
      leaked: w.stats.leaked,
      spent: w.stats.spent,
      refunded: w.stats.refunded,
      goldLeft: w.gold,
      placed: { ...this.placedByType },
      towers: w.towers.map((t) => {
        const cell = cellKey(t);
        return { cell, name: nameAt.get(cell) ?? cell, type: t.type };
      }),
      killed: ids(this.killedIds),
      escaped: ids(this.escapedIds),
      fallen: this.fallen(),
      cells: this.cells.map((c) => ({ ...c })),
      foes: this.foes.map((f, i) => ({ enemy: i + 1, entity: f.entity, name: f.name, kind: f.kind })),
    };
  }

  /**
   * The kit's frame of the round (`describeWorld`, with the cursor and the events since the last
   * frame), each enemy tagged `foe:<name>` (its world name, so a skin can draw a world unit its
   * own way), and each host value the round was given as `status['host:<key>']`. No stream
   * state: every frame carries the full map (a host's own tracker trims it).
   */
  present(): PresentFrame {
    const frame = describeWorld(this.game.world, {
      size: this.opts.size ?? DEFAULT_SCREEN,
      events: this.pending.splice(0),
      cursor: this.game.controls.view(),
    });
    for (const e of frame.entities) {
      const m = /^enemy-(\d+)$/.exec(e.id);
      if (m) e.tags.push(`foe:${this.foeName(Number(m[1]))}`);
    }
    for (const [key, value] of Object.entries(this.ctx.hostStatus ?? {})) frame.status[`host:${key}`] = value;
    return frame;
  }
}

/** Problems with a mission's params that need the maps or the mission ({@link tdDefence}'s `checkUse`). */
export function tdDefenceProblems(
  params: TdDefenceParams,
  maps: readonly TdMap[],
  mission: JsonObject | null,
): MiniGameUseProblem[] {
  const problems: MiniGameUseProblem[] = [];
  const map = maps.find((m) => m.id === params.map);
  if (map === undefined)
    problems.push({
      path: ['map'],
      message: `no td-map "${params.map}" (the game has: ${maps.map((m) => `"${m.id}"`).join(', ') || 'none'})`,
    });
  else {
    const kinds = cellKinds(map.map, map.legend);
    if (!kinds.some((row) => row.includes('build')))
      problems.push({ path: ['map'], message: `td-map "${map.id}" has no build cell` });
    const slot = params.build?.slot;
    if (slot !== undefined) {
      const kind = Object.hasOwn(map.legend, slot) ? map.legend[slot] : LEGEND[slot]?.cell;
      if (!map.map.some((line) => line.includes(slot)))
        problems.push({ path: ['build', 'slot'], message: `td-map "${map.id}" has no "${slot}" cell` });
      else if (kind !== 'build')
        problems.push({
          path: ['build', 'slot'],
          message: `"${slot}" is a ${kind ?? 'blocked'} cell on td-map "${map.id}", not a build cell`,
        });
    }
  }
  const outcomes = mission?.['outcomes'];
  if (Array.isArray(outcomes)) {
    const declared = outcomes.map((o) => record(o)?.['id']);
    params.outcomes.forEach((rule, i) => {
      if (!declared.includes(rule.outcome))
        problems.push({
          path: ['outcomes', i, 'outcome'],
          message: `"${rule.outcome}" is not an outcome of the mission (${declared.map((d) => `"${String(d)}"`).join(', ')})`,
        });
    });
  }
  return problems;
}

/**
 * The `td-defence` mini game over the game's maps and tower types. Its `paramsSchema` is
 * `tdDefenceParamsSchema` (a mission's params, checked by `validate`), and its `checkUse` checks
 * that the map is one of `maps` with a build cell, the `build.slot` character is a build cell on
 * it and each rule names an outcome the mission declares. A round (`create`) takes the adapter's
 * {@link TdDefenceInput}, not the mission's params: it puts the walls on the build cells, gives
 * the map the budget and lives, builds one wave of the world's units (one group each, in order,
 * the wave list named as the map names it) and plays it as a `TdDefenceRound`. Throws (no round
 * starts) on an unknown map or more walls than cells.
 */
export function tdDefence(opts: TdDefenceOptions): MiniGameDef {
  const { maps, towers } = opts;
  return {
    id: TD_DEFENCE,
    title: opts.title ?? 'DEFENCE',
    paramsSchema: tdDefenceParamsSchema,
    checkUse: ({ params, owner }) => tdDefenceProblems(tdDefenceParamsSchema.parse(params), maps, owner),
    hostStatus: opts.hostStatus ?? ['mission'],
    ...(opts.inputMap ? { inputMap: opts.inputMap } : {}),
    create: (ctx, seed) => {
      const parsed = roundInputSchema.safeParse(ctx.params);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        throw new Error(`td-defence: input "${issue.path.map(String).join('.')}": ${issue.message}`);
      }
      const input = parsed.data;
      const base = maps.find((m) => m.id === input.map);
      if (base === undefined) throw new Error(`td-defence: no td-map "${input.map}"`);
      const { rows, cells } = placeWalls(base, input);
      const start = { gold: input.gold ?? base.start.gold, lives: input.lives ?? base.start.lives };
      const map: TdMap = { ...base, map: rows, start };
      const waves: TdWaves = {
        id: base.waves,
        waves: [
          {
            groups: input.foes.map((f) => ({
              kind: f.kind,
              count: 1,
              spacing: f.spacing,
              hp: f.hp,
              speed: f.speed,
              bounty: f.bounty,
            })),
          },
        ],
      };
      if (input.timer !== undefined) waves.timer = input.timer;
      const roundOpts: { size?: ScreenSize; disabledRules?: readonly string[] } = {};
      if (opts.size) roundOpts.size = opts.size;
      if (opts.disabledRules) roundOpts.disabledRules = opts.disabledRules;
      return new TdDefenceRound({ map, towers, waves }, seed, cells, input.foes, ctx, roundOpts);
    },
  };
}
