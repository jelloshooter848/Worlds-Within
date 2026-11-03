import { z } from 'zod';
import { dottedPath, type FieldPath } from '../core/content/validate';
import type { JsonObject, JsonValue } from '../core/headless';
import { canonicalJson } from '../core/headless';
import type { Change } from './events';
import type { AnyComponent, Entity, RestoredState, System, World } from './world';
import { keepKeys, worldKeys } from './keys';
import { makeWorld, worldInternals } from './world';

/**
 * Save and load the whole world as JSON (see "Save and load" in this folder's CLAUDE.md).
 *
 *   const json = saveWorld(world);                       // JSON-safe data: write it out as text
 *   const back = loadWorld(json, { components: STANDARD_COMPONENTS, systems });
 *   back.canonical() === world.canonical();              // and it steps on identically
 *
 * A save holds the data: seed, tick, RNG state, the next entity id, every entity with its
 * components (in id order), the registered component kinds, the system names in run order and the
 * event log with its retention. Systems are code, never saved: `loadWorld` takes the same list and
 * checks the names against the save. Systems keep no state of their own (what they need to
 * remember is component data), so there is no system state to save.
 */

/** The `format` every world save carries. */
export const SAVE_FORMAT = 'worlds-within/world';
/** The save format version this engine writes and reads. */
export const SAVE_VERSION = 1;

const ComponentName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'must be a letter followed by letters, digits or _');
const EntityId = z.int().min(1).max(Number.MAX_SAFE_INTEGER);
const Cause = z
  .string()
  .min(1)
  .refine((s) => s.trim() === s, 'must not start or end with a space');

/** One event log entry (`Change`), as a save and a dump file hold it. */
export const changeSchema = z
  .strictObject({
    tick: z.int().min(0).describe('the tick the change was made at'),
    cause: Cause.describe('who made it: a system name, `external`, `order:<id>`, `scenario`, ...'),
    op: z.enum(['spawn', 'destroy', 'add', 'set', 'remove']).describe('what it did'),
    entity: EntityId.describe('the entity changed'),
    component: ComponentName.optional().describe('the component, for add, set and remove'),
    before: z.json().optional().describe('the data before, for set and remove'),
    value: z.json().optional().describe('the data after, for add and set'),
  })
  .superRefine((c, ctx) => {
    const wants: readonly string[] = {
      spawn: [],
      destroy: [],
      add: ['component', 'value'],
      set: ['component', 'before', 'value'],
      remove: ['component', 'before'],
    }[c.op];
    for (const field of ['component', 'before', 'value'] as const) {
      const has = c[field] !== undefined;
      if (has !== wants.includes(field)) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: has ? `a ${c.op} change has no ${field}` : `a ${c.op} change needs ${field}`,
        });
      }
    }
  });

/** The shape of a world save file (`saveWorld` writes it, `loadWorld` checks it). */
export const worldSaveSchema = z.strictObject({
  format: z.literal(SAVE_FORMAT).describe('always `worlds-within/world`'),
  version: z.literal(SAVE_VERSION).describe('the save format version'),
  seed: z.int().describe('the seed the world was created with'),
  tick: z.int().min(0).describe('ticks committed so far'),
  nextId: EntityId.describe('the id the next spawn returns; never below an id already used'),
  rng: z.int().min(1).max(0xffffffff).describe("the world RNG's state (`Rng.state()`)"),
  components: z.array(ComponentName).describe('the registered component kinds, sorted'),
  systems: z.array(z.string()).describe('the system names in run order (systems are code, not saved)'),
  entities: z
    .array(
      z.strictObject({
        id: EntityId.describe('the entity id'),
        components: z
          .record(ComponentName, z.json())
          .describe("the entity's components by name, each checked by that component's schema"),
      }),
    )
    .describe('every live entity, ascending by id (terrain is the `Terrain` component of one of them)'),
  log: z
    .strictObject({
      enabled: z.boolean().describe('false when the world records no log'),
      ticks: z
        .int()
        .min(0)
        .nullable()
        .describe('keep only the last n committed ticks of changes; null keeps everything'),
      events: z.array(changeSchema).describe('the kept changes, oldest first'),
    })
    .describe('the event log and its retention'),
  keys: z
    .record(z.string().min(1), EntityId)
    .optional()
    .describe(
      "the world's key table (Engine 0.15): each scenario key and its entity id, sorted; left out when the world has none",
    ),
});

export type WorldSave = z.infer<typeof worldSaveSchema>;

/** One problem with a save file: the field (dotted, `''` for the whole file) and what is wrong. */
export interface SaveIssue {
  path: string;
  message: string;
}

/** Thrown by `loadWorld` for a save it cannot read. Its message names every bad field. */
export class SaveError extends Error {
  readonly issues: readonly SaveIssue[];
  constructor(issues: readonly SaveIssue[]) {
    super(`invalid world save:\n${issues.map((i) => `  ${i.path || '(file)'}: ${i.message}`).join('\n')}`);
    this.name = 'SaveError';
    this.issues = issues;
  }
}

/**
 * The whole world as JSON-safe data. `canonicalJson(saveWorld(w))` is the same text for equal
 * worlds, and save -> load -> save gives the same text again. Throws during a step (a step's
 * changes are not committed yet).
 */
export function saveWorld(world: World): JsonObject {
  const inner = worldInternals(world);
  if (inner.stepping()) throw new Error('saveWorld() called during a step: save between ticks');
  const snap = world.snapshot();
  const events = world.events();
  // The snapshot leaves out an empty `omitWhenEmpty` kind; one the kept log still names is listed.
  const listed = new Set(Object.keys(snap.components));
  for (const change of events) if (change.component !== undefined) listed.add(change.component);
  const names = [...listed].sort();
  const byEntity = new Map<Entity, { [name: string]: JsonValue }>(snap.entities.map((id) => [id, {}]));
  for (const name of names) {
    for (const [id, data] of snap.components[name] ?? []) (byEntity.get(id) as JsonObject)[name] = data;
  }
  const save: WorldSave = {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    seed: snap.seed,
    tick: snap.tick,
    nextId: snap.nextId,
    rng: snap.rng,
    components: names,
    systems: world.systems(),
    entities: snap.entities.map((id) => ({ id, components: byEntity.get(id) as JsonObject })),
    log: {
      enabled: inner.log.enabled,
      ticks: inner.log.ticks ?? null,
      events: events.map((c) => structuredClone(c)),
    },
  };
  const keys = worldKeys(world);
  if (Object.keys(keys).length > 0) save.keys = { ...keys };
  return save as JsonObject;
}

export interface LoadOptions {
  /** The component kinds: every kind the save lists must be here (extra kinds start empty). */
  readonly components: readonly AnyComponent[];
  /** The same systems, in the same order, as the saved world had (checked by name). */
  readonly systems?: readonly System[];
}

/**
 * A world rebuilt from `json` (what `saveWorld` returned, or that text parsed). It is in the same
 * state as the saved world (equal snapshots, RNG, next id, tick and event log) and steps on
 * exactly as the saved world would. Throws a `SaveError` naming each bad field when the file does
 * not match the save format, a component's schema, or the given components and systems.
 */
export function loadWorld(json: unknown, options: LoadOptions): World {
  const parsed = worldSaveSchema.safeParse(json);
  if (!parsed.success) {
    throw new SaveError(
      parsed.error.issues.map((i) => ({ path: dottedPath(i.path as FieldPath), message: i.message })),
    );
  }
  const save = parsed.data;
  const issues: SaveIssue[] = [];
  const at = (path: FieldPath, message: string) => issues.push({ path: dottedPath(path), message });

  const defs = new Map(options.components.map((d) => [d.name, d]));
  save.components.forEach((name, i) => {
    if (!defs.has(name))
      at(['components', i], `component "${name}" is not in the components given to loadWorld`);
    if (i > 0 && (save.components[i - 1] as string) >= name)
      at(['components', i], 'must be sorted and unique');
  });

  const systemNames = (options.systems ?? []).map((s) => s.name);
  if (canonicalJson(systemNames) !== canonicalJson(save.systems)) {
    at(
      ['systems'],
      `the save ran ${JSON.stringify(save.systems)}, loadWorld was given ${JSON.stringify(systemNames)}`,
    );
  }

  const listed = new Set(save.components);
  const data = new Map<string, Map<Entity, JsonValue>>(save.components.map((n) => [n, new Map()]));
  save.entities.forEach((entity, i) => {
    const prev = i > 0 ? (save.entities[i - 1] as { id: number }).id : 0;
    if (entity.id <= prev) at(['entities', i, 'id'], `must be above the previous id (${prev})`);
    if (entity.id >= save.nextId) at(['entities', i, 'id'], `must be below nextId (${save.nextId})`);
    for (const [name, value] of Object.entries(entity.components)) {
      const path = ['entities', i, 'components', name];
      const def = defs.get(name);
      if (!listed.has(name) || !def) {
        at(path, `component "${name}" is not in the save's components list`);
        continue;
      }
      const result = def.schema.safeParse(value);
      if (!result.success) {
        for (const issue of result.error.issues) at([...path, ...(issue.path as FieldPath)], issue.message);
        continue;
      }
      data.get(name)?.set(entity.id, result.data);
    }
  });

  for (const [key, id] of Object.entries(save.keys ?? {}))
    if (id >= save.nextId) at(['keys', key], `must be below nextId (${save.nextId})`);

  const { log } = save;
  if (!log.enabled && log.events.length > 0) at(['log', 'events'], 'must be empty when the log is disabled');
  log.events.forEach((change, i) => {
    const path = ['log', 'events', i];
    if (change.tick > save.tick) at([...path, 'tick'], `is after the world's tick (${save.tick})`);
    const prev = i > 0 ? (log.events[i - 1] as Change).tick : 0;
    if (change.tick < prev) at([...path, 'tick'], `is before the previous change's tick (${prev})`);
    if (change.entity >= save.nextId) at([...path, 'entity'], `must be below nextId (${save.nextId})`);
    if (change.component !== undefined && !listed.has(change.component)) {
      at([...path, 'component'], `component "${change.component}" is not in the save's components list`);
    }
  });

  if (issues.length > 0) throw new SaveError(issues);

  const restored: RestoredState = {
    tick: save.tick,
    nextId: save.nextId,
    rng: save.rng,
    entities: save.entities.map((e) => e.id),
    data,
    log: log.events as Change[],
  };
  const world = makeWorld(
    save.seed,
    {
      components: options.components,
      systems: options.systems ?? [],
      log: log.enabled ? (log.ticks === null ? {} : { ticks: log.ticks }) : { enabled: false },
    },
    restored,
  );
  if (save.keys !== undefined) keepKeys(world, save.keys);
  return world;
}
