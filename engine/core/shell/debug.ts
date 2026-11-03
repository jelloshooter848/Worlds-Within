import type { HeadlessGame, JsonObject, JsonValue, RoundRecording } from '../headless';
import type { Action } from '../input/actions';
import type { InputFrame } from '../input/input-manager';
import { ScriptedInput, type InputScript } from '../input/scripted-input';
import { stateHash } from '../state-hash';

/**
 * The page-side step hook (Engine 0.14 T8, gap G31; docs/BUILD-LOG.md, Engine 0.14, decision 9,
 * item 255): what `bootBrowserGame` puts on `window.__ww` in manual-loop mode (`manual: true`, or
 * `?debug=step` in the page's URL). The page's `FixedLoop` then never runs on
 * `requestAnimationFrame`; a script (a browser test, a person in the console, later the debugger)
 * steps the scene stack exactly n 60 Hz steps with `step(n)`, reads the game's headless snapshot
 * and its state hash (core's `stateHash`, the tools' hash), and can `replay` a run file: its input
 * goes through a `ScriptedInput` in place of the keyboard, and its recorded orders and mission
 * steps go to the game (when it takes them) before the step from their tick, as `pnpm cli run`
 * hands them over. So tick N of the page is tick N of the run file, and the page's hashes can be
 * compared with the golden `.hashes.json`.
 *
 * The game is the headless game of the topmost scene that reports one (`Scene.headless()`;
 * `HostScene` given a `game` does). A page without one still steps; `hash()` and `snapshot()` are
 * then null. This file holds no DOM and no clock: `boot.ts` installs it. Pure (on `PURE_CORE`).
 */
export interface PageDebug {
  /** The 60 Hz steps the page has taken (in a replay, the run file's tick). */
  readonly tick: number;
  /** True while a run file's input drives the page (from `replay` on). */
  readonly replaying: boolean;
  /** The orders and mission steps the game refused during the replay (not errors, as in a run). */
  readonly refused: readonly ReplayRefusal[];
  /** Takes exactly `n` steps (default 1), then draws once; returns `tick`. */
  step(n?: number): number;
  /** The state hash of the game's snapshot now (16 hex digits), or null with no headless game. */
  hash(): string | null;
  /** The game's headless snapshot now (plain JSON), or null with no headless game. */
  snapshot(): JsonObject | null;
  /**
   * Replays a run file (its parsed JSON) from here on: from the next step the page reads its
   * `input` instead of the keyboard and hands the game its `orders` and `missions`. Only from tick
   * 0 (a fresh page) and only for a run file of the page's own start: one with `world`, `from`,
   * `start` or `disableRules` is refused (the page plays its game from its own start with every
   * rule on), as are `orders` or `missions` for a game that does not take them. Throws an `Error`
   * naming the problem; returns the run's `ticks`.
   */
  replay(run: unknown): { ticks: number };
  /**
   * Recording (Engine 0.14 T9, gap M19): `record()` (or `record(true)`; the page's URL with
   * `?record` does it at boot) makes the game record the input of every hosted round that starts
   * from the next step on (`HeadlessGame.recordRounds`; `MissionHost` has it), `record(false)`
   * stops. Returns whether the game can record (false for a page with no headless game or one
   * without the hook; the request stays on and reaches a game that comes later).
   */
  record(on?: boolean): boolean;
  /** True while recording is on. */
  readonly recording: boolean;
  /**
   * The rounds recorded so far, `{ mission, tick, ticks, done, input }` each, as plain JSON: copy
   * one (or the list) into a file and `pnpm cli record <runFile> --mission <id> --input <file>`
   * writes its `input` into the run file's `play` step. `[]` with nothing recorded.
   */
  recordings(): RoundRecording[];
}

/** An order or mission step the game refused during a replay. */
export interface ReplayRefusal {
  /** The tick of its entry in the run file. */
  tick: number;
  kind: 'order' | 'mission';
  /** The game's reason (an order's line, or a mission refusal's `code: error`). */
  error: string;
}

/** What the hook steps and reads: the loop's `advance` and the game on the scene stack now. */
export interface PageDebugTarget {
  /** Exactly n steps, then one draw (`FixedLoop.advance`); each step calls `frame`. */
  advance(n: number): void;
  /** The steps taken so far. */
  steps(): number;
  /** The headless game the page plays now, or null. */
  game(): HeadlessGame | null;
}

/** A replay in progress: the input and the run's entries still to hand over. */
interface Replay {
  input: ScriptedInput;
  orders: { tick: number; entry: JsonObject }[];
  missions: { tick: number; entry: JsonObject }[];
}

/** The fields of a run file that set up a game the page cannot play from its own start. */
const SETUP_FIELDS = ['world', 'from', 'start'] as const;

/**
 * The step hook's state: `api` is what goes on `window.__ww`; the boot's loop step calls
 * `frame(live)` once per step for the input frame to step the scenes with (the live one, or the
 * replay's, after handing the game that tick's orders and missions).
 */
export class PageDebugHook {
  private replaying: Replay | null = null;
  private recordingOn = false;
  private readonly refusals: ReplayRefusal[] = [];
  readonly api: PageDebug;

  constructor(private readonly target: PageDebugTarget) {
    const isReplaying = () => this.replaying !== null;
    const isRecording = () => this.recordingOn;
    const refused = () => this.refusals;
    this.api = {
      get tick() {
        return target.steps();
      },
      get replaying() {
        return isReplaying();
      },
      get refused() {
        return refused();
      },
      step(n = 1) {
        if (!Number.isInteger(n) || n < 0)
          throw new Error(`step(n): n must be a whole number >= 0, got ${n}`);
        target.advance(n);
        return target.steps();
      },
      hash() {
        const snapshot = target.game()?.snapshot();
        return snapshot === undefined ? null : stateHash(snapshot);
      },
      snapshot() {
        return target.game()?.snapshot() ?? null;
      },
      replay: (run) => this.start(run),
      get recording() {
        return isRecording();
      },
      record: (on = true) => this.record(on),
      recordings: () =>
        JSON.parse(JSON.stringify(target.game()?.roundRecordings?.() ?? [])) as RoundRecording[],
    };
  }

  /** Turns recording on or off on the game now, and on any game the page plays later. */
  private record(on: boolean): boolean {
    this.recordingOn = on;
    const game = this.target.game();
    game?.recordRounds?.(on);
    return game?.recordRounds !== undefined;
  }

  /** The frame the step reads: the live one, or the replay's next frame after this tick's entries. */
  frame(live: InputFrame): InputFrame {
    // Recording reaches the game the page plays now (a new campaign entry is a new game).
    if (this.recordingOn) this.target.game()?.recordRounds?.(true);
    const replay = this.replaying;
    if (replay === null) return live;
    const tick = this.target.steps();
    const game = this.target.game();
    // As `pnpm cli run`: a tick's orders, then its mission steps, go in before the step from it.
    while (replay.orders.length > 0 && replay.orders[0]!.tick === tick) {
      const { entry } = replay.orders.shift()!;
      const error = game?.order ? game.order(entry) : 'the page has no game that takes orders';
      if (error !== null) this.refusals.push({ tick, kind: 'order', error });
    }
    while (replay.missions.length > 0 && replay.missions[0]!.tick === tick) {
      const { entry } = replay.missions.shift()!;
      const refused = game?.mission
        ? game.mission(entry)
        : { code: 'no_missions', error: 'the page has no game that takes mission steps' };
      if (refused !== null)
        this.refusals.push({ tick, kind: 'mission', error: `${refused.code}: ${refused.error}` });
    }
    replay.input.next();
    return replay.input;
  }

  private start(json: unknown): { ticks: number } {
    if (this.target.steps() !== 0)
      throw new Error(`replay: the page is at tick ${this.target.steps()}; a run file replays from tick 0`);
    if (!isObject(json)) throw new Error('replay: a run file is a JSON object');
    for (const field of SETUP_FIELDS)
      if (json[field] !== undefined)
        throw new Error(
          `replay: the page plays its game from its own start; a run file with "${field}" cannot replay here`,
        );
    const disabled = json['disableRules'];
    if (Array.isArray(disabled) && disabled.length > 0)
      throw new Error(
        'replay: the page plays with every rule on; a run file with "disableRules" cannot replay here',
      );
    const ticks = json['ticks'];
    if (typeof ticks !== 'number' || !Number.isInteger(ticks) || ticks < 1)
      throw new Error('replay: the run file has no "ticks" (a whole number >= 1)');
    const input = inputScript(json['input']);
    const orders = entries(json['orders'], 'orders');
    const missions = entries(json['missions'], 'missions');
    const game = this.target.game();
    if (orders.length > 0 && !game?.order)
      throw new Error('replay: the run file has "orders" and the page\'s game takes none');
    if (missions.length > 0 && !game?.mission)
      throw new Error('replay: the run file has "missions" and the page\'s game takes no mission steps');
    this.replaying = { input: new ScriptedInput(input), orders, missions };
    this.refusals.length = 0;
    return { ticks };
  }
}

function isObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A run file's `input`, checked enough to step it (the tools' schema checks the rest). */
function inputScript(value: unknown): InputScript {
  if (value === undefined) return { steps: [] };
  if (!isObject(value) || !Array.isArray(value['steps'])) throw new Error('replay: "input" needs "steps"');
  const steps = value['steps'].map((step, i) => {
    if (!isObject(step) || typeof step['frame'] !== 'number' || !Array.isArray(step['hold']))
      throw new Error(`replay: input.steps.${i} needs "frame" and "hold"`);
    return { frame: step['frame'], hold: step['hold'] as Action[] };
  });
  return { steps };
}

/** A run file's `orders` or `missions`: each entry without its `tick`, in file order. */
function entries(value: unknown, name: string): { tick: number; entry: JsonObject }[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`replay: "${name}" is a list`);
  return value.map((item, i) => {
    if (!isObject(item) || typeof item['tick'] !== 'number')
      throw new Error(`replay: ${name}.${i} needs a "tick"`);
    const { tick, ...entry } = item;
    return { tick: tick as number, entry: entry as JsonObject };
  });
}
