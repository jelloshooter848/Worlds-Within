import type { JsonObject, JsonValue } from '../core/headless';

/**
 * The event log's record type. Every change to the world made through the World API (spawn,
 * destroy, component add/set/remove) becomes one `Change`, in the order it was made, attributed to
 * its cause. See "Event log" in this folder's CLAUDE.md.
 */

/** What a change did. `add` gives an entity a component it lacked, `set` replaces one it had. */
export type ChangeOp = 'spawn' | 'destroy' | 'add' | 'set' | 'remove';

/**
 * One change, as JSON-safe data. `tick` is the world tick the change was made at: a system's change
 * during `step()` from tick t carries t (the tick being run), and a change made between ticks
 * carries the current tick, so it comes before that tick's system changes in the log.
 *
 * - `spawn`, `destroy`: `entity` only. A destroy first logs a `remove` for each component the
 *   entity had (by component name), then the `destroy`.
 * - `add`: `component` and `value` (the data stored).
 * - `set`: `component`, `before` and `value`.
 * - `remove`: `component` and `before`.
 *
 * `value` and `before` are the world's own (frozen) data: read them, never change them.
 */
export interface Change extends JsonObject {
  tick: number;
  cause: string;
  op: ChangeOp;
  entity: number;
  /** The component name, for `add`, `set` and `remove`. */
  component?: string;
  /** The component data before the change, for `set` and `remove`. */
  before?: JsonValue;
  /** The component data after the change, for `add` and `set`. */
  value?: JsonValue;
}

/** Who caused a change: a system name, or an external cause such as `order:12`, `scenario`, `load`. */
export type Cause = string;

/** The cause of changes made between ticks when no `withCause` names one. */
export const EXTERNAL_CAUSE = 'external';

/** How much of the log a world keeps (`WorldOptions.log`). */
export interface LogOptions {
  /**
   * Keep only the changes of the last `ticks` committed ticks (plus any made since the last
   * commit): after the commit that brings the world to tick T, changes with `tick < T - ticks`
   * are dropped. Unset keeps everything; 0 keeps only changes made since the last commit.
   */
  readonly ticks?: number;
  /** `false` records nothing (no log at all). Default true. */
  readonly enabled?: boolean;
}

/** A cause is a non-empty string with no leading or trailing space. */
export function checkCause(cause: string): void {
  if (typeof cause !== 'string' || cause === '' || cause.trim() !== cause) {
    throw new Error(`cause must be a non-empty string without outer spaces, got ${JSON.stringify(cause)}`);
  }
}

/** Freeze `value` and everything in it, so stored data and log entries cannot change in place. */
export function deepFreeze<T extends JsonValue>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}
