import type { ContentBundle } from './content/bundle';
import type { InputFrame } from './input/input-manager';
import type { MiniGame, MiniGameDef } from './minigame';

/**
 * The headless game contract: what a game exposes so the tools (`pnpm cli run`, `dump`) can play
 * it without a browser, a backend or a clock. A game names the module that exports it in
 * `game.json` (`headless`); the tools load that module by its path at run time.
 *
 *   export function createGame(content: ContentBundle, seed: number, opts?: HeadlessOptions): HeadlessGame
 *
 * The tools step the game once per tick with one input frame and read a snapshot after each step;
 * a game that takes recorded orders (`order`) gets each one between steps, at its tick.
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
  /**
   * Optional (Engine 0.9, items 124-125): takes one recorded order, between steps. A run file's
   * `orders` entry `{ "tick": t, ...order }` is handed over, without `tick`, after the snapshot of
   * tick `t` and before the step from `t` to `t + 1`; orders of one tick come in file order (id
   * order). The order is whatever the game's orders are (an RTS game's are `engine/core/orders.ts`
   * orders). Returns null when the order was applied, or a one-line reason when the game dropped
   * it (a refused order is not an error; the run reports it). A game without `order` cannot play
   * a run file with `orders` (a usage error). Games without orders leave it out.
   */
  order?(order: JsonObject): string | null;
  /**
   * Optional (Engine 0.10, gap G37, item 159): the round the game is hosting now (a mini game
   * started by a level trigger), or null. The game still steps the round in `step` and applies
   * its result; the browser shell's `HostScene` reads this to push the round's scene. Games that
   * host no rounds leave it out.
   */
  miniGame?(): MiniGame | null;
}

/**
 * A game the browser shell's `HostScene` can play by itself (Engine 0.10, gap G37): the headless
 * game plus what the scene draws, `world` (the world now; a new object when the game moves to
 * another level) and `events` (the last step's), and `miniGame()` (required here). A platformer
 * `LevelSequence` is one.
 */
export interface HostedGame<W extends object = object, E = unknown> extends HeadlessGame {
  readonly world: W;
  readonly events: readonly E[];
  miniGame(): MiniGame | null;
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
  /**
   * Optional (Engine 0.10, gap G16, item 157): the mini games the game's content may name (a
   * level trigger's `game`, a mission's `play`), the same defs `createGame` hands its kit. When
   * exported, `validate` checks every use's id and `params` against them (`minigame-params.ts`);
   * a game without it is validated as before. Builds defs only: it starts no round.
   */
  miniGames?(content: ContentBundle): readonly MiniGameDef[];
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
