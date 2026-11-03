import type { Change } from '@engine/sim/index';

/**
 * Filtering a world's event log (Engine 0.14 T7 and T10): the filters `events` takes on the command
 * line and the debugger page takes in its event panel, as one pure function. No Node imports, so
 * the page filters with the same code.
 */

/** What to keep: world ticks `from` to `to` (both included), one entity, one cause, one component. */
export interface EventFilter {
  from?: number;
  to?: number;
  entity?: number;
  /** Exact, or a prefix before `:` (`mission` keeps `mission:sabotage`). */
  cause?: string;
  component?: string;
}

/** Whether `cause` is `want` or one of its `want:...` causes. */
export function causeMatches(cause: string, want: string): boolean {
  return cause === want || cause.startsWith(`${want}:`);
}

/** One change as a text line: `t40 mission:sabotage set #12 WorldTime`. */
export function changeLine(c: Change): string {
  return `t${c.tick} ${c.cause} ${c.op} #${c.entity}${c.component !== undefined ? ` ${c.component}` : ''}`;
}

/** The changes that pass every filter given, in log order. */
export function filterChanges(changes: readonly Change[], filter: EventFilter): Change[] {
  return changes.filter(
    (c) =>
      (filter.from === undefined || c.tick >= filter.from) &&
      (filter.to === undefined || c.tick <= filter.to) &&
      (filter.entity === undefined || c.entity === filter.entity) &&
      (filter.cause === undefined || causeMatches(c.cause, filter.cause)) &&
      (filter.component === undefined || c.component === filter.component),
  );
}
