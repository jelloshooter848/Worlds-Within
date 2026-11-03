import { z } from 'zod';
import { dottedPath, type FieldPath } from '../core/content/validate';
import type { JsonValue } from '../core/headless';
import { opportunitySchema } from '../core/missions';
import { applyCarried, carriedIssues, carryFromSchema, fromIssues, type CarriedRecord } from './carry';
import { Member, STANDARD_COMPONENTS, Squad, type Role } from './components';
import { keepKeys } from './keys';
import type { LogOptions } from './events';
import { addOpportunities } from './opportunity';
import { SYSTEM_SETS, SYSTEM_SET_NAMES } from './system-sets';
import { ScenarioError, type ScenarioIssue } from './scenario-error';
import { Terrain, type TerrainData, type TerrainType } from './terrain';
import { createWorld, type AnyComponent, type Entity, type System, type World } from './world';

/**
 * World-start files (see "Scenarios" in this folder's CLAUDE.md): a world written as data.
 *
 *   const world = worldFromScenario(JSON.parse(text), { components, systems });
 *
 * A scenario gives the seed, the terrain as a text grid (one character per cell, looked up in a
 * legend) with a grid of elevation digits, the entities with their components, and squads with
 * their named members. Component data may point at another entity of the file with
 * `{ "$ref": "<key>" }`, which becomes that entity's id.
 *
 * Ids are handed out in file order: the terrain entity first, then `entities`, then each squad
 * followed by its members. Every change is logged with the cause `scenario`, except opportunity
 * windows already open at tick 0, which `addOpportunities` opens under `time`.
 *
 * A scenario may follow another with `from` (Engine 0.13, `carry.ts`): pass the carried record
 * built from the first one's end world as `options.carried`, and it is applied last, under `carry`.
 */

/** The `format` every scenario carries. */
export const SCENARIO_FORMAT = 'worlds-within/scenario';
/** The scenario format version this engine reads. */
export const SCENARIO_VERSION = 1;

const Key = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -');
const ComponentName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'must be a letter followed by letters, digits or _');
const Components = z
  .record(ComponentName, z.json())
  .describe('components by name, each checked by its schema; `{ "$ref": "<key>" }` is an entity id');

/** The shape of a scenario file (`worldFromScenario` checks it, then the parts it refers to). */
export const scenarioSchema = z.strictObject({
  format: z.literal(SCENARIO_FORMAT).describe('always `worlds-within/scenario`'),
  version: z.literal(SCENARIO_VERSION).describe('the scenario format version'),
  seed: z.int().describe("the world's seed"),
  systems: z
    .enum(SYSTEM_SET_NAMES)
    .optional()
    .describe(
      'the engine system set the world runs with: `village` (haul, build, patrol) or `rts` (the RTS units and economy); the tools use `village` when left out',
    ),
  terrain: z
    .strictObject({
      legend: z
        .record(
          z.string().length(1),
          z.strictObject({
            name: Key.describe('the ground type name'),
            cost: z.int().min(1).describe('ticks to enter a cell of this type'),
            passable: z.boolean().describe('false: nothing can enter it'),
          }),
        )
        .describe('one ground type per grid character; types are numbered in sorted character order'),
      rows: z.array(z.string().min(1)).min(1).describe('the grid, one string per row, north first'),
      elevation: z
        .array(z.string().regex(/^[0-9]+$/, 'must be digits'))
        .describe('one elevation digit (0-9) per cell, the same size as `rows`'),
    })
    .describe('the terrain grid'),
  entities: z
    .array(
      z.strictObject({
        key: Key.optional().describe('a name other entities can `$ref`'),
        components: Components,
      }),
    )
    .default([])
    .describe('entities, spawned in this order'),
  squads: z
    .array(
      z.strictObject({
        key: Key.optional().describe('a name other entities can `$ref`'),
        strength: z.int().min(0).optional().describe('everyone in it; default: the named members'),
        components: Components.default({}).describe(
          "the squad entity's other components (not `Squad`, which is built from this entry)",
        ),
        members: z
          .array(
            z.strictObject({
              key: Key.optional().describe('a name other entities can `$ref`'),
              name: z.string().min(1).describe("the person's name"),
              role: z.enum(['regular', 'hero', 'captain']).describe('at most one captain per squad'),
              components: Components.default({}).describe('other components (not `Member`)'),
            }),
          )
          .default([])
          .describe('the named people, spawned right after their squad'),
      }),
    )
    .default([])
    .describe('squads, each spawned after the entities'),
  opportunities: z
    .array(opportunitySchema)
    .optional()
    .describe(
      'windows of world ticks in which a mission can be taken (Engine 0.10): `{ id, mission, opens, closes, exclusive?, closesOthers?, relative? }`; kept on a world-level entity spawned after the squads',
    ),
  from: carryFromSchema
    .optional()
    .describe(
      "the scenario this one follows (Engine 0.13): `{ scenario, carry: { people, stockpiles }, when? }`; a carried record built from that scenario's end world (`carriedRecord`) is applied at tick 0 under the cause `carry`; without one the scenario starts as written",
    ),
});

export type Scenario = z.infer<typeof scenarioSchema>;

export { ScenarioError };
export type { ScenarioIssue };

export interface ScenarioOptions {
  /**
   * The component kinds (default: those of the scenario's `systems` set, else the standard ones
   * and `Terrain`); must include `Terrain`.
   */
  readonly components?: readonly AnyComponent[];
  /** The world's systems, in run order (default: the scenario's `systems` set, else none). */
  readonly systems?: readonly System[];
  /** Event log retention (default: keep every change). */
  readonly log?: LogOptions;
  /**
   * A carried record (`carriedRecord`, Engine 0.13) built from the end world of the scenario this
   * one names in `from`; applied at tick 0 under the cause `carry`. Left out, the scenario starts as
   * written. Checked against `from` (errors under the path `carried`).
   */
  readonly carried?: unknown;
}

/** One component to add once every id is known and every value checked. */
interface Pending {
  id: Entity;
  def: AnyComponent;
  value: JsonValue;
}

/**
 * The world a scenario describes, at tick 0. Throws a `ScenarioError` naming each bad field when
 * the file does not match `scenarioSchema`, the grids disagree, a key is repeated or unknown, or a
 * component is unknown or fails its schema, `from` does not fit the scenario, or `options.carried`
 * does not fit `from` (paths under `carried`).
 */
export function worldFromScenario(json: unknown, options: ScenarioOptions = {}): World {
  const parsed = scenarioSchema.safeParse(json);
  if (!parsed.success) {
    throw new ScenarioError(
      parsed.error.issues.map((i) => ({ path: dottedPath(i.path as FieldPath), message: i.message })),
    );
  }
  const sc = parsed.data;
  const issues: ScenarioIssue[] = [];
  const at = (path: FieldPath, message: string) => issues.push({ path: dottedPath(path), message });

  const set = sc.systems === undefined ? null : SYSTEM_SETS[sc.systems];
  const components = options.components ?? set?.components ?? [...STANDARD_COMPONENTS, Terrain];
  const defs = new Map(components.map((d) => [d.name, d]));
  if (defs.get(Terrain.name) !== Terrain) at(['terrain'], 'the components must include Terrain');
  if (sc.squads.length > 0 && (defs.get(Squad.name) !== Squad || defs.get(Member.name) !== Member)) {
    at(['squads'], 'the components must include Squad and Member');
  }

  const terrain = buildTerrain(sc.terrain, at);
  if (terrain) {
    const result = Terrain.schema.safeParse(terrain);
    if (!result.success) for (const issue of result.error.issues) at(['terrain'], issue.message);
  }

  // Ids in file order: terrain, entities, then each squad followed by its members.
  const ids = new Map<string, Entity>();
  let next = 1;
  const claim = (key: string | undefined, path: FieldPath): Entity => {
    const id = ++next;
    if (key === undefined) return id;
    if (ids.has(key)) at([...path, 'key'], `key "${key}" is already used`);
    else ids.set(key, id);
    return id;
  };
  const entityIds = sc.entities.map((e, i) => claim(e.key, ['entities', i]));
  const squadIds = sc.squads.map((s, i) => ({
    id: claim(s.key, ['squads', i]),
    members: s.members.map((m, j) => claim(m.key, ['squads', i, 'members', j])),
  }));

  const pending: Pending[] = [];
  const check = (id: Entity, name: string, value: JsonValue, path: FieldPath): void => {
    const def = defs.get(name);
    if (!def) {
      at(path, `component "${name}" is not in the components given to worldFromScenario`);
      return;
    }
    const before = issues.length;
    const resolved = resolveRefs(value, ids, path, at);
    if (issues.length > before) return;
    const result = def.schema.safeParse(resolved);
    if (!result.success) {
      for (const issue of result.error.issues) at([...path, ...(issue.path as FieldPath)], issue.message);
      return;
    }
    pending.push({ id, def, value: resolved });
  };
  const checkAll = (id: Entity, given: Record<string, JsonValue>, path: FieldPath, built: string) => {
    for (const [name, value] of Object.entries(given)) {
      if (name === built) at([...path, name], `${built} is built from the scenario entry: leave it out`);
      else if (name === Terrain.name)
        at([...path, name], 'the terrain is given by `terrain`, not as a component');
      else check(id, name, value, [...path, name]);
    }
  };

  sc.entities.forEach((e, i) =>
    checkAll(entityIds[i] as Entity, e.components, ['entities', i, 'components'], ''),
  );
  sc.squads.forEach((s, i) => {
    const { id, members } = squadIds[i] as { id: Entity; members: Entity[] };
    const path = ['squads', i];
    checkAll(id, s.components, [...path, 'components'], Squad.name);
    const before = issues.length;
    const captains = s.members.flatMap((m, j) => (m.role === 'captain' ? [members[j] as Entity] : []));
    if (captains.length > 1) at([...path, 'members'], 'a squad has at most one captain');
    const strength = s.strength ?? s.members.length;
    if (strength < s.members.length) at([...path, 'strength'], 'is less than the named members');
    if (issues.length === before) {
      check(id, Squad.name, { strength, captain: captains[0] ?? null, members }, path);
    }
    s.members.forEach((m, j) => {
      const mid = members[j] as Entity;
      const role: Role = m.role;
      checkAll(mid, m.components, [...path, 'members', j, 'components'], Member.name);
      check(mid, Member.name, { name: m.name, squad: id, role }, [...path, 'members', j]);
    });
  });

  const opportunityIds = new Set<string>();
  (sc.opportunities ?? []).forEach((o, i) => {
    if (opportunityIds.has(o.id)) at(['opportunities', i, 'id'], `"${o.id}" is given twice`);
    opportunityIds.add(o.id);
  });
  (sc.opportunities ?? []).forEach((o, i) =>
    (o.closesOthers ?? []).forEach((other, j) => {
      if (!opportunityIds.has(other))
        at(['opportunities', i, 'closesOthers', j], `"${other}" is not an opportunity of the scenario`);
    }),
  );

  fromIssues(sc, at);
  let carried: CarriedRecord | null = null;
  if (options.carried !== undefined) carried = carriedIssues(sc, options.carried, at);

  if (issues.length > 0) throw new ScenarioError(issues);

  const world = createWorld(sc.seed, {
    components,
    systems: options.systems ?? set?.systems ?? [],
    ...(options.log ? { log: options.log } : {}),
  });
  world.withCause('scenario', (w) => {
    for (let id = 1; id <= next; id++) w.spawn();
    w.add(1, Terrain, terrain as TerrainData);
    pending.sort((a, b) => a.id - b.id);
    for (const p of pending) w.add(p.id, p.def, p.value);
  });
  if (sc.opportunities !== undefined && sc.opportunities.length > 0) {
    const added = addOpportunities(world, sc.opportunities, 'scenario');
    if (!added.ok) throw new ScenarioError([{ path: 'opportunities', message: added.error }]);
  }
  if (carried !== null && sc.from !== undefined) applyCarried(world, sc.from, carried, ids);
  // The key table stays with the world, outside its snapshot (Engine 0.15 T7, gaps M10 and D6).
  keepKeys(world, Object.fromEntries(ids));
  return world;
}

/**
 * The entity id each `key` of a scenario gets (`{ "$ref": "<key>" }` becomes it), in the same file
 * order `worldFromScenario` hands ids out: the terrain is 1, then `entities`, then each squad
 * followed by its members. A mission's effects name entities by these keys (`openMission`'s
 * `refs`). Empty when the file is not a scenario; a repeated key keeps its first id.
 */
export function scenarioKeys(json: unknown): Record<string, Entity> {
  const parsed = scenarioSchema.safeParse(json);
  if (!parsed.success) return {};
  const keys: Record<string, Entity> = {};
  let next = 1;
  const claim = (key: string | undefined) => {
    const id = ++next;
    if (key !== undefined && !Object.hasOwn(keys, key)) keys[key] = id;
  };
  for (const e of parsed.data.entities) claim(e.key);
  for (const s of parsed.data.squads) {
    claim(s.key);
    for (const m of s.members) claim(m.key);
  }
  return keys;
}

/** The terrain data from the scenario's grids, reporting any mismatch through `at`. */
function buildTerrain(
  src: Scenario['terrain'],
  at: (path: FieldPath, message: string) => void,
): TerrainData | null {
  const chars = Object.keys(src.legend).sort();
  const types: TerrainType[] = chars.map((c) => ({ ...(src.legend[c] as TerrainType) }));
  const names = types.map((t) => t.name);
  if (new Set(names).size !== names.length) at(['terrain', 'legend'], 'type names must be unique');
  const width = src.rows[0]?.length ?? 0;
  const cells: number[] = [];
  const elevation: number[] = [];
  src.rows.forEach((row, y) => {
    if (row.length !== width) at(['terrain', 'rows', y], `is ${row.length} wide, the first row is ${width}`);
    [...row].forEach((ch, x) => {
      const type = chars.indexOf(ch);
      if (type < 0) at(['terrain', 'rows', y], `character "${ch}" at x ${x} is not in the legend`);
      cells.push(Math.max(type, 0));
    });
  });
  if (src.elevation.length !== src.rows.length) {
    at(['terrain', 'elevation'], `has ${src.elevation.length} rows, the grid has ${src.rows.length}`);
  }
  src.elevation.forEach((row, y) => {
    if (row.length !== width) at(['terrain', 'elevation', y], `is ${row.length} wide, the grid is ${width}`);
    for (const ch of row) elevation.push(ch.charCodeAt(0) - 48);
  });
  if (cells.length !== width * src.rows.length || elevation.length !== cells.length) return null;
  return { width, height: src.rows.length, types, elevation, cells };
}

/** `value` with every `{ "$ref": "<key>" }` replaced by that key's entity id. */
function resolveRefs(
  value: JsonValue,
  ids: ReadonlyMap<string, Entity>,
  path: FieldPath,
  at: (path: FieldPath, message: string) => void,
): JsonValue {
  if (Array.isArray(value)) return value.map((v, i) => resolveRefs(v, ids, [...path, i], at));
  if (value === null || typeof value !== 'object') return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === '$ref') {
    const key = value.$ref;
    const id = typeof key === 'string' ? ids.get(key) : undefined;
    if (id === undefined) {
      at(path, `$ref ${JSON.stringify(key)} names no entity of the scenario`);
      return 0;
    }
    return id;
  }
  const out: { [k: string]: JsonValue } = {};
  for (const k of keys) out[k] = resolveRefs(value[k] as JsonValue, ids, [...path, k], at);
  return out;
}
