import type { ContentBundle } from './content/bundle';
import type { InputFrame } from './input/input-manager';

/**
 * The headless game contract: what a game exposes so the tools (`pnpm cli run`, `dump`) can play
 * it without a browser, a backend or a clock. A game names the module that exports it in
 * `game.json` (`headless`); the tools load that module by its path at run time.
 *
 *   export function createGame(content: ContentBundle, seed: number, opts?: HeadlessOptions): HeadlessGame
 *
 * The tools step the game once per tick with one input frame and read a snapshot after each step.
 * A snapshot is plain JSON-safe data (objects, arrays, strings, finite numbers, booleans, null):
 * the same content, seed and input always give the same snapshots, so their hashes can be
 * compared across runs and machines.
 */

/** A JSON-safe value: what a snapshot is made of. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** A JSON-safe object: the shape of a whole snapshot. */
export type JsonObject = { [key: string]: JsonValue };

/** A game running headless: one step per tick, a snapshot of its state between steps. */
export interface HeadlessGame {
  /** Advances the game by one tick, reading `input` (already advanced to this tick's frame). */
  step(input: InputFrame): void;
  /** The whole game state now, as plain JSON-safe data. Must not change the game. */
  snapshot(): JsonObject;
}

/** How the tools ask for a game to be set up, beyond its content and seed. */
export interface HeadlessOptions {
  /**
   * Kit rules to switch off (ids from the kit's rule list, `rules.ts`), for mutant checks. A game
   * passes them to its kit; the tools have already checked the ids against the kit's list.
   */
  disabledRules?: readonly string[];
}

/** What a game's headless module (named by `headless` in `game.json`) exports. */
export interface HeadlessEntry {
  createGame(content: ContentBundle, seed: number, opts?: HeadlessOptions): HeadlessGame;
}

/**
 * `value` as canonical JSON: object keys sorted, no spaces, so equal states give equal text (and
 * equal hashes) whatever order their keys were written in. Throws on anything that is not
 * JSON-safe (`undefined`, functions, `NaN`, `Infinity`, class instances such as `Map`), naming the
 * path, so a snapshot that would hash differently on another machine is caught at once.
 */
export function canonicalJson(value: unknown, path = ''): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`not JSON-safe at "${path}": ${String(value)}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v, i) => canonicalJson(v, path === '' ? String(i) : `${path}.${i}`)).join(',')}]`;
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map(
      (k) => `${JSON.stringify(k)}:${canonicalJson(obj[k], path === '' ? k : `${path}.${k}`)}`,
    );
    return `{${parts.join(',')}}`;
  }
  const what = typeof value === 'object' ? (value.constructor?.name ?? 'object') : typeof value;
  throw new Error(`not JSON-safe at "${path}": ${what}`);
}
