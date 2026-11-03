import {
  CARRIED_FORMAT,
  CARRIED_VERSION,
  carriedRecordSchema,
  carryFromSchema,
  type CarriedPerson,
  type CarriedRecord,
  type CarryFrom,
} from '../core/carried';
import { dottedPath, type FieldPath } from '../core/content/validate';
import { Health, Inventory, Member, inventoryAdd, type InventoryData } from './components';
import { Stockpile, stockpileOf } from './economy';
import { Fate, fateOf, startFate, type FateReading, type FateView } from './fate';
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

export {
  CARRIED_FATES,
  CARRIED_FORMAT,
  CARRIED_VERSION,
  carriedRecordSchema,
  carryFromSchema,
  carrySpecSchema,
  type CarriedPerson,
  type CarriedRecord,
  type CarryFrom,
} from '../core/carried';

/** The cause carried data is applied under. */
export const CARRY_CAUSE = 'carry';

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
