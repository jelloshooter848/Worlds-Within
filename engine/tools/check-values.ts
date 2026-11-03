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

/** The value at a dotted path (`hero.hp`, `entities.0.kind`, `entities.length`), or `undefined`. */
export function valueAt(state: JsonValue, path: string): JsonValue | undefined {
  let at: JsonValue | undefined = state;
  for (const key of path.split('.')) {
    if (Array.isArray(at)) {
      if (key === 'length') at = at.length;
      else if (/^\d+$/.test(key)) at = at[Number(key)];
      else return undefined;
    } else if (at !== null && typeof at === 'object' && Object.hasOwn(at, key)) at = at[key];
    else return undefined;
  }
  return at;
}

const same = (a: JsonValue, b: JsonValue) => canonicalJson(a) === canonicalJson(b);

/**
 * Makes one check against a snapshot. Returns null when it holds, or why it fails. A path that is
 * not in the snapshot always fails (so a typo cannot pass a `ne`).
 */
export function failsCheck(
  state: JsonValue,
  check: { path: string; op: CheckOp; value: JsonValue },
): { actual: JsonValue | null; message: string } | null {
  const actual = valueAt(state, check.path);
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
