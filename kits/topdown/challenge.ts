import { z } from 'zod';
import { DEFAULT_SCREEN, type ScreenSize } from '@engine/core/gfx/screen';
import type { JsonObject } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import type {
  MiniGame,
  MiniGameContext,
  MiniGameDef,
  MiniGameInputMap,
  MiniGameResult,
} from '@engine/core/minigame';
import type { PresentFrame } from '@engine/core/present';
import { presentWorld } from './present';
import { buildDungeon, type Dungeon, type LegendEntry, type RoomDef } from './room';
import { snapshotWorld, type TdSnapshot } from './snapshot';
import { TopDownWorld, type Spawner } from './world';
import type { TdItem } from './items';
import type { TdEnemy } from './entity';

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
 * The shape of a round's params (gap G16, Engine 0.10): `goal` (required, one of
 * `CHALLENGE_GOALS`), `ticks` (a whole number of at least 1, `CHALLENGE_TICKS` when left out) and
 * `hp` (a whole number of at least 1), nothing else. It is the def's `paramsSchema`, so
 * `pnpm cli validate` checks a level's trigger params with the content; `challengeParams` runs it
 * again when a round starts.
 */
export const challengeParamsSchema = z.strictObject({
  goal: z
    .enum(['defeat-all', 'reach'])
    .describe('what the round asks: every enemy beaten, or an exit tile reached'),
  ticks: z.int().min(1).exactOptional().describe('the time limit in ticks (1800 when left out)'),
  hp: z
    .int()
    .min(1)
    .exactOptional()
    .describe("the hero's hit points in half hearts (the kit's default when left out)"),
});

/**
 * The params from a trigger's JSON, checked by `challengeParamsSchema`. Throws naming the field on
 * anything else (`room challenge: unknown param "lives" (known: goal, ticks, hp)`, `room
 * challenge: param "ticks": ...`), so content `validate` did not see still fails at its round.
 */
export function challengeParams(raw: JsonObject): ChallengeParams {
  const parsed = challengeParamsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    if (issue.code === 'unrecognized_keys')
      throw new Error(`room challenge: unknown param "${issue.keys[0]!}" (known: goal, ticks, hp)`);
    throw new Error(`room challenge: param "${issue.path.map(String).join('.')}": ${issue.message}`);
  }
  const { goal, ticks = CHALLENGE_TICKS, hp } = parsed.data;
  const params: ChallengeParams = { goal, ticks };
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
  /**
   * The host HUD status keys a round shows (Engine 0.11, gap G19): the def's `hostStatus`, so a
   * host hands their values in `ctx.hostStatus` (`hostStatusFor`) and `present()` adds them as
   * `host:<key>` for the round's skin to draw. Left out, the round shows its own HUD only.
   */
  hostStatus?: readonly string[];
  /** The round's own controls (gap G18): the def's `inputMap`, applied by the host's `RoundInput`. */
  inputMap?: MiniGameInputMap;
  /**
   * Hit points for some of the room's enemies, by room key (`"<col>,<row>"`), set when the round
   * starts instead of the kind's own (Engine 0.11: a mission room's foes take the world's health,
   * `mission-room.ts`). Left out, every enemy has its kind's hp.
   */
  foeHp?: Readonly<Record<string, number>>;
}

/**
 * The round's snapshot: the kit's `snapshotWorld` (the last step's events included) plus
 * `round`: `goal`, `ticks` (stepped so far), `limit`, `attempt` and `result` (null while on).
 */
export interface ChallengeSnapshot extends TdSnapshot {
  round: { goal: string; ticks: number; limit: number; attempt: number; result: MiniGameResult | null };
}

/** One enemy the room started with, as the round's report gives it. */
export interface ChallengeFoe extends JsonObject {
  /** Where the room text placed it, `"<col>,<row>"` (its snapshot `key`). */
  key: string;
  kind: string;
  /** Hit points at the start of the round and now (0 or less once beaten). */
  hp: number;
  startHp: number;
  /** Beaten in this round. */
  defeated: boolean;
}

/**
 * The round's structured report (`MiniGame.report()`, Engine 0.10 T7): plain JSON a mission's
 * adapter maps to one of the mission's declared outcomes. `result` and the round's ticks; `hero`
 * (`hp`, `maxHp`, `lost`: half hearts lost in the round, `dead`); `foes`, every enemy the room
 * started with in room-text order; and, by key, `defeated` (what was destroyed) and `hurt` (hit
 * but still standing). It only reads the round, so snapshots and hashes are the same with or
 * without it.
 */
export interface ChallengeReport extends JsonObject {
  result: MiniGameResult | null;
  goal: ChallengeGoal;
  ticks: number;
  limit: number;
  hero: { hp: number; maxHp: number; lost: number; dead: boolean };
  foes: ChallengeFoe[];
  defeated: string[];
  hurt: string[];
}

/** One round of a room challenge: a `MiniGame` over a one-room `TopDownWorld`. */
export class RoomChallenge implements MiniGame {
  /** The round's world (read it, e.g. for a test bot; the round steps it). */
  readonly world: TopDownWorld;
  readonly params: ChallengeParams;
  private ticks = 0;
  private ended: MiniGameResult | null = null;
  private last: object[];
  /** The room's enemies as the round began, with their starting hit points (for `report`). */
  private readonly foes: { enemy: TdEnemy; key: string; startHp: number }[];
  private readonly heroStartHp: number;

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
    for (const enemy of this.world.enemies()) {
      const hp = enemy.key === null ? undefined : opts.foeHp?.[enemy.key];
      if (hp !== undefined) enemy.hp = hp;
    }
    this.foes = this.world.enemies().map((enemy) => ({ enemy, key: enemy.key ?? '', startHp: enemy.hp }));
    this.heroStartHp = this.world.hero.hp;
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

  /** The round's structured report (`ChallengeReport`); final once `result()` is non-null. */
  report(): ChallengeReport {
    const hero = this.world.hero;
    const foes: ChallengeFoe[] = this.foes.map(({ enemy, key, startHp }) => ({
      key,
      kind: enemy.kind,
      hp: enemy.hp,
      startHp,
      defeated: enemy.dead,
    }));
    return {
      result: this.ended,
      goal: this.params.goal,
      ticks: this.ticks,
      limit: this.params.ticks,
      hero: {
        hp: hero.hp,
        maxHp: hero.maxHp,
        lost: Math.max(0, this.heroStartHp - hero.hp),
        dead: hero.dead,
      },
      foes,
      defeated: foes.filter((f) => f.defeated).map((f) => f.key),
      hurt: foes.filter((f) => !f.defeated && f.hp < f.startHp).map((f) => f.key),
    };
  }

  /**
   * The kit's `presentWorld` frame of the round, at the options' size, with `status.timeLeft`
   * (ticks) and `status.goal` added, and each of the host's values the round was given
   * (`ctx.hostStatus`, gap G19) as `status['host:<key>']`; a round given none is unchanged. No stream state: every frame carries the full map (a host's
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
    for (const [key, value] of Object.entries(this.ctx.hostStatus ?? {})) frame.status[`host:${key}`] = value;
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
 * reads the trigger's params (`challengeParams`, which throws on bad ones). Its `paramsSchema` is
 * `challengeParamsSchema`, so `validate` checks those params with the content (gap G16). The
 * options' `hostStatus` and `inputMap` become the def's (gaps G19 and G18).
 */
export function roomChallenge(opts: RoomChallengeOptions): MiniGameDef {
  const dungeon = buildDungeon([opts.room], opts.extraLegend ?? {}, { wall: opts.wall ?? 1 });
  return {
    id: opts.id,
    title: opts.title ?? opts.room.title ?? opts.id.toUpperCase().replace(/-/g, ' '),
    paramsSchema: challengeParamsSchema,
    ...(opts.hostStatus ? { hostStatus: opts.hostStatus } : {}),
    ...(opts.inputMap ? { inputMap: opts.inputMap } : {}),
    create: (ctx, seed) => new RoomChallenge(dungeon, opts, ctx, seed),
  };
}
