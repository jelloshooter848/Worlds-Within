import type { z } from 'zod';
import type { JsonObject } from './headless';
import type { InputFrame } from './input/input-manager';
import type { PresentFrame } from './present/types';

/**
 * The mini game contract, in the style of SMBC's `MiniGameDef`: a short game that runs over a
 * host (a platformer level, a map, a menu), plays one round and reports how it ended. Genres stack
 * this way (docs/DESIGN.md, "Simple games are first-class"): the host stops while the mini game
 * runs, then acts on its result.
 *
 * It is pure data and logic, with no scenes, drawing or clock, so kits can host mini games
 * headless and hash their snapshots. The browser side (a scene pushed over the level) is the
 * game's glue: `minigame-scene.ts` builds that scene from the same `MiniGame`.
 *
 *   const HOLD: MiniGameDef = {
 *     id: 'hold', title: 'HOLD ON',
 *     create: (ctx, seed) => { let n = 0; ... return { step, snapshot, result }; },
 *   };
 *   new PlatformerWorld(level, profile, { miniGames: [HOLD] });
 */

/**
 * How a round ended: `pass` (won), `fail` (lost) or `quit` (the player chose to stop). The host
 * decides what each means (a platformer level reads it from its data).
 */
export type MiniGameResult = 'pass' | 'fail' | 'quit';

/** Every result, in a fixed order (for schemas and docs). */
export const MINI_GAME_RESULTS: readonly MiniGameResult[] = ['pass', 'fail', 'quit'];

/** What a host hands a mini game when it starts a round. */
export interface MiniGameContext {
  /** The host's data for this round (a level's trigger `params`), JSON-safe; `{}` when none. */
  readonly params: JsonObject;
  /** Which round this is at this place: 1 the first time, 2 after one fail or quit, ... */
  readonly attempt: number;
}

/** One running round. The host steps it once per tick while `result()` is null. */
export interface MiniGame {
  /** One tick, reading `input` (already advanced to this tick's frame). */
  step(input: InputFrame): void;
  /** The round's whole state, JSON-safe; hosts put it in their own snapshot, so hashes cover it. */
  snapshot(): JsonObject;
  /** How the round ended, or null while it is still on. Once non-null it stays the same. */
  result(): MiniGameResult | null;
  /** What to show, for a backend (optional: a game's glue may draw the snapshot itself). */
  present?(): PresentFrame;
  /**
   * A structured report of how the round went (what it reached, counts), JSON-safe, read once
   * `result()` is non-null. Optional: hosts that only need pass, fail or quit never call it; a
   * mission's adapter (`missions.ts`, `MissionAdapter`) turns it into one of the mission's
   * declared outcomes.
   */
  report?(): JsonObject;
}

/** A mini game a game supplies by id: its title and how to start a round. */
export interface MiniGameDef {
  /** Lower-case letters, digits and "-": what level data names it by. */
  readonly id: string;
  /** Shown on a rules card or announced, e.g. 'HOLD ON'. */
  readonly title: string;
  /**
   * The shape of the `params` a round takes (a level trigger's or a mission's), optional. When
   * given, `validate` checks the content's params against it (gap G16), not only the round.
   */
  readonly paramsSchema?: z.ZodType;
  /**
   * Starts a round. Everything random in it must come from `seed` (a host draws it from its own
   * seeded RNG), so the same seed and input always give the same round.
   */
  create(ctx: MiniGameContext, seed: number): MiniGame;
}

const ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The defs by id, checked: every id well-formed and used once (throws otherwise). Hosts build it
 * once when they are created.
 */
export function miniGameTable(defs: readonly MiniGameDef[]): ReadonlyMap<string, MiniGameDef> {
  const table = new Map<string, MiniGameDef>();
  for (const def of defs) {
    if (!ID.test(def.id))
      throw new Error(`mini game id "${def.id}" must be lower-case letters, digits and "-"`);
    if (table.has(def.id)) throw new Error(`mini game id "${def.id}" is given twice`);
    table.set(def.id, def);
  }
  return table;
}
