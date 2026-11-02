import type { JsonObject, JsonValue } from './headless';
import type { InputFrame } from './input/input-manager';
import { RoundInput, type MiniGame, type MiniGameInputMap, type MiniGameResult } from './minigame';
import {
  missionResult,
  playedResult,
  type MissionAdapter,
  type MissionDef,
  type MissionResult,
} from './missions';

/**
 * Playing a mission through a kit's mini game (Engine 0.10 T7; the roadmap's "a small adapter
 * turns a mission's snapshot into what a kit needs and the kit's report into a mission result").
 * Plain data only, so a kit, a game or a test can use it without importing `engine/sim`:
 *
 *   const opened = openMission(world, raid, { refs });              // engine/sim: the snapshot
 *   const played = playMissionRound({
 *     mission: opened.mission, snapshot: opened.snapshot, adapter,  // adapter: per kit and game
 *     start: (input) => def.create({ params: input.params, attempt: 1 }, seed),
 *     input: (tick, round) => frame,                                // the player's, or a script's
 *   });
 *   if (played.ok && played.quit) quitMission(world, 'raid');       // engine/sim: a quit
 *   if (played.ok) commitMission(world, 'raid', played.result);    // engine/sim: the commit
 *
 * `adapter.input` builds the kit's input from the plain world snapshot (`snapshotEntities` reads
 * it), the round is stepped to its end, and `adapter.outcome` maps the round's end
 * (`MiniGameEnd`: pass, fail or quit and the kit's `report()`) to one declared outcome. The result
 * is checked against the mission's declared (and playable) outcomes by `playedResult`: a report the
 * adapter cannot map (it throws) or one that names an outcome the mission does not declare is
 * refused, never committed. A round that ends in `quit` is not a played result: it skips the
 * adapter and the `playable` check, resolves to the mission's `onQuit` (with no report) and comes
 * back with `quit: true`, so the caller resolves it with `quitMission` (resolution `quit`) before
 * committing.
 */

/** One entity of a plain world snapshot: its id and its components by name. */
export interface SnapshotEntity {
  readonly id: number;
  readonly components: Readonly<Record<string, JsonValue>>;
}

/**
 * The entities of a plain world snapshot (`{ entities, components: { Name: [[id, data], ...] } }`,
 * as `engine/sim`'s `World.snapshot()` gives it) that have every component in `having`, ascending
 * by id, each with all of its components. Throws when the snapshot is not of that shape.
 */
export function snapshotEntities(snapshot: JsonObject, ...having: string[]): SnapshotEntity[] {
  const lists = snapshot['components'];
  if (typeof lists !== 'object' || lists === null || Array.isArray(lists))
    throw new Error('the snapshot has no "components" object (is it a world snapshot?)');
  const byId = new Map<number, Record<string, JsonValue>>();
  for (const [name, list] of Object.entries(lists)) {
    if (!Array.isArray(list)) throw new Error(`snapshot component "${name}" is not a list`);
    for (const pair of list) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'number' || pair.length !== 2)
        throw new Error(`snapshot component "${name}" has an entry that is not [id, data]`);
      const own = byId.get(pair[0]) ?? {};
      own[name] = pair[1] as JsonValue;
      byId.set(pair[0], own);
    }
  }
  return [...byId.entries()]
    .filter(([, components]) => having.every((name) => name in components))
    .sort(([a], [b]) => a - b)
    .map(([id, components]) => ({ id, components }));
}

/** How a mini game round ended, as an adapter reads it: the result and the kit's report. */
export interface MiniGameEnd {
  readonly result: MiniGameResult;
  /** The round's `report()`, or null when the mini game gives none. */
  readonly report: JsonObject | null;
  /** Ticks stepped: the mission's experience time, which never moves the world. */
  readonly ticks: number;
}

/** What `playMissionRound` needs. */
export interface MissionRoundOptions<KitInput> {
  readonly mission: MissionDef;
  /** The plain world snapshot the mission opened with. */
  readonly snapshot: JsonObject;
  readonly adapter: MissionAdapter<KitInput, MiniGameEnd>;
  /** Starts the kit's round from the adapter's input (e.g. a `MiniGameDef`'s `create`). */
  start(input: KitInput): MiniGame;
  /**
   * The input for round tick `tick` (0 first), already advanced to that tick's frame. The round
   * sees it through a `RoundInput` (Engine 0.11, gap G18): a button already held on tick 0 (held,
   * not pressed there) is ignored until released, and `inputMap` is applied.
   */
  input(tick: number, round: MiniGame): InputFrame;
  /** The round's own controls (its def's `inputMap`), applied to every frame. */
  readonly inputMap?: MiniGameInputMap;
  /** Ticks the round may take before it is refused as unfinished (default 100,000). */
  readonly maxTicks?: number;
}

export type MissionRoundRefusal = 'unfinished' | 'unmappable_report' | 'unknown_outcome';

export type MissionRoundResult =
  | {
      ok: true;
      /** The round was quit: `result` is the mission's `onQuit`; resolve it with `quitMission`. */
      quit: boolean;
      result: MissionResult;
      end: MiniGameEnd;
      round: MiniGame;
    }
  | { ok: false; code: MissionRoundRefusal; error: string; end: MiniGameEnd | null; round: MiniGame };

/** The default cap on a round's ticks. */
export const MISSION_ROUND_MAX_TICKS = 100_000;

/**
 * Play mission `mission` through a kit: build the kit's input with `adapter.input(snapshot)`, start
 * the round, step it with `input(tick)` until `result()` is non-null, then map its end through
 * `adapter.outcome` and check the outcome against the declared space. Refused (nothing to commit):
 * `unfinished` (no result within `maxTicks`), `unmappable_report` (the adapter threw: the report
 * fits no outcome) and `unknown_outcome` (the adapter named an outcome the mission does not
 * declare, or, with `playable`, one a player cannot reach). A `quit` end resolves to `onQuit`
 * without the adapter (`quit: true`; commit it after `quitMission`). Pure: everything random is the round's
 * own seed, so the same snapshot, seed and input give the same result.
 */
export function playMissionRound<KitInput>(opts: MissionRoundOptions<KitInput>): MissionRoundResult {
  const round = opts.start(opts.adapter.input(opts.snapshot, opts.mission));
  const max = opts.maxTicks ?? MISSION_ROUND_MAX_TICKS;
  const roundInput = new RoundInput(opts.inputMap);
  let ticks = 0;
  while (round.result() === null) {
    if (ticks >= max)
      return {
        ok: false,
        code: 'unfinished',
        error: `mission "${opts.mission.id}": the round had no result after ${max} ticks`,
        end: null,
        round,
      };
    round.step(roundInput.advance(opts.input(ticks, round)));
    ticks++;
  }
  const end: MiniGameEnd = {
    result: round.result() as MiniGameResult,
    report: round.report ? round.report() : null,
    ticks,
  };
  const mapped = missionRoundEnd(opts.mission, opts.adapter, end);
  if (!mapped.ok) return { ...mapped, end, round };
  return { ...mapped, end, round };
}

/** How a round's end maps to a mission result (`missionRoundEnd`). */
export type MissionRoundEndResult =
  | { ok: true; quit: boolean; result: MissionResult }
  | { ok: false; code: Exclude<MissionRoundRefusal, 'unfinished'>; error: string };

/**
 * The checks `playMissionRound` makes once a round has ended, on their own (Engine 0.11, item 173)
 * so a host that steps the round tick by tick (`MissionHost`, `mission-host.ts`) maps its end the
 * same way: a `quit` end resolves to `onQuit` without the adapter (`quit: true`); any other goes
 * through `adapter.outcome` and `playedResult`, refused as `unmappable_report` (the adapter threw)
 * or `unknown_outcome` (undeclared, or not `playable`). Pure.
 */
export function missionRoundEnd(
  mission: MissionDef,
  adapter: MissionAdapter<unknown, MiniGameEnd>,
  end: MiniGameEnd,
): MissionRoundEndResult {
  if (end.result === 'quit') {
    const quit = missionResult(mission, mission.onQuit);
    if (!quit.ok) return { ok: false, code: quit.code, error: quit.error };
    return { ok: true, quit: true, result: quit.result };
  }
  let checked: ReturnType<typeof playedResult>;
  try {
    checked = playedResult(adapter, mission, end);
  } catch (err) {
    return {
      ok: false,
      code: 'unmappable_report',
      error: `mission "${mission.id}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!checked.ok) return { ok: false, code: checked.code, error: checked.error };
  return { ok: true, quit: false, result: checked.result };
}
