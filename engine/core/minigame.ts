import type { z } from 'zod';
import type { JsonObject } from './headless';
import { Actions, type Action } from './input/actions';
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
  /**
   * The host's HUD values the round shows (Engine 0.11, gap G19), plain JSON: the keys the def
   * asks for (`MiniGameDef.hostStatus`) that the host has, picked with `hostStatusFor`. A round
   * that presents a frame adds each as status `host:<key>` for its skin to draw. Left out when the
   * def asks for none or the host has none of them, so such a round is unchanged.
   */
  readonly hostStatus?: HostStatus;
}

/** A host's HUD values as a round is given them: status key to value, JSON-safe. */
export type HostStatus = Readonly<Record<string, string | number | boolean>>;

/**
 * A round's own controls (Engine 0.11, gap G18): host action to the round action it becomes, or
 * null to drop it. Actions it does not name reach the round as themselves.
 */
export type MiniGameInputMap = Readonly<Partial<Record<Action, Action | null>>>;

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
   * The round's own controls (gap G18): applied by `RoundInput` to every frame before the round
   * sees it (`{ jump: 'attack' }` makes the host's jump the round's attack). Left out, the round
   * gets the host's actions as they are.
   */
  readonly inputMap?: MiniGameInputMap;
  /**
   * The host HUD status keys the round shows (gap G19, the rest): the host hands their values in
   * `MiniGameContext.hostStatus` (`hostStatusFor`). Left out, the round shows its own HUD only.
   */
  readonly hostStatus?: readonly string[];
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
    for (const [from, to] of Object.entries(def.inputMap ?? {}))
      if (!isAction(from) || (to !== null && !isAction(to)))
        throw new Error(
          `mini game "${def.id}": input map "${from}" -> "${String(to)}" names an action that is not one of ${Actions.join(', ')}`,
        );
    table.set(def.id, def);
  }
  return table;
}

function isAction(a: unknown): a is Action {
  return (Actions as readonly unknown[]).includes(a);
}

/**
 * The host status a round of `def` is given: the keys `def.hostStatus` asks for that `status`
 * (the host's HUD values) has, in the def's order; undefined when there are none, so the context
 * can leave it out.
 */
export function hostStatusFor(
  def: MiniGameDef,
  status: Readonly<Record<string, unknown>>,
): HostStatus | undefined {
  const out: Record<string, string | number | boolean> = {};
  for (const key of def.hostStatus ?? []) {
    const value = status[key];
    if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number')
      out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The input a hosted round sees (Engine 0.11, gap G18): every host steps its round with
 * `round.step(roundInput.advance(hostFrame))`, so no game writes this. Each tick it reads the
 * host's frame and
 *
 * - **drops a button held into the round:** on the round's first tick every host action that is
 *   held but was not pressed on that tick (it was already down before the round started, such as
 *   the direction the player walked into a door with) is masked, and stays masked until a frame
 *   without it. A press on the first tick itself counts, so a script whose first frame holds a
 *   button (a run file's `play` script, which starts with nothing held) plays as written;
 * - **applies the def's `inputMap`:** each held host action becomes the round action it maps to
 *   (null drops it; unnamed actions stay themselves).
 *
 * `pressed`, `released`, `dirX` and the jump buffer are the round's own, from the mapped actions
 * of the ticks it has seen: a jump pressed before the round never counts in it. One per round;
 * pure (no clock, no DOM).
 */
export class RoundInput implements InputFrame {
  private cur = new Set<Action>();
  private prev = new Set<Action>();
  private readonly masked = new Set<Action>();
  private started = false;
  private frame = 0;
  private jumpAt = -1000;

  constructor(private readonly map: MiniGameInputMap = {}) {}

  /** Reads the host's frame for this tick (the first call is the round's first tick). */
  advance(host: InputFrame): this {
    for (const a of this.masked) if (!host.held(a)) this.masked.delete(a);
    if (!this.started) {
      this.started = true;
      for (const a of Actions) if (host.held(a) && !host.pressed(a)) this.masked.add(a);
    }
    const next = new Set<Action>();
    for (const a of Actions) {
      if (!host.held(a) || this.masked.has(a)) continue;
      const to = a in this.map ? this.map[a] : a;
      if (to) next.add(to);
    }
    this.prev = this.cur;
    this.cur = next;
    this.frame++;
    if (this.pressed('jump')) this.jumpAt = this.frame;
    return this;
  }

  held(a: Action): boolean {
    return this.cur.has(a);
  }
  pressed(a: Action): boolean {
    return this.cur.has(a) && !this.prev.has(a);
  }
  released(a: Action): boolean {
    return !this.cur.has(a) && this.prev.has(a);
  }
  bufferedJump(windowFrames: number): boolean {
    return this.frame - this.jumpAt < windowFrames;
  }
  consumeJumpBuffer(): void {
    this.jumpAt = -1000;
  }
  get dirX(): -1 | 0 | 1 {
    const l = this.cur.has('left');
    const r = this.cur.has('right');
    return l && !r ? -1 : r && !l ? 1 : 0;
  }
}
