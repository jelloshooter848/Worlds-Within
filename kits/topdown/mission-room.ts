import { z } from 'zod';
import type { JsonObject, JsonValue } from '@engine/core/headless';
import { snapshotEntities, type MiniGameEnd, type SnapshotEntity } from '@engine/core/mission-adapter';
import type { MiniGameContext, MiniGameDef, MiniGameResult, MiniGameUseProblem } from '@engine/core/minigame';
import type { MissionAdapter, MissionDef, MissionReport } from '@engine/core/missions';
import { CHALLENGE_TICKS, RoomChallenge, type ChallengeReport, type RoomChallengeOptions } from './challenge';
import { buildDungeon, LEGEND, type Dungeon, type LegendEntry, type RoomDef } from './room';

/**
 * The data-driven top-down mission (Engine 0.11 T7; docs/BUILD-LOG.md, Engine 0.11, decision 5,
 * item 176): a mission over a world (`engine/sim`) played as one top-down room, with no adapter
 * code in the game. Everything is in the mission file's `params` (`missionRoomParamsSchema`):
 *
 *   "play": "mission-room",
 *   "params": {
 *     "room": "siege-camp", "goal": "defeat-all", "ticks": 1200, "hp": 6,
 *     "foes": [{ "slot": "n", "kind": "knight", "select": { "faction": "blue" } }],
 *     "outcomes": [
 *       { "outcome": "clean", "when": { "destroyed": ["ram", "tower", "catapult"] } },
 *       { "outcome": "partial", "when": { "minDestroyed": 1 } },
 *       { "outcome": "repelled" }
 *     ]
 *   }
 *
 * Two halves, both plain data, so the kit never imports the sim:
 *
 * - {@link topdownMissionAdapter}, the `MissionAdapter`: `input(snapshot, mission)` reads the plain
 *   world snapshot the mission opened with (`snapshotEntities`) and picks the world entities each
 *   `foes` entry selects (members of the mission's `event` unless the entry names another, then by
 *   `Owner` faction, `Unit` type and squad `Member` role, living ones only, ascending id; an entity
 *   goes to the first entry that selects it), giving the round's params ({@link MissionRoomInput}).
 *   `outcome(end, mission)` maps the round's report back to world names and walks the `outcomes`
 *   rules in order: the first that holds names the outcome (a quit goes to `onQuit`).
 * - {@link missionRoom}, the `MiniGameDef` (id `mission-room`): its round is the room file named by
 *   `room` with each foe in the next cell of its `slot` character in reading order (spare slot cells
 *   become floor; more foes than cells refuses the round), played as a `RoomChallenge`. Its report
 *   is the challenge's plus `placed`, which room cell holds which world entity, so the adapter needs
 *   no state between the two calls.
 *
 * World names: an entity is named by the scenario key the open mission's `refs` give it (the keys
 * its outcomes' effects name, as the snapshot's `Missions` component holds them), else by its id
 * as a string. The rules' `destroyed` and `spared` use the same names. Pure: nothing random but the
 * round's seed.
 */

/** The mini game id a mission names in `play`. */
export const MISSION_ROOM = 'mission-room';

const NAME = z.union([z.string().min(1), z.int().min(1)]);
const ROLE = z.enum(['regular', 'hero', 'captain']);

/** Which world entities one `foes` entry picks. */
const selectSchema = z.strictObject({
  event: z
    .string()
    .min(1)
    .exactOptional()
    .describe("members of this event (`EventMember`); the mission's `event` when left out"),
  faction: z.string().min(1).exactOptional().describe('only entities of this faction (`Owner`)'),
  types: z
    .array(z.string().min(1))
    .min(1)
    .exactOptional()
    .describe('only units of these types (`Unit.type`)'),
  member: ROLE.exactOptional().describe('only named squad members with this role (`Member.role`)'),
});

const foeSchema = z.strictObject({
  slot: z
    .string()
    .length(1)
    .describe("the room's map character whose cells, in reading order, these foes stand on"),
  kind: z.string().min(1).describe('the enemy kind they are in the room (`knight`, or a game spawn kind)'),
  select: selectSchema.default({}).describe('which world entities become these foes'),
  hpPer: z
    .int()
    .min(1)
    .exactOptional()
    .describe(
      "world hit points per room hit point (rounded up, at least 1); the kind's own hp when left out",
    ),
});

const whenSchema = z.strictObject({
  result: z
    .enum(['pass', 'fail'])
    .exactOptional()
    .describe('how the round ended: its goal met (`pass`) or not (`fail`)'),
  destroyed: z
    .array(NAME)
    .min(1)
    .exactOptional()
    .describe('world entities (scenario keys or ids) that were all destroyed in the round'),
  spared: z
    .array(NAME)
    .min(1)
    .exactOptional()
    .describe('world entities (scenario keys or ids) none of which was destroyed'),
  minDestroyed: z.int().min(0).exactOptional().describe('at least this many foes destroyed'),
});

const ruleSchema = z.strictObject({
  outcome: z.string().min(1).describe("the mission's declared outcome this rule gives"),
  when: whenSchema
    .exactOptional()
    .describe('what must all hold (left out: always; the last rule must have none)'),
});

/**
 * The shape of a `mission-room` mission's `params`, the `paramsSchema` `validate` checks them with
 * (gap G16). Beyond the shape: at least one foe entry and one rule, and only the last rule without
 * `when`, so every report maps. Checks that need the game's rooms or the mission's outcomes are the
 * def's `checkUse` ({@link missionRoomProblems}).
 */
export const missionRoomParamsSchema = z
  .strictObject({
    room: z.string().min(1).describe("the id of the game's `room` file the round is played in"),
    goal: z
      .enum(['defeat-all', 'reach'])
      .describe('what the round asks: every foe beaten, or an exit tile reached'),
    ticks: z
      .int()
      .min(1)
      .exactOptional()
      .describe(`the round's time limit in ticks (${CHALLENGE_TICKS} when left out)`),
    hp: z
      .int()
      .min(1)
      .exactOptional()
      .describe("the hero's hit points in half hearts (the kit's default when left out)"),
    foes: z.array(foeSchema).min(1).describe('which world entities become which foes, in which slots'),
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

export type MissionRoomParams = z.infer<typeof missionRoomParamsSchema>;
export type MissionRoomRule = MissionRoomParams['outcomes'][number];

/**
 * The params from a mission, checked by `missionRoomParamsSchema`. Throws naming the field
 * (`mission-room params: "outcomes.2.when": ...`), so content `validate` did not see still fails
 * before its round starts.
 */
export function missionRoomParams(raw: JsonObject | undefined): MissionRoomParams {
  const parsed = missionRoomParamsSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0]!;
  const at = issue.path.map(String).join('.');
  throw new Error(`mission-room params${at ? ` "${at}"` : ''}: ${issue.message}`);
}

/** One foe the adapter picked: its slot, kind, room hp (when set) and world entity. */
export interface MissionRoomFoe extends JsonObject {
  slot: string;
  kind: string;
  /** The world entity's id and name (scenario key, else the id as a string). */
  entity: number;
  name: string;
  hp?: number;
}

/** What the adapter gives the round: the room, goal and limits, and the picked foes in order. */
export interface MissionRoomInput extends JsonObject {
  room: string;
  goal: 'defeat-all' | 'reach';
  ticks: number;
  hp?: number;
  /** Every slot character the mission names, so spare cells of each become floor. */
  slots: string[];
  foes: MissionRoomFoe[];
}

const roundInputSchema = z.strictObject({
  room: z.string().min(1),
  goal: z.enum(['defeat-all', 'reach']),
  ticks: z.int().min(1),
  hp: z.int().min(1).exactOptional(),
  slots: z.array(z.string().length(1)),
  foes: z.array(
    z.strictObject({
      slot: z.string().length(1),
      kind: z.string().min(1),
      entity: z.int(),
      name: z.string().min(1),
      hp: z.int().min(1).exactOptional(),
    }),
  ),
});

/** Which room cell holds which world entity (`"<col>,<row>"`, as the report's keys). */
export interface MissionRoomPlaced extends JsonObject {
  cell: string;
  entity: number;
  name: string;
}

/** The round's report: the room challenge's, plus where each world entity stood. */
export interface MissionRoomReport extends ChallengeReport {
  placed: MissionRoomPlaced[];
}

// ---- The adapter ----

const record = (v: JsonValue | undefined): Record<string, JsonValue> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? v : null;

/** The open mission's scenario keys by entity id, read loosely from the snapshot's `Missions`. */
function namesOf(snapshot: JsonObject, missionId: string): Map<number, string> {
  const names = new Map<number, string>();
  const lists = record(snapshot['components']);
  const missions = lists?.['Missions'];
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

/** Whether entity `e` is one `select` picks (`event` already resolved). */
function selects(e: SnapshotEntity, select: MissionRoomParams['foes'][number]['select'], event?: string) {
  if (!('Position' in e.components)) return false;
  const hp = field(e, 'Health', 'hp');
  if (typeof hp === 'number' && hp <= 0) return false;
  if (event !== undefined && field(e, 'EventMember', 'event') !== event) return false;
  if (select.faction !== undefined && field(e, 'Owner', 'faction') !== select.faction) return false;
  if (select.types !== undefined && !select.types.includes(field(e, 'Unit', 'type') as string)) return false;
  if (select.member !== undefined && field(e, 'Member', 'role') !== select.member) return false;
  return true;
}

/**
 * The round's params from the plain world snapshot (`MissionAdapter.input`). Throws (the host
 * refuses the round as `bad_mission_input`) on malformed params, or when a rule names a world
 * entity that is not one of the round's foes (it could never be destroyed in the round).
 */
export function missionRoomInput(snapshot: JsonObject, mission: MissionDef): MissionRoomInput {
  const params = missionRoomParams(mission.params);
  const names = namesOf(snapshot, mission.id);
  const entities = snapshotEntities(snapshot);
  const taken = new Set<number>();
  const foes: MissionRoomFoe[] = [];
  for (const entry of params.foes) {
    const event = entry.select.event ?? mission.event;
    for (const e of entities) {
      if (taken.has(e.id) || !selects(e, entry.select, event)) continue;
      taken.add(e.id);
      const foe: MissionRoomFoe = {
        slot: entry.slot,
        kind: entry.kind,
        entity: e.id,
        name: names.get(e.id) ?? String(e.id),
      };
      const hp = field(e, 'Health', 'hp');
      if (entry.hpPer !== undefined && typeof hp === 'number')
        foe.hp = Math.max(1, Math.ceil(hp / entry.hpPer));
      foes.push(foe);
    }
  }
  const known = new Set(foes.flatMap((f) => [f.name, String(f.entity)]));
  params.outcomes.forEach((rule, i) => {
    for (const key of ['destroyed', 'spared'] as const)
      for (const name of rule.when?.[key] ?? [])
        if (!known.has(String(name)))
          throw new Error(
            `outcomes.${i}.when.${key} names "${name}", which is not one of the round's foes (${[...known].join(', ') || 'none'})`,
          );
  });
  const input: MissionRoomInput = {
    room: params.room,
    goal: params.goal,
    ticks: params.ticks ?? CHALLENGE_TICKS,
    slots: [...new Set(params.foes.map((f) => f.slot))],
    foes,
  };
  if (params.hp !== undefined) input.hp = params.hp;
  return input;
}

/**
 * Whether `rule` holds for a round that ended in `result`, `destroyed` holding the destroyed
 * foes' names and ids and `count` how many there were.
 */
function holds(
  rule: MissionRoomRule,
  result: MiniGameResult,
  destroyed: ReadonlySet<string>,
  count: number,
): boolean {
  const when = rule.when;
  if (when === undefined) return true;
  if (when.result !== undefined && when.result !== result) return false;
  if (when.destroyed?.some((n) => !destroyed.has(String(n)))) return false;
  if (when.spared?.some((n) => destroyed.has(String(n)))) return false;
  if (when.minDestroyed !== undefined && count < when.minDestroyed) return false;
  return true;
}

/**
 * The mission report for a round's end (`MissionAdapter.outcome`): a quit goes to the mission's
 * `onQuit`; otherwise the report's destroyed and hurt room keys are mapped back to world names
 * and the first rule that holds names the outcome. `stats`: `destroyed` and `hurt` (world names,
 * in room-text order), `heroLost` (half hearts) and `ticks`. Throws (refused as
 * `unmappable_report`) on a round with no report or one naming a cell no world entity stood on.
 */
export function missionRoomOutcome(end: MiniGameEnd, mission: MissionDef): MissionReport {
  if (end.result === 'quit') return { outcome: mission.onQuit };
  const params = missionRoomParams(mission.params);
  if (end.report === null) throw new Error('the round gave no report');
  const report = end.report as MissionRoomReport;
  if (!Array.isArray(report.placed))
    throw new Error('the round\'s report has no "placed" list (is it a mission room?)');
  const byCell = new Map(report.placed.map((p) => [p.cell, p]));
  const named = (cells: readonly string[]) =>
    cells.map((cell) => {
      const placed = byCell.get(cell);
      if (placed === undefined)
        throw new Error(`the report names "${cell}", which is no entity of the world`);
      return placed;
    });
  const gone = named(report.defeated);
  const destroyed = gone.map((p) => p.name);
  const hurt = named(report.hurt).map((p) => p.name);
  const done = new Set(gone.flatMap((p) => [p.name, String(p.entity)]));
  const rule = params.outcomes.find((r) => holds(r, end.result, done, gone.length));
  if (rule === undefined) throw new Error('no outcome rule holds for the round');
  return {
    outcome: rule.outcome,
    stats: { destroyed, hurt, heroLost: report.hero.lost, ticks: end.ticks },
  };
}

/**
 * The kit's mission adapter for `mission-room` missions (`MissionAdapter<JsonObject,
 * MiniGameEnd>`, the shape `MissionHost` takes by mini game id): `input` is
 * {@link missionRoomInput}, `outcome` {@link missionRoomOutcome}. It keeps no state, so one serves
 * every round.
 */
export const topdownMissionAdapter: MissionAdapter<JsonObject, MiniGameEnd> = {
  input: (snapshot, mission) => missionRoomInput(snapshot, mission),
  outcome: (end, mission) => missionRoomOutcome(end, mission),
};

// ---- The round ----

/** What a game gives `missionRoom`: its rooms and the room challenge's options. */
export interface MissionRoomOptions extends Omit<
  RoomChallengeOptions,
  'id' | 'room' | 'foeHp' | 'title' | 'hostStatus'
> {
  /** The game's rooms (its `room` content) a mission may name. */
  rooms: readonly RoomDef[];
  /** The mini game's title ('MISSION' when left out; a host shows the mission's own title). */
  title?: string;
  /** The host HUD status keys the round shows (`['mission']`, the mission's title, by default). */
  hostStatus?: readonly string[];
}

/** One mission room round: a room challenge whose report also says where each entity stood. */
export class MissionRoomRound extends RoomChallenge {
  constructor(
    dungeon: Dungeon,
    opts: RoomChallengeOptions,
    ctx: MiniGameContext,
    seed: number,
    private readonly placed: readonly MissionRoomPlaced[],
  ) {
    super(dungeon, opts, ctx, seed);
  }

  override report(): MissionRoomReport {
    return { ...super.report(), placed: this.placed.map((p) => ({ ...p })) };
  }
}

/** The legend character that spawns `kind` (the kit's, then the game's), or throws. */
function spawnChar(kind: string, legend: Readonly<Record<string, LegendEntry>>): string {
  for (const [char, entry] of Object.entries(legend))
    if (entry.spawn === kind && entry.tile === 'floor') return char;
  throw new Error(`no legend character spawns "${kind}"`);
}

/** `room` with the foes in their slot cells (reading order) and spare slot cells as floor. */
function placeFoes(
  room: RoomDef,
  input: z.infer<typeof roundInputSchema>,
  legend: Readonly<Record<string, LegendEntry>>,
): { room: RoomDef; placed: MissionRoomPlaced[]; foeHp: Record<string, number> } {
  const queues = new Map(input.slots.map((s) => [s, input.foes.filter((f) => f.slot === s)]));
  for (const foe of input.foes)
    if (!queues.has(foe.slot))
      throw new Error(`foe "${foe.name}" names slot "${foe.slot}", which is not in "slots"`);
  const placed: MissionRoomPlaced[] = [];
  const foeHp: Record<string, number> = {};
  const map = room.map.map((line, row) =>
    [...line]
      .map((char, col) => {
        const queue = queues.get(char);
        if (queue === undefined) return char;
        const foe = queue.shift();
        if (foe === undefined) return '.';
        const cell = `${col},${row}`;
        placed.push({ cell, entity: foe.entity, name: foe.name });
        if (foe.hp !== undefined) foeHp[cell] = foe.hp;
        return spawnChar(foe.kind, legend);
      })
      .join(''),
  );
  for (const [slot, left] of queues)
    if (left.length > 0)
      throw new Error(
        `room "${room.id}" has too few "${slot}" cells: ${left.length} more foe(s) (${left.map((f) => f.name).join(', ')})`,
      );
  return { room: { ...room, map }, placed, foeHp };
}

/** Problems with a mission's params that need the rooms or the mission ({@link missionRoom}'s `checkUse`). */
export function missionRoomProblems(
  params: MissionRoomParams,
  rooms: readonly RoomDef[],
  mission: JsonObject | null,
): MiniGameUseProblem[] {
  const problems: MiniGameUseProblem[] = [];
  const room = rooms.find((r) => r.id === params.room);
  if (room === undefined)
    problems.push({
      path: ['room'],
      message: `no room "${params.room}" (the game has: ${rooms.map((r) => `"${r.id}"`).join(', ') || 'none'})`,
    });
  else
    params.foes.forEach((foe, i) => {
      if (!room.map.some((line) => line.includes(foe.slot)))
        problems.push({ path: ['foes', i, 'slot'], message: `room "${room.id}" has no "${foe.slot}" cell` });
    });
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
 * The `mission-room` mini game over the game's rooms. Its `paramsSchema` is
 * `missionRoomParamsSchema` (a mission's params, checked by `validate`), and its `checkUse` checks
 * that the room is one of `rooms`, each slot character is in it and each rule names an outcome the
 * mission declares. A round (`create`) takes the adapter's {@link MissionRoomInput}, not the
 * mission's params: it places the foes, then plays the room as a `RoomChallenge` with the room's
 * foes at their world hp (`hpPer`). Throws (no round starts) on an unknown room, a kind no legend
 * character spawns or more foes than slot cells.
 */
export function missionRoom(opts: MissionRoomOptions): MiniGameDef {
  const legend = { ...LEGEND, ...(opts.extraLegend ?? {}) };
  const { rooms, title, hostStatus, ...challenge } = opts;
  return {
    id: MISSION_ROOM,
    title: title ?? 'MISSION',
    paramsSchema: missionRoomParamsSchema,
    checkUse: ({ params, owner }) => missionRoomProblems(missionRoomParamsSchema.parse(params), rooms, owner),
    hostStatus: hostStatus ?? ['mission'],
    ...(opts.inputMap ? { inputMap: opts.inputMap } : {}),
    create: (ctx, seed) => {
      const parsed = roundInputSchema.safeParse(ctx.params);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        throw new Error(`mission room: input "${issue.path.map(String).join('.')}": ${issue.message}`);
      }
      const input = parsed.data;
      const base = rooms.find((r) => r.id === input.room);
      if (base === undefined) throw new Error(`mission room: no room "${input.room}"`);
      const { room, placed, foeHp } = placeFoes(base, input, legend);
      const dungeon = buildDungeon([room], opts.extraLegend ?? {}, { wall: opts.wall ?? 1 });
      const round: JsonObject = { goal: input.goal, ticks: input.ticks };
      if (input.hp !== undefined) round['hp'] = input.hp;
      return new MissionRoomRound(
        dungeon,
        { ...challenge, id: MISSION_ROOM, room, foeHp },
        { ...ctx, params: round },
        seed,
        placed,
      );
    },
  };
}
