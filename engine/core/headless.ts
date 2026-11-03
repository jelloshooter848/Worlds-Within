import type { CampaignSave } from './campaign';
import type { ContentBundle } from './content/bundle';
import type { InputFrame } from './input/input-manager';
import type { InputScript } from './input/scripted-input';
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
   * Optional (Engine 0.11, item 172): takes one mission step between steps. A game run file's
   * `missions` entry `{ "tick": t, "mission": id, "action": "open" | "delegate" | "play" | "quit",
   * "input"? }` is handed over, without `tick`, after the snapshot of tick `t` and after that tick's
   * orders, in file order. `play` starts the mission's real kit round (its `input`, when given, is
   * the round's recorded `ScriptedInput` script, frame 0 being the round's first tick); the game's
   * following steps play that round until it ends. Returns null when the step was taken, or the
   * refusal (`{ code, error }`, the sim's codes where it has one; not an error: the run reports it).
   * A game without `mission` cannot play a run file with `missions` (a usage error).
   * `MissionHost` (`mission-host.ts`) is one.
   */
  mission?(step: JsonObject): MissionStepRefusal | null;
  /**
   * Optional (Engine 0.11): the ticks the game's played mission rounds have taken so far, per
   * mission in first-play order (the mission's experience time, which never moves the world). The
   * tools report it as a run's `experience`.
   */
  missionExperience?(): readonly { mission: string; ticks: number }[];
  /**
   * Optional (Engine 0.10, gap G37, item 159): the round the game is hosting now (a mini game
   * started by a level trigger), or null. The game still steps the round in `step` and applies
   * its result; the browser shell's `HostScene` reads this to push the round's scene. Games that
   * host no rounds leave it out.
   */
  miniGame?(): MiniGame | null;
  /**
   * Optional (Engine 0.13, decision 9, item 228): the campaign save the game's campaign would have
   * if the entry played now ended at this tick (`campaign.ts`): position + 1, the carried record
   * built from the world now for the next scenario entry, and the missions committed so far in this
   * entry added to the results; null when the game plays no campaign. Must not change the game. The
   * tools pack it into a save code (`campaign-code.ts`) for a run file's `codes`, `pnpm cli code`
   * and a later run's `from`. A game without it cannot take a run file's `from` or `codes` (a usage
   * error).
   */
  campaignSave?(): CampaignSave | null;
  /**
   * Optional (Engine 0.14 T7, decision 3, item 249): the game's world event log from world tick
   * `sinceTick` (`WorldEvents`): the committed changes with `tick >= sinceTick`, oldest first, plain
   * JSON-safe data. Read beside `snapshot()` and never part of it, so it never changes a state hash.
   * Must not change the game. A game with no world (a platformer) leaves it out, and the tools say
   * `no_world` for `events` and `timeline`. Named `worldEvents`, not `events`: a `HostedGame`'s
   * `events` is its last step's draw events. `MissionHost` has it when its port does.
   */
  worldEvents?(sinceTick: number): WorldEvents;
  /**
   * Optional (Engine 0.14 T7, decision 4, item 250): the timeline record of the game's world now
   * (`timelineOf` in `engine/sim/timeline.ts`, `worlds-within/timeline`), with the game's own
   * experience ticks per played mission and `clock` null (the tools fill it while they play). Must
   * not change the game. `MissionHost` has it when its port does.
   */
  timeline?(): JsonObject;
  /**
   * Optional (Engine 0.14 T9, gap M19): from now on (`on` true) record the input of every hosted
   * round that starts, or stop (`on` false; what was recorded is kept). `MissionHost` has it. Never
   * part of `snapshot()`, so no hash moves.
   */
  recordRounds?(on: boolean): void;
  /**
   * Optional (Engine 0.15 T7, gap M17; docs/BUILD-LOG.md, Engine 0.15, decision 8): the key table
   * of the game's world, scenario key to entity id (`worldKeys` in `engine/sim`), so a run file's
   * checks can name an entity by key (`world.key.ram.Health.hp`). Fixed for the run; never part of
   * `snapshot()`, so no hash moves. `MissionHost` has it (empty when its port gives no keys).
   */
  worldKeys?(): Readonly<Record<string, number>>;
  /** Optional (Engine 0.14 T9): the rounds recorded so far, in play order, as plain JSON. */
  roundRecordings?(): RoundRecording[];
}

/**
 * One hosted round's recorded input (Engine 0.14 T9, gap M19): the mission it played, the game
 * tick its `play` step was taken at (the run file's `missions[].tick`) and its input from the
 * round's frame 0, the shortest `ScriptedInput` script (`input/input-recorder.ts`): what a run
 * file's `play` step takes as `input`. `ticks` is the round's length so far and `done` whether it
 * has ended.
 */
export interface RoundRecording {
  mission: string;
  tick: number;
  ticks: number;
  done: boolean;
  input: InputScript;
}

/**
 * A world's event log as a game hands it over (`HeadlessGame.worldEvents`, Engine 0.14 T7): `from`
 * the oldest world tick the log still keeps (asking for older ticks gives what is kept, never an
 * error), `tick` the world tick now (so the tools can sample world time per game tick), and
 * `changes` the kept changes from the asked tick on (the sim's `Change`s, plain data).
 */
export interface WorldEvents {
  from: number;
  tick: number;
  changes: JsonObject[];
}

/** Why a game refused a mission step: a short code and a one-line reason. */
export interface MissionStepRefusal {
  code: string;
  error: string;
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
   * passes them to its kit; the tools have already checked the ids against the kit's list. These
   * are the rules of the game's own kit (`kit` in `game.json`); a kit it `uses` has its own list in
   * `disabledRulesByKit`.
   */
  disabledRules?: readonly string[];
  /**
   * Engine 0.14 (gap G12, decision 8): the rules switched off per kit, by kit name, for every kit
   * the game uses (`kit` and each of `uses`; the main kit's list equals `disabledRules`). A game on
   * two or more kits routes each list to that kit's own rule switch (the round of a kit it `uses`
   * takes its list as the round's `disabledRules`), so each `RuleSwitch` only sees its own ids;
   * `rulesOffFor(opts, kit)` reads one. A run file names another kit's rule as `kit:id`.
   */
  disabledRulesByKit?: Readonly<Record<string, readonly string[]>>;
  /**
   * Optional (Engine 0.13, decision 9): start the game at this campaign save (from a run file's
   * `from`: another run's end, or a save code), at the entry its `position` names, from tick 0 and
   * with its carried record (`worldFromScenario(json, { carried })` for a scenario entry). Left
   * out, the game starts as it always does. A game that has no `campaignSave` ignores it (the tools
   * refuse such a run first).
   */
  campaign?: CampaignSave;
  /**
   * Optional (Engine 0.14, gap G9, decision 6): where to start, from a run file's `start`: a level
   * of the game's level sequence (`{ stage }`, 0-based like the platformer kit's snapshot `stage`)
   * or a campaign entry by id (`{ entry }`, played fresh: at its own start, with no carried record
   * and nothing committed before it). Tick 0 is then that level's or entry's first state. Left out,
   * the game starts as it always does. The tools only pass a start the game lists in its
   * `HeadlessEntry.starts(content)`, and never with `campaign`.
   */
  start?: RunStart;
}

/**
 * The rules switched off for kit `kit` (Engine 0.14, gap G12): `opts.disabledRulesByKit[kit]`,
 * else none. A game passes the result to that kit's rounds or world.
 */
export function rulesOffFor(opts: HeadlessOptions | undefined, kit: string): readonly string[] {
  return opts?.disabledRulesByKit?.[kit] ?? [];
}

/**
 * Where a run starts (Engine 0.14, gap G9): a stage of the game's level sequence (0-based) or a
 * campaign entry by id. `HeadlessOptions.start`, from a run file's `start`.
 */
export type RunStart = { stage: number } | { entry: string };

/**
 * The starts a game can honour (`HeadlessEntry.starts`, Engine 0.14, gap G9): `stages`, the level
 * ids of its level sequence in play order (a `{ stage: n }` start picks `stages[n]`), and
 * `entries`, the ids of its campaign's entries in play order (`{ entry: id }`). Either may be left
 * out: a game without stages refuses `{ stage }`, one without entries `{ entry }`.
 */
export interface HeadlessStarts {
  stages?: readonly string[];
  entries?: readonly string[];
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
  /**
   * Optional (Engine 0.14, gap G9): the starts the game can honour (`HeadlessStarts`), for a run
   * file's `start`. The tools check `start` against them before the first step: a game without
   * this export cannot take `start` at all (`no_start`), and a stage or entry it does not list is
   * refused (`bad_start`). Reads the content only: it starts nothing.
   */
  starts?(content: ContentBundle): HeadlessStarts;
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
