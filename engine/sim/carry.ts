import { z } from 'zod';
import { dottedPath, type FieldPath } from '../core/content/validate';
import { Health, Inventory, Member, inventoryAdd, type InventoryData } from './components';
import { Stockpile, stockpileOf } from './economy';
import { FATE_STATES, Fate, fateOf, startFate, type FateReading, type FateView } from './fate';
import { applyOpportunityEffect, knowsOpportunity } from './opportunity';
import type { Scenario } from './scenario';
import { ScenarioError, type ScenarioIssue } from './scenario-error';
import type { Entity, World } from './world';

/**
 * Carry-over (Engine 0.13 T5; docs/BUILD-LOG.md, Engine 0.13, decision 5, item 224; see "Carry" in
 * this folder's CLAUDE.md): a scenario that starts from another's results.
 *
 * A second scenario names the first with `from`: the first one's content id, a carry spec (the
 * named people, by scenario key, whose `Health` and fate carry, and stockpile items by faction) and
 * `when` rules that open dormant opportunities for a carried person's fate:
 *
 *   "from": { "scenario": "village",
 *             "carry": { "people": ["captain"], "stockpiles": [{ "faction": "village", "items": ["gold"] }] },
 *             "when": [{ "key": "captain", "fate": "captured", "open": ["rescue-window"] }] }
 *
 *   const record = carriedRecord(endWorld, second.from, scenarioKeys(first));   // plain JSON
 *   const next = worldFromScenario(second, { carried: record });
 *
 * The carried record holds only what the spec names, integers and ids with every key sorted, so two
 * first-world endings that differ only in one person give records that differ only in that person.
 * `worldFromScenario` applies it at tick 0 under the cause `carry`: each person's `Health` (capped at
 * the second scenario's `max`) and fate (`startFate`: a captured or dead person starts off the map),
 * each stockpile item (replaced), then the `when` rules in order. Buildings, positions, other units
 * and the first world's RNG never carry. No randomness.
 */

/** The `format` every carried record carries. */
export const CARRIED_FORMAT = 'worlds-within/carried';
/** The carried record version this engine reads. */
export const CARRIED_VERSION = 1;
/** The cause carried data is applied under. */
export const CARRY_CAUSE = 'carry';

const Key = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -');
const Tick = z.int().min(0);
const Count = z.int().min(0);
const FATE_READINGS = ['active', ...FATE_STATES] as const;

/** What carries from the first scenario's end world: named people by key and stockpile items. */
export const carrySpecSchema = z.strictObject({
  people: z
    .array(Key)
    .default([])
    .describe(
      'the keys of named people (squad members) whose `Health` and fate carry; keys of both scenarios',
    ),
  stockpiles: z
    .array(
      z.strictObject({
        faction: Key.describe("the faction whose stockpile's items carry"),
        items: z.array(Key).min(1).describe("the items whose counts carry (replacing the second scenario's)"),
      }),
    )
    .default([])
    .describe('stockpile items by faction; the faction needs a `Stockpile` in both worlds'),
});

/** A scenario's `from`: the scenario it follows, what carries, and what a carried fate opens. */
export const carryFromSchema = z.strictObject({
  scenario: Key.describe("the first scenario's content id (the carried record's `from` must match)"),
  carry: carrySpecSchema.describe('what carries (Engine 0.13)'),
  when: z
    .array(
      z.strictObject({
        key: Key.describe('a key of `carry.people`'),
        fate: z.enum(FATE_READINGS).describe('the carried fate that triggers the rule'),
        open: z
          .array(Key)
          .min(1)
          .describe('dormant `relative` opportunities of this scenario to open at tick 0, in this order'),
      }),
    )
    .default([])
    .describe('rules applied in order after the carried data: opportunities a carried fate opens'),
});
export type CarryFrom = z.infer<typeof carryFromSchema>;

/** One carried person: their fate as read in the first world and their `Health` (null without one). */
const carriedPersonSchema = z
  .strictObject({
    fate: z.enum(FATE_READINGS).describe('`active` or a `Fate` state'),
    by: Key.nullable().describe('who captured or killed them (null while active or not known)'),
    at: Tick.nullable().describe('the first world tick the state was reached (null while active)'),
    hp: Count.nullable().describe("`Health.hp` at the first world's end (null: no `Health`)"),
    max: z.int().min(1).nullable().describe('`Health.max` (null exactly when `hp` is)'),
  })
  .superRefine((p, ctx) => {
    if (p.fate === 'active' && (p.by !== null || p.at !== null))
      ctx.addIssue({ code: 'custom', path: ['fate'], message: 'an active person has no `by` or `at`' });
    if (p.fate !== 'active' && p.at === null)
      ctx.addIssue({
        code: 'custom',
        path: ['at'],
        message: `a ${p.fate} person needs the tick it was reached`,
      });
    if ((p.hp === null) !== (p.max === null))
      ctx.addIssue({ code: 'custom', path: ['max'], message: 'give both `hp` and `max`, or neither' });
    if (p.hp !== null && p.max !== null && p.hp > p.max)
      ctx.addIssue({ code: 'custom', path: ['hp'], message: `is more than max ${p.max}` });
    if (p.fate === 'dead' && p.hp !== null && p.hp > 0)
      ctx.addIssue({ code: 'custom', path: ['hp'], message: 'a dead person has 0 hp' });
  });
export type CarriedPerson = z.infer<typeof carriedPersonSchema>;

/** The carried record: plain JSON built by `carriedRecord`, read by `worldFromScenario`'s `carried`. */
export const carriedRecordSchema = z.strictObject({
  format: z.literal(CARRIED_FORMAT).describe('always `worlds-within/carried`'),
  version: z.literal(CARRIED_VERSION).describe('the carried record version'),
  from: Key.describe("the first scenario's content id (the second scenario's `from.scenario`)"),
  tick: Tick.describe('the first world tick the record was taken at'),
  people: z
    .record(Key, carriedPersonSchema)
    .describe("one entry per key of the carry spec's `people`, sorted by key"),
  stockpiles: z
    .record(Key, z.record(Key, Count))
    .describe("item counts by faction, then item, for the carry spec's `stockpiles`, sorted"),
});
export type CarriedRecord = z.infer<typeof carriedRecordSchema>;

type At = (path: FieldPath, message: string) => void;

function collector(): { issues: ScenarioIssue[]; at: At } {
  const issues: ScenarioIssue[] = [];
  return { issues, at: (path, message) => issues.push({ path: dottedPath(path), message }) };
}

/** Repeated people, factions and items in a carry spec. */
function specRepeats(from: CarryFrom, at: At): void {
  const once = (list: readonly string[], path: FieldPath, what: string) => {
    const seen = new Set<string>();
    list.forEach((v, i) => {
      if (seen.has(v)) at([...path, i], `${what} "${v}" is given twice`);
      seen.add(v);
    });
  };
  once(from.carry.people, ['from', 'carry', 'people'], 'person');
  once(
    from.carry.stockpiles.map((s) => s.faction),
    ['from', 'carry', 'stockpiles'],
    'faction',
  );
  from.carry.stockpiles.forEach((s, i) => once(s.items, ['from', 'carry', 'stockpiles', i, 'items'], 'item'));
}

/** `entries` as an object with its keys in sorted order. */
function sorted<T>(entries: readonly (readonly [string, T])[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) out[k] = v;
  return out;
}

/**
 * The carried record of `world` (the first scenario's end world) for a second scenario's `from`,
 * with `keys` the first scenario's entity keys (`scenarioKeys(first)`). Reads only. Throws a
 * `ScenarioError` naming the field when `from` is malformed, a carried key is not a key of the
 * first scenario or not a living named person there, or a carried faction has no stockpile.
 */
export function carriedRecord(
  world: World,
  from: unknown,
  keys: Readonly<Record<string, Entity>>,
): CarriedRecord {
  const parsed = carryFromSchema.safeParse(from);
  if (!parsed.success) {
    throw new ScenarioError(
      parsed.error.issues.map((i) => ({
        path: dottedPath(['from', ...(i.path as FieldPath)]),
        message: i.message,
      })),
    );
  }
  const spec = parsed.data;
  const { issues, at } = collector();
  specRepeats(spec, at);

  const people = spec.carry.people.flatMap((key, i): [string, CarriedPerson][] => {
    const path = ['from', 'carry', 'people', i];
    const id = Object.hasOwn(keys, key) ? keys[key] : undefined;
    if (id === undefined) {
      at(path, `"${key}" is not a key of the first scenario`);
      return [];
    }
    if (!world.alive(id) || !world.registered(Member) || !world.has(id, Member)) {
      at(path, `"${key}" (entity ${id}) is not a named person in the first world (no Member)`);
      return [];
    }
    const fate = fateOf(world, id) as FateView;
    const health = world.registered(Health) ? world.get(id, Health) : undefined;
    return [
      [key, { fate: fate.state, by: fate.by, at: fate.at, hp: health?.hp ?? null, max: health?.max ?? null }],
    ];
  });

  const stockpiles = spec.carry.stockpiles.flatMap((s, i): [string, Record<string, number>][] => {
    const holder = world.registered(Stockpile) ? stockpileOf(world, s.faction) : null;
    if (holder === null) {
      at(
        ['from', 'carry', 'stockpiles', i, 'faction'],
        `faction "${s.faction}" has no stockpile in the first world`,
      );
      return [];
    }
    const inventory: InventoryData =
      (world.registered(Inventory) ? world.get(holder, Inventory) : undefined) ?? {};
    return [[s.faction, sorted(s.items.map((item) => [item, inventory[item] ?? 0] as const))]];
  });

  if (issues.length > 0) throw new ScenarioError(issues);
  return {
    format: CARRIED_FORMAT,
    version: CARRIED_VERSION,
    from: spec.scenario,
    tick: world.tick,
    people: sorted(people),
    stockpiles: sorted(stockpiles),
  };
}

/**
 * Check a scenario's `from` against the scenario itself, reporting through `at`: every carried
 * person is a squad member's key, carries no `Fate` of its own in the file (the carried record, or
 * active, is their fate), every carried faction has a `Stockpile` entity, and every `when` rule
 * names a carried key and dormant (`relative`) opportunities of the scenario.
 */
export function fromIssues(sc: Scenario, at: At): void {
  const from = sc.from;
  if (from === undefined) return;
  specRepeats(from, at);
  const members = new Map<string, { path: FieldPath; components: Record<string, unknown> }>();
  sc.squads.forEach((s, i) =>
    s.members.forEach((m, j) => {
      if (m.key !== undefined && !members.has(m.key))
        members.set(m.key, { path: ['squads', i, 'members', j], components: m.components });
    }),
  );
  from.carry.people.forEach((key, i) => {
    const member = members.get(key);
    if (member === undefined) {
      at(
        ['from', 'carry', 'people', i],
        `"${key}" is not the key of a named person (squad member) of this scenario`,
      );
    } else if (Object.hasOwn(member.components, Fate.name)) {
      at(
        [...member.path, 'components', Fate.name],
        `"${key}" is carried: their fate comes from the carried record`,
      );
    }
  });
  const factions = new Set<string>();
  const stockpileOfComponents = (c: Record<string, unknown>) => {
    const s = c[Stockpile.name];
    if (s !== null && typeof s === 'object' && typeof (s as { faction?: unknown }).faction === 'string')
      factions.add((s as { faction: string }).faction);
  };
  for (const e of sc.entities) stockpileOfComponents(e.components);
  for (const s of sc.squads) {
    stockpileOfComponents(s.components);
    for (const m of s.members) stockpileOfComponents(m.components);
  }
  from.carry.stockpiles.forEach((s, i) => {
    if (!factions.has(s.faction))
      at(
        ['from', 'carry', 'stockpiles', i, 'faction'],
        `faction "${s.faction}" has no Stockpile in this scenario`,
      );
  });
  const relative = new Map((sc.opportunities ?? []).map((o) => [o.id, o.relative === true]));
  from.when.forEach((rule, i) => {
    if (!from.carry.people.includes(rule.key))
      at(['from', 'when', i, 'key'], `"${rule.key}" is not in from.carry.people`);
    rule.open.forEach((id, j) => {
      const isRelative = relative.get(id);
      if (isRelative === undefined)
        at(['from', 'when', i, 'open', j], `"${id}" is not an opportunity of this scenario`);
      else if (!isRelative)
        at(
          ['from', 'when', i, 'open', j],
          `"${id}" is not \`relative\`: only a dormant opportunity can be opened`,
        );
    });
  });
}

/**
 * Check a carried record (`carried`, unknown JSON) against a scenario's `from`, reporting through
 * `at` under the path `carried`: its shape, its `from`, and exactly the people, factions and items
 * the carry spec names. Returns the record when it fits, else null.
 */
export function carriedIssues(sc: Scenario, carried: unknown, at: At): CarriedRecord | null {
  if (sc.from === undefined) {
    at(['carried'], 'the scenario has no `from`, so nothing can be carried into it');
    return null;
  }
  const parsed = carriedRecordSchema.safeParse(carried);
  if (!parsed.success) {
    for (const i of parsed.error.issues) at(['carried', ...(i.path as FieldPath)], i.message);
    return null;
  }
  const record = parsed.data;
  const spec = sc.from.carry;
  const before = { count: 0 };
  const bad: At = (path, message) => {
    before.count++;
    at(path, message);
  };
  if (record.from !== sc.from.scenario)
    bad(['carried', 'from'], `is "${record.from}", but the scenario starts from "${sc.from.scenario}"`);
  for (const key of Object.keys(record.people))
    if (!spec.people.includes(key))
      bad(['carried', 'people', key], `"${key}" is not carried by this scenario (from.carry.people)`);
  for (const key of spec.people)
    if (!Object.hasOwn(record.people, key)) bad(['carried', 'people'], `has no entry for "${key}"`);
  const factions = new Map(spec.stockpiles.map((s) => [s.faction, s.items]));
  for (const [faction, items] of Object.entries(record.stockpiles)) {
    const wanted = factions.get(faction);
    if (wanted === undefined) {
      bad(['carried', 'stockpiles', faction], `faction "${faction}" is not carried by this scenario`);
      continue;
    }
    for (const item of Object.keys(items))
      if (!wanted.includes(item))
        bad(['carried', 'stockpiles', faction, item], `item "${item}" is not carried by this scenario`);
    for (const item of wanted)
      if (!Object.hasOwn(items, item)) bad(['carried', 'stockpiles', faction], `has no count for "${item}"`);
  }
  for (const faction of factions.keys())
    if (!Object.hasOwn(record.stockpiles, faction))
      bad(['carried', 'stockpiles'], `has no entry for "${faction}"`);
  return before.count === 0 ? record : null;
}

/**
 * Apply a checked carried record to the world `worldFromScenario` just built (tick 0, between
 * ticks), under the cause `carry`: people in spec order (`Health`, then the fate), stockpile items,
 * then the `when` rules. `ids` are the scenario's keys. Every check was made by `fromIssues` and
 * `carriedIssues`, so a refusal here is a bug and throws.
 */
export function applyCarried(
  world: World,
  from: CarryFrom,
  record: CarriedRecord,
  ids: ReadonlyMap<string, Entity>,
): void {
  for (const key of from.carry.people) {
    const id = ids.get(key) as Entity;
    const person = record.people[key] as CarriedPerson;
    if (person.hp !== null && person.max !== null) {
      const max = world.get(id, Health)?.max ?? person.max;
      const hp = Math.min(person.hp, max);
      world.withCause(CARRY_CAUSE, (w) => w.add(id, Health, { hp, max }));
    }
    if (person.fate === 'active') continue;
    const done = startFate(world, id, person.fate, {
      cause: CARRY_CAUSE,
      by: person.by,
      at: person.at as number,
    });
    if (!done.ok) throw new Error(`carrying "${key}": ${done.error}`);
  }
  world.withCause(CARRY_CAUSE, (w) => {
    for (const s of from.carry.stockpiles) {
      const holder = stockpileOf(w, s.faction) as Entity;
      const counts = record.stockpiles[s.faction] as Record<string, number>;
      for (const item of s.items) {
        const now = w.get(holder, Inventory)?.[item] ?? 0;
        const want = counts[item] as number;
        if (want !== now) inventoryAdd(w, holder, item, want - now);
      }
    }
    for (const rule of from.when) {
      const fate: FateReading = (record.people[rule.key] as CarriedPerson).fate;
      if (fate !== rule.fate) continue;
      for (const id of rule.open) {
        if (!knowsOpportunity(w, id)) throw new Error(`carry: opportunity "${id}" is not in the world`);
        applyOpportunityEffect(w, { type: 'opportunity', open: id });
      }
    }
  });
}
