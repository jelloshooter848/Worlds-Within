import type { DeepReadonly } from './types';

/**
 * Deep-freezes `value` in place and returns it typed read-only, so a backend that tries to change a
 * frame throws (in strict mode, which every ES module is). Used by tests and dev builds; a release
 * build may skip it, since the `DeepReadonly` type already stops changes at compile time.
 */
export function freezeFrame<T>(value: T): DeepReadonly<T> {
  deepFreeze(value);
  return value as DeepReadonly<T>;
}

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
}
