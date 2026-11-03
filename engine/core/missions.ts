import { z } from 'zod';
import type { JsonObject } from './headless';
import { dottedPath } from './content/validate';

/**
 * Missions as plain JSON data (docs/BUILD-LOG.md, Engine 0.10, items 153-154): the contract that
 * lets one world be played through many genres. Defined here in `engine/core`, the one layer both
 * `engine/sim` (which opens, delegates and commits missions) and kits (which play them) may import.
 *
 *   {
 *     "id": "raid", "title": "Burn the siege engines", "event": "siege", "worldTimeCost": 30,
 *     "play": "sabotage", "params": { "engines": 3 }, "onQuit": "repelled",
 *     "outcomes": [
 *       { "id": "clean", "title": "All three burnt", "weight": 1,
 *         "effects": [{ "type": "destroy", "entity": "ram" }, { "type": "destroy", "entity": "tower" }] },
 *       { "id": "partial", "title": "Two of three burnt", "weight": 2,
 *         "effects": [{ "type": "destroy", "entity": "ram" }] },
 *       { "id": "repelled", "title": "Driven off", "weight": 1,
 *         "effects": [{ "type": "opportunity", "open": "rescue" }] }
 *     ]
 *   }
 *
 * A mission declares its whole outcome space up front: a played mission commits the outcome its
 * kit's report names (through a {@link MissionAdapter}), a delegated one draws an outcome by weight
 * with the world's RNG ({@link pickOutcome}). Either way the effects are the outcome's declared ones.
 * There are no retries (no `attempt`): a mission ends in one of its outcomes, and quitting a played
 * one commits `onQuit`. A mission with no `play` (Engine 0.13, decision 2) is a choice with a
 * record, such as paying a ransom: it is only delegated (playing or quitting it is refused). Its world-time cost is fixed by `worldTimeCost` when it opens. The
 * lifecycle (open, play or delegate, commit, frozen events) is `engine/sim`'s.
 */

/** A mission, outcome, event, opportunity or mini game id: lower-case letters, digits and "-". */
const Id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'must be lower-case letters, digits and "-"');
/** An entity an effect acts on: a scenario `key` (what `$ref` names) or a world entity id. */
const EntityRef = z.union([
  z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -'),
  z.int().min(1),
]);
const ComponentName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'must be a letter followed by letters, digits or _');

/**
 * Lower `Health.hp` by `amount` (never below 0). With `fromReport` (Engine 0.13, decision 4, item
 * 223) a played mission takes the amount from that stat of its record's report instead (a whole
 * number; 0 skips the effect), so a round's real cost comes back to the world while every effect
 * stays declared; delegated, quit and timed-out missions have no report and use `amount`.
 */
export const damageEffectSchema = z.strictObject({
  type: z.literal('damage'),
  entity: EntityRef.describe('the entity hit: a scenario key or an entity id'),
  amount: z
    .int()
    .min(1)
    .describe('hit points taken off (with `fromReport`, only when the mission was not played)'),
  fromReport: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -')
    .exactOptional()
    .describe(
      "a stat of the played round's report (e.g. `heroHpLost`) the amount is taken from when the mission was played (0 skips the effect); `amount` when it was delegated, quit or timed out",
    ),
});

/** Remove an entity from the world. */
export const destroyEffectSchema = z.strictObject({
  type: z.literal('destroy'),
  entity: EntityRef.describe('the entity removed: a scenario key or an entity id'),
});

/** Add to (or, negative, take from) an entity's inventory, never below 0. */
export const inventoryEffectSchema = z.strictObject({
  type: z.literal('inventory'),
  entity: EntityRef.describe('whose inventory: a scenario key or an entity id'),
  item: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -')
    .describe('the item, as the inventory names it'),
  add: z
    .int()
    .refine((n) => n !== 0, { message: 'must not be 0' })
    .describe('how many to add; negative takes away'),
});

/** Merge `values` into one of an entity's components (checked against the component's schema). */
export const setEffectSchema = z.strictObject({
  type: z.literal('set'),
  entity: EntityRef.describe('the entity changed: a scenario key or an entity id'),
  component: ComponentName.describe('the component to change, by name'),
  values: z.record(z.string(), z.json()).describe('the fields to set, merged into the component'),
});

/** Open or close an opportunity (exactly one of `open` and `close`). */
export const opportunityEffectSchema = z
  .strictObject({
    type: z.literal('opportunity'),
    open: Id.exactOptional().describe('the opportunity to open'),
    close: Id.exactOptional().describe('the opportunity to close'),
  })
  .superRefine((e, ctx) => {
    if ((e.open === undefined) === (e.close === undefined))
      ctx.addIssue({
        code: 'custom',
        message: 'give exactly one of "open" and "close"',
        params: { code: 'bad_effect' },
      });
  });

/** The fates a `fate` effect can set (`engine/sim/fate.ts`; a person with no fate is active). */
export const MISSION_FATES = ['injured', 'captured', 'freed', 'dead'] as const;
export type MissionFate = (typeof MISSION_FATES)[number];

/**
 * Move a named person's fate forward (Engine 0.13, decision 2, item 221): `injured`, `captured`,
 * `freed` (back on the map at `at`, which it needs and only it may have) or `dead`. A person who
 * is gone, not named, or whose fate cannot move there (a death is final; a captive cannot be
 * injured) is skipped at the commit, never an error.
 */
export const fateEffectSchema = z
  .strictObject({
    type: z.literal('fate'),
    entity: EntityRef.describe('the named person: a scenario key or an entity id'),
    fate: z.enum(MISSION_FATES).describe('the fate they reach: injured, captured, freed or dead'),
    by: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -')
      .exactOptional()
      .describe('the faction that captured, killed or freed them'),
    at: z
      .strictObject({ x: z.int(), y: z.int() })
      .exactOptional()
      .describe('for "freed" only (and required then): the cell they are put back on'),
  })
  .superRefine((e, ctx) => {
    if ((e.fate === 'freed') !== (e.at !== undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['at'],
        message:
          e.fate === 'freed' ? '"freed" needs a cell, "at"' : `only "freed" takes "at", not "${e.fate}"`,
        params: { code: 'bad_effect' },
      });
  });

/** One world change an outcome makes at the commit, told apart by `type`. */
export const missionEffectSchema = z.discriminatedUnion('type', [
  damageEffectSchema,
  destroyEffectSchema,
  inventoryEffectSchema,
  setEffectSchema,
  opportunityEffectSchema,
  fateEffectSchema,
]);

/** One declared outcome. */
export const missionOutcomeSchema = z.strictObject({
  id: Id.describe('the outcome id, unique in the mission; a kit report names it'),
  title: z.string().min(1).describe('a short line for a report card, e.g. "Two of three burnt"'),
  weight: z
    .int()
    .min(1)
    .default(1)
    .describe('its share when the mission is delegated (whole number, at least 1)'),
  effects: z
    .array(missionEffectSchema)
    .default([])
    .describe(
      'the world changes it makes at the commit, in this order, each told apart by `type`: `damage` `{ entity, amount, fromReport? }`, `destroy` `{ entity }`, `inventory` `{ entity, item, add }`, `set` `{ entity, component, values }`, `opportunity` `{ open }` or `{ close }`, `fate` `{ entity, fate, by?, at? }` (`fate` injured, captured, freed or dead; `at`, a cell `{ x, y }`, on freed only and required there); `entity` is a scenario key or an entity id',
    ),
});

function idIssues(
  ctx: z.RefinementCtx,
  ids: readonly string[],
  field: string,
  known: ReadonlySet<string> | null,
  dupCode: string,
): void {
  const seen = new Set<string>();
  ids.forEach((id, i) => {
    const path = known === null ? [field, i, 'id'] : [field, i];
    if (seen.has(id))
      ctx.addIssue({ code: 'custom', path, message: `"${id}" is given twice`, params: { code: dupCode } });
    seen.add(id);
    if (known !== null && !known.has(id))
      ctx.addIssue({
        code: 'custom',
        path,
        message: `"${id}" is not one of the mission's outcomes`,
        params: { code: 'unknown_outcome' },
      });
  });
}

/** A mission definition: the `mission` content kind (`*.mission.json`). */
export const missionSchema = z
  .strictObject({
    id: Id.describe('the mission id; the same as the file name'),
    title: z.string().min(1).describe('shown when the mission is offered'),
    event: Id.exactOptional().describe(
      'the event it belongs to, held frozen while it is open; none freezes nothing',
    ),
    marker: z
      .string()
      .min(1)
      .exactOptional()
      .describe(
        "the scenario key of the entity the offer marker stands over (Engine 0.15); left out, the kit's own choice (the RTS kit: a unit of the mission's event)",
      ),
    worldTimeCost: z
      .int()
      .min(1)
      .describe('world ticks between opening and the commit, fixed when it opens (whole number, at least 1)'),
    play: Id.exactOptional().describe(
      'the mini game (or kit round) a player plays it with; left out, the mission is a choice that is only delegated',
    ),
    params: z
      .record(z.string(), z.json())
      .exactOptional()
      .describe('data handed to the mini game, checked by its params schema'),
    outcomes: z
      .array(missionOutcomeSchema)
      .min(1)
      .describe('the declared outcome space, in the order delegation walks it'),
    onQuit: Id.describe('the outcome a played mission commits when the player quits'),
    playable: z
      .array(Id)
      .min(1)
      .exactOptional()
      .describe('the outcomes a player can reach by playing; all of them when left out'),
  })
  .superRefine((m, ctx) => {
    const ids = m.outcomes.map((o) => o.id);
    idIssues(ctx, ids, 'outcomes', null, 'duplicate_outcome');
    const known = new Set(ids);
    if (!known.has(m.onQuit))
      ctx.addIssue({
        code: 'custom',
        path: ['onQuit'],
        message: `"${m.onQuit}" is not one of the mission's outcomes`,
        params: { code: 'unknown_outcome' },
      });
    if (m.playable) idIssues(ctx, m.playable, 'playable', known, 'duplicate_outcome');
  });

/**
 * An opportunity (decision 6, item 155): a window of world ticks in which a mission can be taken,
 * `opens <= tick < closes`. Taking it (opening its mission while it is offered) closes every other
 * opportunity in its `exclusive` group and every id in `closesOthers`. A `relative` one waits until
 * an `opportunity` effect opens it, and its `opens` and `closes` then count from that commit tick
 * (a failure opening a rescue). The window itself is `engine/sim`'s (`opportunity.ts`).
 */
export const opportunitySchema = z
  .strictObject({
    id: Id.describe('the opportunity id, unique in the world; an `opportunity` effect names it'),
    mission: Id.describe('the mission taking it opens; that mission opens only through an opportunity'),
    opens: z
      .int()
      .min(0)
      .describe('the first world tick it is offered (from the opening effect when `relative`)'),
    closes: z
      .int()
      .min(1)
      .describe(
        'the world tick it closes at, untaken (from the opening effect when `relative`); after `opens`',
      ),
    exclusive: Id.exactOptional().describe('a group: taking any one closes the others in it'),
    closesOthers: z
      .array(Id)
      .min(1)
      .exactOptional()
      .describe('opportunities that close when this one is taken'),
    relative: z
      .boolean()
      .exactOptional()
      .describe('true: it waits for an `opportunity` effect to open it, and its ticks count from then'),
  })
  .superRefine((o, ctx) => {
    if (o.closes <= o.opens)
      ctx.addIssue({
        code: 'custom',
        path: ['closes'],
        message: `must be after opens (${o.opens})`,
        params: { code: 'bad_window' },
      });
    if (o.closesOthers) {
      const seen = new Set<string>();
      o.closesOthers.forEach((id, i) => {
        if (id === o.id || seen.has(id))
          ctx.addIssue({
            code: 'custom',
            path: ['closesOthers', i],
            message: id === o.id ? 'must not name the opportunity itself' : `"${id}" is given twice`,
            params: { code: 'bad_closes' },
          });
        seen.add(id);
      });
    }
  });

export type OpportunityDef = z.infer<typeof opportunitySchema>;

/**
 * Check `json` against `opportunitySchema`; on failure `error` is one line per bad field.
 */
export function parseOpportunity(
  json: unknown,
): { ok: true; opportunity: OpportunityDef } | { ok: false; error: string } {
  const result = opportunitySchema.safeParse(json);
  if (result.success) return { ok: true, opportunity: result.data };
  const lines = result.error.issues.map((issue) => {
    const path = dottedPath(issue.path);
    return path === '' ? issue.message : `${path}: ${issue.message}`;
  });
  return { ok: false, error: lines.join('\n') };
}

export type MissionDef = z.infer<typeof missionSchema>;
export type MissionOutcome = z.infer<typeof missionOutcomeSchema>;
export type MissionEffect = z.infer<typeof missionEffectSchema>;
export type MissionEffectType = MissionEffect['type'];

/** The effect types, in a fixed order. */
export const MISSION_EFFECT_TYPES: readonly MissionEffectType[] = Object.freeze([
  'damage',
  'destroy',
  'inventory',
  'set',
  'opportunity',
  'fate',
]);

/**
 * What a kit or mini game reports when a played mission's round ends: the declared outcome it
 * reached and, optionally, its own stats (JSON-safe, kept on the record for reports).
 */
export interface MissionReport {
  readonly outcome: string;
  readonly stats?: JsonObject;
}

/** How a mission was resolved. `timeout`: its cost ran out unresolved, so it was delegated then. */
export type MissionResolution = 'played' | 'quit' | 'delegated' | 'timeout';

/** A mission's structured result: the outcome it reached and that outcome's effects. */
export interface MissionResult {
  readonly mission: string;
  readonly outcome: string;
  readonly effects: readonly MissionEffect[];
  /** The kit's report, when the mission was played. */
  readonly report?: MissionReport;
}

/**
 * A committed result as the world keeps it, append-only (item 150): never edited or removed.
 * `engine/sim` writes it at the commit tick.
 */
export interface MissionRecord extends MissionResult {
  readonly resolution: MissionResolution;
  readonly openTick: number;
  readonly commitTick: number;
  /** Ticks spent inside the mission while it was played; never moves the world. */
  readonly experienceTicks: number;
  /** Effects that could not apply at the commit (their entity gone, a fate that cannot move there...), skipped (not an error). */
  readonly skipped: readonly MissionEffect[];
}

/**
 * Turns a mission's world snapshot into what a kit needs, and the kit's report into one declared
 * outcome id. Written per game and kit pairing (in the game, or in a kit that reads only the plain
 * snapshot), so a kit never imports `engine/sim`.
 */
export interface MissionAdapter<KitInput, KitReport> {
  /**
   * What the kit plays from: built from the plain world snapshot when the mission is played.
   * `keys` (Engine 0.15 T7, gaps M10 and D6) is the world's key table (scenario key to entity id)
   * when the host has one, so params may name any keyed entity; `{}` or left out when there is none.
   */
  input(snapshot: JsonObject, mission: MissionDef, keys?: Readonly<Record<string, number>>): KitInput;
  /** The declared outcome the kit's report reached (checked by {@link playedResult}). */
  outcome(report: KitReport, mission: MissionDef): MissionReport;
}

/** The sum of the outcomes' weights: delegation draws `rng.int(total)` (in `engine/sim`, from `Rng.derived(seed, 'mission:<id>')`). */
export function totalWeight(mission: MissionDef): number {
  return mission.outcomes.reduce((sum, o) => sum + o.weight, 0);
}

/**
 * The outcome a delegation draw `n` (0 <= n < {@link totalWeight}) falls in, walking the outcomes
 * in file order. Throws on a draw out of range (a programming error).
 */
export function pickOutcome(mission: MissionDef, n: number): MissionOutcome {
  if (!Number.isInteger(n) || n < 0) throw new Error(`delegation draw ${n} is not a whole number >= 0`);
  let left = n;
  for (const outcome of mission.outcomes) {
    if (left < outcome.weight) return outcome;
    left -= outcome.weight;
  }
  throw new Error(`delegation draw ${n} is not below the total weight ${totalWeight(mission)}`);
}

/** The result of `outcome`, or why it is not in the mission's declared (and playable) space. */
export function missionResult(
  mission: MissionDef,
  outcomeId: string,
  report?: MissionReport,
): { ok: true; result: MissionResult } | { ok: false; code: 'unknown_outcome'; error: string } {
  const outcome = mission.outcomes.find((o) => o.id === outcomeId);
  if (!outcome || (report && mission.playable && !mission.playable.includes(outcomeId)))
    return {
      ok: false,
      code: 'unknown_outcome',
      error: `mission "${mission.id}" has no ${report ? 'playable ' : ''}outcome "${outcomeId}"`,
    };
  const result: MissionResult = {
    mission: mission.id,
    outcome: outcome.id,
    effects: outcome.effects,
    ...(report ? { report } : {}),
  };
  return { ok: true, result };
}

/** A played mission's result: the adapter's report, checked against the declared space. */
export function playedResult<KitReport>(
  adapter: MissionAdapter<unknown, KitReport>,
  mission: MissionDef,
  kitReport: KitReport,
): ReturnType<typeof missionResult> {
  const report = adapter.outcome(kitReport, mission);
  return missionResult(mission, report.outcome, report);
}

/**
 * Check `json` against `missionSchema`. On failure `error` is one line per bad field, each naming
 * it (`outcomes.1.id: ...`, `worldTimeCost: ...`).
 */
export function parseMission(
  json: unknown,
): { ok: true; mission: MissionDef } | { ok: false; error: string } {
  const result = missionSchema.safeParse(json);
  if (result.success) return { ok: true, mission: result.data };
  const lines = result.error.issues.map((issue) => {
    const path = dottedPath(issue.path);
    return path === '' ? issue.message : `${path}: ${issue.message}`;
  });
  return { ok: false, error: lines.join('\n') };
}
