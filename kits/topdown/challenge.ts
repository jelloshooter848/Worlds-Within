import { DEFAULT_SCREEN, type ScreenSize } from '@engine/core/gfx/screen';
import type { JsonObject } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { MiniGame, MiniGameContext, MiniGameDef, MiniGameResult } from '@engine/core/minigame';
import type { PresentFrame } from '@engine/core/present';
import { presentWorld } from './present';
import { buildDungeon, type Dungeon, type LegendEntry, type RoomDef } from './room';
import { snapshotWorld, type TdSnapshot } from './snapshot';
import { TopDownWorld, type Spawner } from './world';
import type { TdItem } from './items';

/**
 * A one-room top-down challenge as a mini game (`engine/core/minigame.ts`): the adapter that lets
 * a host from another kit (a platformer level's door) push a tiny top-down round over itself. The
 * game supplies the room (a `RoomDef`, usually one of its room files); the kit supplies only the
 * rules. Each round is a fresh one-room `TopDownWorld` seeded from the round's seed, stepped with
 * the host's input:
 *
 *   const def = roomChallenge({ id: 'vault', title: 'THE VAULT', room });
 *   new PlatformerWorld(level, profile, { miniGames: [def] });
 *
 * The trigger's `params` say what the round is (`challengeParams`): `goal` (`defeat-all`: every
 * enemy in the room beaten; `reach`: an exit tile `E` reached), `ticks` (the time limit) and
 * `hp` (the hero's hit points, half hearts). The round passes on its goal, fails when the hero
 * dies (after his death spin) or time runs out, and quits on a press of select (which the round
 * takes before the world sees it, so it never cycles the hero's items). Pure: nothing random but
 * the seed, no drawing.
 */

/** What a round asks of the hero. */
export type ChallengeGoal = 'defeat-all' | 'reach';

/** Every goal, in a fixed order (for docs and messages). */
export const CHALLENGE_GOALS: readonly ChallengeGoal[] = ['defeat-all', 'reach'];

/** The time limit when the params give none: 30 seconds at 60 ticks a second. */
export const CHALLENGE_TICKS = 1800;

/** A round's params, read from the trigger's JSON (`challengeParams`). */
export interface ChallengeParams {
  goal: ChallengeGoal;
  /** Ticks the round may last; on the last one, if the goal is not met, it fails. */
  ticks: number;
  /** The hero's hit points in half hearts (the kit's default, 6, when left out). */
  hp?: number;
}

/**
 * The params from a trigger's JSON: `goal` (required, one of `CHALLENGE_GOALS`), `ticks` (a whole
 * number of at least 1, `CHALLENGE_TICKS` when left out) and `hp` (a whole number of at least 1).
 * Throws naming the field on anything else, so a level's mistake shows at its first round.
 */
export function challengeParams(raw: JsonObject): ChallengeParams {
  const known = new Set(['goal', 'ticks', 'hp']);
  for (const key of Object.keys(raw))
    if (!known.has(key)) throw new Error(`room challenge: unknown param "${key}" (known: goal, ticks, hp)`);
  const goal = raw['goal'];
  if (typeof goal !== 'string' || !(CHALLENGE_GOALS as readonly string[]).includes(goal))
    throw new Error(`room challenge: param "goal" must be one of ${CHALLENGE_GOALS.join(', ')}`);
  const whole = (key: string): number | undefined => {
    const v = raw[key];
    if (v === undefined) return undefined;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1)
      throw new Error(`room challenge: param "${key}" must be a whole number of at least 1`);
    return v;
  };
  const params: ChallengeParams = { goal: goal as ChallengeGoal, ticks: whole('ticks') ?? CHALLENGE_TICKS };
  const hp = whole('hp');
  if (hp !== undefined) params.hp = hp;
  return params;
}

/** What a game gives `roomChallenge`: the mini game's id and title, its room and world options. */
export interface RoomChallengeOptions {
  /** The mini game id level data names it by (lower-case letters, digits and "-"). */
  id: string;
  /**
   * Its title, e.g. 'THE VAULT'; the room's `title` when left out, else the id in capitals
   * (Engine 0.7 T9, gap G15: a title is data, in the room file).
   */
  title?: string;
  /** The room, from the game's content (one room: its doors, if any, lead nowhere). */
  room: RoomDef;
  /** The game's own legend characters for the room (as for `buildDungeon`). */
  extraLegend?: Readonly<Record<string, LegendEntry>>;
  /** Tiles of outer wall (1 by default, as `buildDungeon`). */
  wall?: number;
  /** Extra spawn kinds for the room (the game's own enemies). */
  spawners?: Readonly<Record<string, Spawner>>;
  /** The items there are (the kit's by default). */
  items?: Readonly<Record<string, TdItem>>;
  /** Kit rules switched off in every round (ids from `TOPDOWN_RULES`), for mutant checks. */
  disabledRules?: readonly string[];
  /** The picture size `present()` describes (`DEFAULT_SCREEN` when left out). */
  size?: ScreenSize;
  /** Where the play area starts on that picture (the kit's `HUD_H` when left out). */
  top?: number;
}

/**
 * The round's snapshot: the kit's `snapshotWorld` (the last step's events included) plus
 * `round`: `goal`, `ticks` (stepped so far), `limit`, `attempt` and `result` (null while on).
 */
export interface ChallengeSnapshot extends TdSnapshot {
  round: { goal: string; ticks: number; limit: number; attempt: number; result: MiniGameResult | null };
}

/** One round of a room challenge: a `MiniGame` over a one-room `TopDownWorld`. */
export class RoomChallenge implements MiniGame {
  /** The round's world (read it, e.g. for a test bot; the round steps it). */
  readonly world: TopDownWorld;
  readonly params: ChallengeParams;
  private ticks = 0;
  private ended: MiniGameResult | null = null;
  private last: object[];

  constructor(
    dungeon: Dungeon,
    private readonly opts: RoomChallengeOptions,
    private readonly ctx: MiniGameContext,
    seed: number,
  ) {
    this.params = challengeParams(ctx.params);
    this.world = new TopDownWorld(dungeon, {
      seed,
      ...(this.params.hp !== undefined ? { maxHp: this.params.hp } : {}),
      ...(opts.spawners ? { spawners: opts.spawners } : {}),
      ...(opts.items ? { items: opts.items } : {}),
      ...(opts.disabledRules ? { disabledRules: opts.disabledRules } : {}),
    });
    if (this.params.goal === 'defeat-all' && this.world.enemies().length === 0)
      throw new Error(
        `room challenge "${opts.id}": goal defeat-all, but room "${opts.room.id}" has no enemies`,
      );
    this.last = this.world.events.splice(0);
  }

  step(input: InputFrame): void {
    if (this.ended) return;
    if (input.pressed('select')) {
      this.ended = 'quit';
      this.last = [];
      return;
    }
    this.world.update(input);
    this.last = this.world.events.splice(0);
    this.ticks++;
    if (this.goalMet()) this.ended = 'pass';
    else if (this.world.hero.dead || this.ticks >= this.params.ticks) this.ended = 'fail';
  }

  result(): MiniGameResult | null {
    return this.ended;
  }

  snapshot(): ChallengeSnapshot {
    return {
      ...snapshotWorld(this.world, this.last),
      round: {
        goal: this.params.goal,
        ticks: this.ticks,
        limit: this.params.ticks,
        attempt: this.ctx.attempt,
        result: this.ended,
      },
    };
  }

  /**
   * The kit's `presentWorld` frame of the round, at the options' size, with `status.timeLeft`
   * (ticks) and `status.goal` added. No stream state: every frame carries the full map (a host's
   * own tracker trims it) and ids of things the room text did not place count from 1 per frame.
   */
  present(): PresentFrame {
    const frame = presentWorld(this.world, this.last, {
      size: this.opts.size ?? DEFAULT_SCREEN,
      ...(this.opts.top !== undefined ? { top: this.opts.top } : {}),
    });
    frame.status = {
      ...frame.status,
      goal: this.params.goal,
      timeLeft: Math.max(0, this.params.ticks - this.ticks),
    };
    return frame;
  }

  private goalMet(): boolean {
    if (this.params.goal === 'reach') return this.world.exited;
    return this.world.enemies().length === 0;
  }
}

/**
 * A room challenge as a `MiniGameDef`. The room is checked once, here (it throws like
 * `buildDungeon`); each round (`create`) builds a fresh world on it from the round's seed and
 * reads the trigger's params (`challengeParams`, which throws on bad ones).
 */
export function roomChallenge(opts: RoomChallengeOptions): MiniGameDef {
  const dungeon = buildDungeon([opts.room], opts.extraLegend ?? {}, { wall: opts.wall ?? 1 });
  return {
    id: opts.id,
    title: opts.title ?? opts.room.title ?? opts.id.toUpperCase().replace(/-/g, ' '),
    create: (ctx, seed) => new RoomChallenge(dungeon, opts, ctx, seed),
  };
}
