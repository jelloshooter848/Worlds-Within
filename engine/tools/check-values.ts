import { canonicalJson, type JsonValue } from '@engine/core/headless';

/**
 * The checks a run file makes, as pure functions (Engine 0.14 T10): reading a dotted path out of a
 * snapshot and comparing it with a check's value. No Node imports, so the debugger page
 * (`debugger/`) makes the same checks in the browser that `run` makes in Node. `run-file.ts`
 * re-exports everything here.
 */

/** The comparison a check makes between the value at its path (`actual`) and its `value`. */
export const CHECK_OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'contains'] as const;
export type CheckOp = (typeof CHECK_OPS)[number];

/** A world's key table: scenario key to entity id (`HeadlessGame.worldKeys`, a world run's keys). */
export type WorldKeys = Readonly<Record<string, number>>;

type JsonRecord = { [key: string]: JsonValue };

const isRecord = (v: JsonValue | undefined): v is JsonRecord =>
  v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v);

/** Whether `v` is a plain world snapshot (`engine/sim`'s `World.snapshot()`: `entities` and `components`). */
function isWorldSnapshot(v: JsonValue | undefined): v is JsonRecord {
  return isRecord(v) && Array.isArray(v['entities']) && isRecord(v['components']);
}

/**
 * One entity of a world snapshot by id, as keyed paths read it (Engine 0.15 T7, gap M17): `id`,
 * `alive` (it exists and its `Fate` is not `dead`), `fate` (`Fate.state`, `active` without one,
 * null once it is gone) and every component kind the snapshot lists, its data or null when the
 * entity lacks it (so `world.key.captain.Position` is null for a captive; a kind the snapshot does
 * not list has no value, so a typo still fails).
 */
function entityView(world: JsonRecord, id: number): JsonRecord {
  const lists = world['components'] as JsonRecord;
  const exists = (world['entities'] as JsonValue[]).includes(id);
  const view: JsonRecord = { id };
  for (const [name, list] of Object.entries(lists)) {
    const pair = Array.isArray(list) ? list.find((p) => Array.isArray(p) && p[0] === id) : undefined;
    view[name] = Array.isArray(pair) ? (pair[1] as JsonValue) : null;
  }
  const fate = isRecord(view['Fate']) ? view['Fate']['state'] : undefined;
  view['fate'] = exists ? (typeof fate === 'string' ? fate : 'active') : null;
  view['alive'] = exists && view['fate'] !== 'dead';
  return view;
}

/**
 * The component `kind` of the lowest-id entity holding it (a world-level component such as
 * `Missions`, `WorldTime` or `Opportunities`), null when the kind is listed but no entity has it,
 * or undefined when the snapshot does not list it.
 */
function oneOf(world: JsonRecord, kind: string): JsonValue | undefined {
  const list = (world['components'] as JsonRecord)[kind];
  if (!Array.isArray(list)) return undefined;
  const pair = list[0];
  return Array.isArray(pair) ? (pair[1] as JsonValue) : null;
}

/**
 * The value at a dotted path (`hero.hp`, `entities.0.kind`, `entities.length`), or `undefined`.
 *
 * Inside a world snapshot (Engine 0.15 T7, gap M17; docs/BUILD-LOG.md, Engine 0.15, decision 8)
 * three more segments name an entity without its place in a component list, so a path does not
 * move when an entity is added: **`key.<key>`** (through `keys`, the world's key table:
 * `world.key.ram.Health.hp`, `world.key.captain.alive`), **`id.<n>`** (by entity id:
 * `world.id.15.Target.entity`) and **`one.<Kind>`** (the world-level component, the lowest-id
 * entity holding it: `world.one.Missions.committed.0.outcome`). An entity reads as `entityView`
 * says. A key not in `keys` has no value (the tools refuse it before playing: `unknownKeyAt`).
 */
export function valueAt(state: JsonValue, path: string, keys: WorldKeys = {}): JsonValue | undefined {
  let at: JsonValue | undefined = state;
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i] as string;
    const next = parts[i + 1];
    if (isWorldSnapshot(at) && next !== undefined && (key === 'key' || key === 'id' || key === 'one')) {
      i++;
      if (key === 'one') {
        at = oneOf(at, next);
        continue;
      }
      const id =
        key === 'key'
          ? Object.hasOwn(keys, next)
            ? keys[next]
            : undefined
          : /^\d+$/.test(next)
            ? Number(next)
            : undefined;
      if (id === undefined) return undefined;
      at = entityView(at, id);
      continue;
    }
    if (Array.isArray(at)) {
      if (key === 'length') at = at.length;
      else if (/^\d+$/.test(key)) at = at[Number(key)];
      else return undefined;
    } else if (at !== null && typeof at === 'object' && Object.hasOwn(at, key)) at = at[key];
    else return undefined;
  }
  return at;
}

/**
 * The scenario key a path names through a world snapshot's `key.<key>` that `keys` does not hold,
 * or null (read on `state`, a snapshot of the run: the world's place in it is found by walking the
 * path). For the tools' `no_key` check before a run plays.
 */
export function unknownKeyAt(state: JsonValue, path: string, keys: WorldKeys): string | null {
  let at: JsonValue | undefined = state;
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i] as string;
    const next = parts[i + 1];
    if (isWorldSnapshot(at) && key === 'key' && next !== undefined)
      return Object.hasOwn(keys, next) ? null : next;
    if (Array.isArray(at)) at = /^\d+$/.test(key) ? at[Number(key)] : undefined;
    else if (isRecord(at) && Object.hasOwn(at, key)) at = at[key];
    else return null;
  }
  return null;
}

const same = (a: JsonValue, b: JsonValue) => canonicalJson(a) === canonicalJson(b);

/**
 * Makes one check against a snapshot. Returns null when it holds, or why it fails. A path that is
 * not in the snapshot always fails (so a typo cannot pass a `ne`).
 */
export function failsCheck(
  state: JsonValue,
  check: { path: string; op: CheckOp; value: JsonValue },
  keys: WorldKeys = {},
): { actual: JsonValue | null; message: string } | null {
  const actual = valueAt(state, check.path, keys);
  if (actual === undefined) return { actual: null, message: `no value at "${check.path}"` };
  const want = check.value;
  const show = (v: JsonValue) => JSON.stringify(v);
  const fail = (what: string) => ({ actual, message: `${check.path} is ${show(actual)}, ${what}` });
  switch (check.op) {
    case 'eq':
      return same(actual, want) ? null : fail(`expected ${show(want)}`);
    case 'ne':
      return same(actual, want) ? fail(`expected anything but ${show(want)}`) : null;
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      if (typeof actual !== 'number') return fail(`not a number (expected ${check.op} ${show(want)})`);
      const n = want as number;
      const ok =
        check.op === 'lt'
          ? actual < n
          : check.op === 'lte'
            ? actual <= n
            : check.op === 'gt'
              ? actual > n
              : actual >= n;
      return ok ? null : fail(`expected ${check.op} ${show(want)}`);
    }
    case 'in':
    case 'nin': {
      const found = (want as JsonValue[]).some((v) => same(actual, v));
      if (check.op === 'in') return found ? null : fail(`expected one of ${show(want)}`);
      return found ? fail(`expected none of ${show(want)}`) : null;
    }
    case 'contains':
      if (Array.isArray(actual))
        return actual.some((v) => same(v, want)) ? null : fail(`expected it to contain ${show(want)}`);
      if (typeof actual === 'string' && typeof want === 'string')
        return actual.includes(want) ? null : fail(`expected it to contain ${show(want)}`);
      return fail(`not an array or string (expected it to contain ${show(want)})`);
  }
}
