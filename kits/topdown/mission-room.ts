import { z } from 'zod';
import type { JsonObject, JsonValue } from '@engine/core/headless';
import {
  fateState,
  isLost,
  snapshotEntities,
  type MiniGameEnd,
  type SnapshotEntity,
} from '@engine/core/mission-adapter';
import type {
  MiniGameContext,
  MiniGameControl,
  MiniGameDef,
  MiniGameResult,
  MiniGameUseProblem,
  MiniGameWorldScenario,
} from '@engine/core/minigame';
import type { MissionAdapter, MissionDef, MissionReport } from '@engine/core/missions';
import type { PresentFrame } from '@engine/core/present';
import { CHALLENGE_TICKS, RoomChallenge, type ChallengeReport, type RoomChallengeOptions } from './challenge';
import { buildDungeon, LEGEND, type Dungeon, type LegendEntry, type RoomDef } from './room';

/**
 * The data-driven top-down mission (Engine 0.11 T7; docs/BUILD-LOG.md, Engine 0.11, decision 5,
 * item 176): a mission over a world (`engine/sim`) played as one top-down room, with no adapter
 * code in the game. Everything is in the mission file's `params` (`missionRoomParamsSchema`):
 *
 *   "play": "mission-room",
 *   "params": {
 *     "room": "siege-camp", "goal": "defeat-all", "ticks": 1200,
 *     "hero": { "select": { "faction": "village", "member": "captain" }, "hpPer": 20 },
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
 *   `Owner` faction, `Unit` type and squad `Member` role, living ones only, never one captured or
 *   dead, ascending id; an entity goes to the first entry that selects it), and, with `hero`
 *   (Engine 0.13, M13), the one world unit the room's hero is, its round hp from its `Health`,
 *   giving the round's params ({@link MissionRoomInput}). `outcome(end, mission)` maps the round's
 *   report back to world names and walks the `outcomes` rules in order: the first that holds names
 *   the outcome (a quit goes to `onQuit`); with a hero its stats say the world hp the round cost
 *   (`heroHpLost`), which an outcome's `damage` effect takes with `fromReport`.
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
  squad: NAME.exactOptional().describe(
    'only named members of this squad (`Member.squad`), named by its scenario key or entity id (Engine 0.15)',
  ),
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

/**
 * The world unit the room's hero is (Engine 0.13, M13; docs/BUILD-LOG.md, Engine 0.13, decision 4,
 * item 223). Its `select` is the foes' selector, except that `event` is not the mission's when
 * left out (a defender is seldom in the battle's event): any entity it picks.
 */
const heroSchema = z.strictObject({
  select: selectSchema
    .refine((s) => Object.keys(s).length > 0, {
      message: 'name an event, faction, types, member or squad: the hero is exactly one world unit',
    })
    .describe(
      "which world unit the hero is: exactly one living one, never captured or dead (`event` is any event when left out, not the mission's)",
    ),
  hpPer: z
    .int()
    .min(1)
    .describe(
      'world hit points per half heart: the hero starts on `Health.hp / hpPer` (rounded up, at least 1), and each half heart lost costs `hpPer` world hp (never the last one)',
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
      .describe("the hero's hit points in half hearts (the kit's default when left out); not with `hero`"),
    hero: heroSchema
      .exactOptional()
      .describe("the world unit the room's hero is, whose hp goes into the round and back (Engine 0.13)"),
    foes: z.array(foeSchema).min(1).describe('which world entities become which foes, in which slots'),
    outcomes: z
      .array(ruleSchema)
      .min(1)
      .describe('rules from the round to a declared outcome, tried in order; the first that holds wins'),
  })
  .superRefine((params, ctx) => {
    if (params.hero !== undefined && params.hp !== undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['hp'],
        message: "leave out `hp` with `hero`: the hero's hp comes from its world unit",
      });
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
  /**
   * The entity's scenario key from the world's key table when it differs from `name` (Engine 0.15
   * T7): a rule may name the foe by it. Never in a snapshot or a record.
   */
  key?: string;
}

/**
 * The world unit the room's hero is (with `hero`): its id and name, its `Health.hp` when the round
 * started and the mission's `hpPer`, so the round's report can say what it cost the world.
 */
export interface MissionRoomHero extends JsonObject {
  entity: number;
  name: string;
  worldHp: number;
  hpPer: number;
}

/** What the adapter gives the round: the room, goal and limits, and the picked foes in order. */
export interface MissionRoomInput extends JsonObject {
  room: string;
  goal: 'defeat-all' | 'reach';
  ticks: number;
  hp?: number;
  /** The world unit the hero is (with the params' `hero`); `hp` is then its round hp. */
  hero?: MissionRoomHero;
  /** Every slot character the mission names, so spare cells of each become floor. */
  slots: string[];
  foes: MissionRoomFoe[];
}

const roundInputSchema = z.strictObject({
  room: z.string().min(1),
  goal: z.enum(['defeat-all', 'reach']),
  ticks: z.int().min(1),
  hp: z.int().min(1).exactOptional(),
  hero: z
    .strictObject({
      entity: z.int(),
      name: z.string().min(1),
      worldHp: z.int().min(1),
      hpPer: z.int().min(1),
    })
    .exactOptional(),
  slots: z.array(z.string().length(1)),
  foes: z.array(
    z.strictObject({
      slot: z.string().length(1),
      kind: z.string().min(1),
      entity: z.int(),
      name: z.string().min(1),
      hp: z.int().min(1).exactOptional(),
      key: z.string().min(1).exactOptional(),
    }),
  ),
});

/** Which room cell holds which world entity (`"<col>,<row>"`, as the report's keys). */
export interface MissionRoomPlaced extends JsonObject {
  cell: string;
  entity: number;
  name: string;
  /** The foe's scenario key when it differs from `name` (Engine 0.15 T7). */
  key?: string;
}

/**
 * The round's report: the room challenge's, plus where each world entity stood and (with a world
 * hero) which world unit the hero was, its world hp at the start and the world hp the round cost.
 */
export interface MissionRoomReport extends ChallengeReport {
  placed: MissionRoomPlaced[];
  worldHero?: MissionRoomHero & { hpLost: number };
}

/**
 * The world hp a round cost its hero (decision 4): `lost` half hearts times `hpPer`, but never the
 * world unit's last hit point. The round never kills the world person: death and capture are
 * declared outcomes, never an accident of arithmetic.
 */
export function heroHpLost(hero: MissionRoomHero, lost: number): number {
  return Math.max(0, Math.min(lost * hero.hpPer, hero.worldHp - 1));
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

type Select = MissionRoomParams['foes'][number]['select'];

/** A world's key table (scenario key to entity id; `{}` when the host has none). */
type Keys = Readonly<Record<string, number>>;

/** The entity a world name stands for: a key in `keys`, or an id (a number or its digits). */
function entityNamed(name: string | number, keys: Keys): number | undefined {
  if (typeof name === 'number') return name;
  if (Object.hasOwn(keys, name)) return keys[name];
  return /^[1-9][0-9]*$/.test(name) ? Number(name) : undefined;
}

/** Each entity's first scenario key (sorted), from the key table. */
function keyByEntity(keys: Keys): Map<number, string> {
  const out = new Map<number, string>();
  for (const key of Object.keys(keys).sort()) if (!out.has(keys[key]!)) out.set(keys[key]!, key);
  return out;
}

/**
 * Whether entity `e` stands in the world to be picked: on the map (`Position`), not captured or
 * dead (`Fate`, by the data: decision 3), and, with `Health`, above 0 hp.
 */
function standing(e: SnapshotEntity): boolean {
  if (!('Position' in e.components) || isLost(e)) return false;
  const hp = field(e, 'Health', 'hp');
  return !(typeof hp === 'number' && hp <= 0);
}

/** Whether entity `e` is one `select` picks (`event` already resolved), standing or not. */
function matches(e: SnapshotEntity, select: Select, event: string | undefined, keys: Keys) {
  if (event !== undefined && field(e, 'EventMember', 'event') !== event) return false;
  if (select.faction !== undefined && field(e, 'Owner', 'faction') !== select.faction) return false;
  if (select.types !== undefined && !select.types.includes(field(e, 'Unit', 'type') as string)) return false;
  if (select.member !== undefined && field(e, 'Member', 'role') !== select.member) return false;
  if (select.squad !== undefined) {
    const squad = entityNamed(select.squad, keys);
    if (squad === undefined || field(e, 'Member', 'squad') !== squad) return false;
  }
  return true;
}

/** Whether entity `e` is one `select` picks: standing and matching it. */
function selects(e: SnapshotEntity, select: Select, event: string | undefined, keys: Keys) {
  return standing(e) && matches(e, select, event, keys);
}

/**
 * The one world unit the params' `hero` picks, with its round hp. Throws (the round does not
 * start) when it picks none, more than one, or only someone captured or dead, or one without
 * `Health`.
 */
function pickHero(
  entities: readonly SnapshotEntity[],
  hero: NonNullable<MissionRoomParams['hero']>,
  nameOf: (e: SnapshotEntity) => string,
  keys: Keys,
): MissionRoomHero {
  const picked = entities.filter((e) => matches(e, hero.select, hero.select.event, keys));
  const living = picked.filter(standing);
  if (living.length > 1)
    throw new Error(
      `hero.select picks ${living.length} world units (${living.map(nameOf).join(', ')}); it must pick exactly one`,
    );
  const e = living[0];
  if (e === undefined) {
    const lost = picked.find(isLost);
    if (lost !== undefined)
      throw new Error(`the hero "${nameOf(lost)}" is ${fateState(lost)}: the round cannot start`);
    throw new Error('hero.select picks no living world unit');
  }
  const hp = field(e, 'Health', 'hp');
  if (typeof hp !== 'number') throw new Error(`the hero "${nameOf(e)}" has no Health`);
  return { entity: e.id, name: nameOf(e), worldHp: hp, hpPer: hero.hpPer };
}

/**
 * The round's params from the plain world snapshot (`MissionAdapter.input`). Throws (the host
 * refuses the round as `bad_mission_input`) on malformed params, or when a rule names a world
 * entity that is not one of the round's foes (it could never be destroyed in the round).
 *
 * `keys` (Engine 0.15 T7, gaps M10 and D6) is the world's key table: a `squad` selector and the
 * rules' `destroyed` and `spared` may name any keyed entity, not only those the mission's effects
 * name. A foe's name (in the report and the record) stays the open mission's `refs` key, else its
 * id; its table key, when another, rides along as `key`, so no record changes.
 */
export function missionRoomInput(
  snapshot: JsonObject,
  mission: Pick<MissionDef, 'id' | 'params' | 'event'>,
  keys: Keys = {},
): MissionRoomInput {
  const params = missionRoomParams(mission.params);
  const names = namesOf(snapshot, mission.id);
  const tableKeys = keyByEntity(keys);
  const entities = snapshotEntities(snapshot);
  const nameOf = (e: SnapshotEntity) => names.get(e.id) ?? String(e.id);
  const hero = params.hero === undefined ? null : pickHero(entities, params.hero, nameOf, keys);
  // The hero is never also one of the foes.
  const taken = new Set<number>(hero === null ? [] : [hero.entity]);
  const foes: MissionRoomFoe[] = [];
  for (const entry of params.foes) {
    const event = entry.select.event ?? mission.event;
    for (const e of entities) {
      if (taken.has(e.id) || !selects(e, entry.select, event, keys)) continue;
      taken.add(e.id);
      const foe: MissionRoomFoe = {
        slot: entry.slot,
        kind: entry.kind,
        entity: e.id,
        name: nameOf(e),
      };
      const key = tableKeys.get(e.id);
      if (key !== undefined && key !== foe.name) foe.key = key;
      const hp = field(e, 'Health', 'hp');
      if (entry.hpPer !== undefined && typeof hp === 'number')
        foe.hp = Math.max(1, Math.ceil(hp / entry.hpPer));
      foes.push(foe);
    }
  }
  const known = new Set(foes.flatMap(foeNames));
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
  if (hero !== null) {
    input.hero = hero;
    input.hp = Math.max(1, Math.ceil(hero.worldHp / hero.hpPer));
  }
  return input;
}

/** Every world name a foe answers to: its name, its id and its table key. */
const foeNames = (f: { name: string; entity: number; key?: string }): string[] =>
  f.key === undefined ? [f.name, String(f.entity)] : [f.name, String(f.entity), f.key];

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
 * in room-text order), `heroLost` (half hearts) and `ticks`, and with a world hero (Engine 0.13)
 * `hero` (its world name) and `heroHpLost` (the world hp the round cost it, {@link heroHpLost}).
 * Throws (refused as
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
  const done = new Set(gone.flatMap(foeNames));
  const rule = params.outcomes.find((r) => holds(r, end.result, done, gone.length));
  if (rule === undefined) throw new Error('no outcome rule holds for the round');
  const stats: JsonObject = { destroyed, hurt, heroLost: report.hero.lost, ticks: end.ticks };
  if (report.worldHero !== undefined) {
    stats['hero'] = report.worldHero.name;
    stats['heroHpLost'] = report.worldHero.hpLost;
  }
  return { outcome: rule.outcome, stats };
}

/**
 * The kit's mission adapter for `mission-room` missions (`MissionAdapter<JsonObject,
 * MiniGameEnd>`, the shape `MissionHost` takes by mini game id): `input` is
 * {@link missionRoomInput}, `outcome` {@link missionRoomOutcome}. It keeps no state, so one serves
 * every round.
 */
export const topdownMissionAdapter: MissionAdapter<JsonObject, MiniGameEnd> = {
  input: (snapshot, mission, keys) => missionRoomInput(snapshot, mission, keys),
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
    private readonly hero: MissionRoomHero | null = null,
  ) {
    super(dungeon, opts, ctx, seed);
  }

  override report(): MissionRoomReport {
    const base = super.report();
    const report: MissionRoomReport = { ...base, placed: this.placed.map((p) => ({ ...p })) };
    if (this.hero !== null)
      report.worldHero = { ...this.hero, hpLost: heroHpLost(this.hero, base.hero.lost) };
    return report;
  }

  /**
   * The challenge's frame with each placed foe tagged `foe:<name>` (Engine 0.11 T9), its world name
   * (`ram`, or an id such as `23`), so a skin can draw a world entity its own way by tag (the mini
   * siege's ram and catapult in the room) while the kit spawns them all as one kind. A foe is found
   * by its presented id, `<room>/<kind>@<cell>`, which keeps its start cell as it moves; its parts
   * (`<id>/stun`) are left as they are.
   */
  override present(): PresentFrame {
    const frame = super.present();
    const names = new Map(this.placed.map((p) => [p.cell, p.name]));
    for (const e of frame.entities) {
      const at = e.id.lastIndexOf('@');
      if (at < 0 || e.id.includes('/', at)) continue;
      const name = names.get(e.id.slice(at + 1));
      if (name !== undefined) e.tags.push(`foe:${name}`);
    }
    return frame;
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
        placed.push({ cell, entity: foe.entity, name: foe.name, ...(foe.key ? { key: foe.key } : {}) });
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

/**
 * Problems with a mission's selectors in one world scenario it is offered in (Engine 0.15 T7,
 * lesson D7): a `foes` entry or the `hero` picking no standing entity there, a `squad` or a rule's
 * name that is no key of the scenario, and anything else the adapter would refuse the round for.
 */
function scenarioProblems(
  params: MissionRoomParams,
  mission: JsonObject,
  scenario: MiniGameWorldScenario,
): MiniGameUseProblem[] {
  const problems: MiniGameUseProblem[] = [];
  const { file, keys } = scenario;
  const entities = snapshotEntities(scenario.snapshot);
  const event = typeof mission['event'] === 'string' ? mission['event'] : undefined;
  const unknownName = (name: string | number) =>
    typeof name === 'string' && entityNamed(name, keys) === undefined;
  params.foes.forEach((entry, i) => {
    const squad = entry.select.squad;
    if (squad !== undefined && unknownName(squad))
      problems.push({ path: ['foes', i, 'select', 'squad'], message: `"${squad}" is no key of ${file}` });
    else if (!entities.some((e) => selects(e, entry.select, entry.select.event ?? event, keys)))
      problems.push({ path: ['foes', i, 'select'], message: `picks no standing world entity in ${file}` });
  });
  if (params.hero !== undefined) {
    const squad = params.hero.select.squad;
    if (squad !== undefined && unknownName(squad))
      problems.push({ path: ['hero', 'select', 'squad'], message: `"${squad}" is no key of ${file}` });
    else
      try {
        pickHero(entities, params.hero, (e) => String(e.id), keys);
      } catch (err) {
        problems.push({ path: ['hero', 'select'], message: `${(err as Error).message} in ${file}` });
      }
  }
  params.outcomes.forEach((rule, i) => {
    for (const field of ['destroyed', 'spared'] as const)
      (rule.when?.[field] ?? []).forEach((name, j) => {
        if (unknownName(name))
          problems.push({
            path: ['outcomes', i, 'when', field, j],
            message: `"${name}" is no key of ${file}`,
          });
      });
  });
  if (problems.length > 0) return problems;
  try {
    const id = typeof mission['id'] === 'string' ? mission['id'] : '';
    missionRoomInput(
      scenario.snapshot,
      { id, params: params as JsonObject, ...(event !== undefined ? { event } : {}) },
      keys,
    );
  } catch (err) {
    problems.push({ path: [], message: `in ${file}: ${(err as Error).message}` });
  }
  return problems;
}

/**
 * Problems with a mission's params that need the rooms or the mission ({@link missionRoom}'s
 * `checkUse`), and (Engine 0.15 T7, lesson D7) with its selectors in each world scenario that
 * offers it (`scenarios`, from `validate`).
 */
export function missionRoomProblems(
  params: MissionRoomParams,
  rooms: readonly RoomDef[],
  mission: JsonObject | null,
  scenarios: readonly MiniGameWorldScenario[] = [],
): MiniGameUseProblem[] {
  const problems: MiniGameUseProblem[] = [];
  if (mission !== null) for (const sc of scenarios) problems.push(...scenarioProblems(params, mission, sc));
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
    // A `damage` effect taking its amount from the report must name a number the round reports.
    const stats = params.hero === undefined ? ['heroLost', 'ticks'] : ['heroLost', 'heroHpLost', 'ticks'];
    for (const o of outcomes) {
      const effects = record(o)?.['effects'];
      for (const effect of Array.isArray(effects) ? effects : []) {
        const from = record(effect)?.['fromReport'];
        if (typeof from !== 'string' || stats.includes(from)) continue;
        problems.push({
          path: from === 'heroHpLost' ? ['hero'] : [],
          message:
            from === 'heroHpLost'
              ? `outcome "${String(record(o)?.['id'])}" takes damage from "heroHpLost", which only a round with \`hero\` reports`
              : `outcome "${String(record(o)?.['id'])}" takes damage from "${from}", which a mission room never reports (it has ${stats.map((n) => `"${n}"`).join(', ')})`,
        });
      }
    }
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
 * that the room is one of `rooms`, each slot character is in it, each rule names an outcome the
 * mission declares and each `damage` effect's `fromReport` names a number the round reports
 * (`heroHpLost` only with `hero`). Which world unit the hero is can only be checked when the round
 * starts. A round (`create`) takes the adapter's {@link MissionRoomInput}, not the
 * mission's params: it places the foes, then plays the room as a `RoomChallenge` with the room's
 * foes at their world hp (`hpPer`) and, with a world hero, the hero at its round hp and the report's
 * `worldHero`. Throws (no round starts) on an unknown room, a kind no legend
 * character spawns or more foes than slot cells.
 */
/**
 * The mission room's controls (Engine 0.15 T10, lesson D14), for the page's key hint: the hero
 * moves and strikes (the room challenge's hero), and select gives up (the round ends `quit`).
 */
export const MISSION_ROOM_CONTROLS: readonly MiniGameControl[] = [
  { actions: ['left', 'right', 'up', 'down'], label: 'move' },
  { actions: ['attack'], label: 'strike' },
  { actions: ['select'], label: 'give up' },
];

export function missionRoom(opts: MissionRoomOptions): MiniGameDef {
  const legend = { ...LEGEND, ...(opts.extraLegend ?? {}) };
  const { rooms, title, hostStatus, ...challenge } = opts;
  return {
    id: MISSION_ROOM,
    title: title ?? 'MISSION',
    paramsSchema: missionRoomParamsSchema,
    checkUse: ({ params, owner, scenarios }) =>
      missionRoomProblems(missionRoomParamsSchema.parse(params), rooms, owner, scenarios),
    hostStatus: hostStatus ?? ['mission'],
    ...(opts.inputMap ? { inputMap: opts.inputMap } : {}),
    controls: MISSION_ROOM_CONTROLS,
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
        input.hero ?? null,
      );
    },
  };
}
