import type {
  HeadlessGame,
  HostedGame,
  JsonObject,
  JsonValue,
  MissionStepRefusal,
  RoundRecording,
  WorldEvents,
} from './headless';
import type { InputFrame } from './input/input-manager';
import { InputRecorder } from './input/input-recorder';
import { ScriptedInput, type InputScript } from './input/scripted-input';
import { missionRoundEnd, type MiniGameEnd } from './mission-adapter';
import {
  hostStatusFor,
  miniGameTable,
  RoundInput,
  type MiniGame,
  type MiniGameDef,
  type MiniGameResult,
} from './minigame';
import type { MissionAdapter, MissionDef, MissionResult } from './missions';

/**
 * Live mission hosting (Engine 0.11, items 172-174; docs/BUILD-LOG.md, Engine 0.11, decisions 1-3):
 * a `MissionHost` wraps a game's `HeadlessGame` (the RTS kit's `RtsGame` in the mini siege) and
 * hosts its missions, so a game run file can open, delegate, play (through a real kit round) and
 * quit them, and the browser shell's `HostScene` pushes the round like any hosted round.
 *
 * It never imports `engine/sim`: the world is behind a {@link MissionWorldPort}, which the game's
 * glue fills with one call, `missionPort(world, { refs })` from `engine/sim`:
 *
 *   // games/<game>/headless.ts (glue)
 *   const world = worldFromScenario(map);
 *   const rts = rtsGame({ world: { ... }, enemy, seed });
 *   return new MissionHost({ game: rts, port: missionPort(world, { refs }), missions, miniGames, adapters });
 *
 * - **A step while no round is hosted:** the game's `step` (the enemy thinks, the world steps; with
 *   no `game`, the port's `step`), then the port's `settle()`, so a due mission commits at its
 *   fixed tick (open tick + `worldTimeCost`) exactly as in a world run.
 * - **`play`** builds the round's `params` with the adapter for the mission's `play` mini game
 *   (`adapter.input(snapshot, mission)`, from the plain snapshot the mission opened with) and starts
 *   it with the port's round seed. **While it is hosted the round steps and the world does not:** a
 *   step steps the round once (through a `RoundInput` with the def's `inputMap`, fed the step's
 *   recorded script when the `play` step carried one, else the host's frame), the game's `step` is
 *   not called (no enemy thinking, no world tick), and an order or mission step is refused
 *   (`round_hosted`). When the round ends its end is mapped through `missionRoundEnd` (the same
 *   checks as `playMissionRound`) and the port's `play` (or, for a quit round, `quit`) is called
 *   on that tick. From the next step the world steps again, one world tick per game tick, and the
 *   result commits by itself at the fixed commit tick, as the delegated path's does (decision 3).
 *   A round whose end does not map is refused there (`missions.round.refused` in the snapshot of
 *   that tick): nothing is resolved, and the mission is delegated at its commit tick (`timeout`).
 * - `snapshot()` is the game's (or `{ world }` from the port) plus `missions: { round }` only while
 *   a round is hosted and on the tick it ends, so a game that never hosts one keeps its hashes.
 *   `round` is `{ mission, game, ticks, state, result, outcome, refused }`.
 * - Experience ticks (the round's own) are counted per mission (`missionExperience()`), never
 *   written to the world, as in world runs, so a played run's world matches a world run's.
 */

/** A port call refused by the world: the sim's code and a one-line reason. */
export type PortRefusal = { ok: false } & MissionStepRefusal;

/** What a mission host needs from a world: the game's glue fills it (`missionPort` in `engine/sim`). */
export interface MissionWorldPort {
  /**
   * `openMission(world, def, { refs })`: opens it now, returning the plain world snapshot it
   * opened with, its commit tick and the round's seed (`Rng.derived(world seed, "round:<id>")`).
   */
  open(def: MissionDef): { ok: true; snapshot: JsonObject; commitTick: number; seed: number } | PortRefusal;
  /** `delegateMission`: one outcome drawn by weight. */
  delegate(id: string): { ok: true } | PortRefusal;
  /** `playMission` with the result's report (or outcome). */
  play(id: string, result: MissionResult): { ok: true } | PortRefusal;
  /** `quitMission`: its `onQuit` outcome. */
  quit(id: string): { ok: true } | PortRefusal;
  /** `settleMissions`: commits every due mission; returns the ids committed, in commit order. */
  settle(): readonly string[];
  /** `World.snapshot()`, as plain JSON. */
  snapshot(): JsonObject;
  /** `World.step()` (used when the host has no game of its own). */
  step(): void;
  /**
   * Optional (Engine 0.14 T7): the world's event log from `sinceTick` (`eventsSince` in
   * `engine/sim`). Reads only.
   */
  events?(sinceTick: number): WorldEvents;
  /**
   * Optional (Engine 0.14 T7): the world's timeline record (`worldTimeline` in `engine/sim`), the
   * host's own experience count per played mission given in `experience`. Reads only.
   */
  timeline?(experience: readonly { mission: string; ticks: number }[]): JsonObject;
}

/** What a `MissionHost` is built from. */
export interface MissionHostOptions {
  /** The game it hosts missions for; left out, the host steps the bare world through the port. */
  readonly game?: HeadlessGame;
  readonly port: MissionWorldPort;
  /** The game's mission definitions (its `mission` content). */
  readonly missions: readonly MissionDef[];
  /** The mini games a mission's `play` may name. */
  readonly miniGames: readonly MiniGameDef[];
  /** The adapter for each mini game id: builds the round's `params` and maps its end to an outcome. */
  readonly adapters: Readonly<Record<string, MissionAdapter<JsonObject, MiniGameEnd>>>;
  /**
   * The host's HUD values a round may show (`MiniGameDef.hostStatus`, gap G19), read when a round
   * starts; `mission` (the mission's title) is always there.
   */
  hostStatus?(): Readonly<Record<string, unknown>>;
}

/** The refusal of a step taken while a round is being played. */
export const ROUND_HOSTED = 'round_hosted';

/** The round being hosted (or the one that ended on the last step). */
interface HostedRound {
  readonly mission: MissionDef;
  readonly game: MiniGame;
  readonly adapter: MissionAdapter<JsonObject, MiniGameEnd>;
  readonly input: RoundInput;
  readonly script: ScriptedInput | null;
  /** The round's input being recorded (`recordRounds`), or null. */
  readonly recorder: InputRecorder | null;
  ticks: number;
  outcome: string | null;
  refused: MissionStepRefusal | null;
}

/** An opened mission as the host keeps it until its commit. */
interface Opened {
  readonly def: MissionDef;
  readonly snapshot: JsonObject;
  readonly seed: number;
  resolved: boolean;
}

const refusal = (code: string, error: string): MissionStepRefusal => ({ code, error });

export class MissionHost implements HostedGame<MissionHost> {
  readonly game: HeadlessGame | null;
  private readonly port: MissionWorldPort;
  private readonly defs: ReadonlyMap<string, MissionDef>;
  private readonly miniGames: ReadonlyMap<string, MiniGameDef>;
  private readonly opts: MissionHostOptions;
  private readonly opened = new Map<string, Opened>();
  private readonly committed = new Set<string>();
  private readonly experience = new Map<string, number>();
  private hosted: HostedRound | null = null;
  private ended: HostedRound | null = null;
  /** Steps taken (a run file's tick), for a recording's `tick`. */
  private steps = 0;
  private recording = false;
  private readonly recorded: { mission: string; tick: number; round: HostedRound }[] = [];
  /** The world's event log (`HeadlessGame.worldEvents`), when the port gives it. Reads only. */
  readonly worldEvents?: (sinceTick: number) => WorldEvents;
  /** The world's timeline record with the rounds' experience (`HeadlessGame.timeline`), when the port gives it. */
  readonly timeline?: () => JsonObject;

  constructor(opts: MissionHostOptions) {
    this.opts = opts;
    this.game = opts.game ?? null;
    this.port = opts.port;
    const defs = new Map<string, MissionDef>();
    for (const def of opts.missions) {
      if (defs.has(def.id)) throw new Error(`mission "${def.id}" is given twice`);
      defs.set(def.id, def);
    }
    this.defs = defs;
    this.miniGames = miniGameTable(opts.miniGames);
    const port = opts.port;
    if (port.events) this.worldEvents = (sinceTick) => port.events!(sinceTick);
    if (port.timeline) this.timeline = () => port.timeline!(this.missionExperience());
  }

  /** The scene draws the host itself (its game, and its round through `miniGame()`). */
  get world(): MissionHost {
    return this;
  }

  /** The hosted game's last step's events (`[]` when it keeps none). */
  get events(): readonly unknown[] {
    const events = (this.game as { events?: unknown } | null)?.events;
    return Array.isArray(events) ? (events as unknown[]) : [];
  }

  /** The round hosted now, or null (the shell's `HostScene` pushes its scene). */
  miniGame(): MiniGame | null {
    return this.hosted?.game ?? null;
  }

  /** The mission whose round is hosted now, or null. */
  get playing(): MissionDef | null {
    return this.hosted?.mission ?? null;
  }

  step(input: InputFrame): void {
    this.steps++;
    this.ended = null;
    const round = this.hosted;
    if (round !== null) {
      this.stepRound(round, input);
      return;
    }
    if (this.game !== null) this.game.step(input);
    else this.port.step();
    for (const id of this.port.settle()) {
      this.opened.delete(id);
      this.committed.add(id);
    }
  }

  snapshot(): JsonObject {
    const base: JsonObject = this.game !== null ? this.game.snapshot() : { world: this.port.snapshot() };
    const round = this.hosted ?? this.ended;
    if (round === null) return base;
    const result = round.game.result();
    const shown: JsonObject = {
      mission: round.mission.id,
      game: round.mission.play ?? null,
      ticks: round.ticks,
      state: round.game.snapshot(),
      result,
      outcome: round.outcome,
      refused: round.refused as JsonValue,
    };
    return { ...base, missions: { round: shown } };
  }

  /** An order for the game; refused while a round is hosted (the world is not stepping). */
  order(order: JsonObject): string | null {
    if (this.hosted !== null) return `${ROUND_HOSTED}: a mission round is being played`;
    if (this.game?.order === undefined) return 'the game takes no orders';
    return this.game.order(order);
  }

  /**
   * One mission step (`HeadlessGame.mission`): `{ mission, action, input? }`. Null when taken, else
   * the refusal: `round_hosted` while a round is played, `unknown_mission` for an id the game has
   * no definition of, the host's own `mission_not_open`, `mission_committed` and
   * `mission_resolved`, `no_mini_game` / `no_adapter` / `bad_mission_input` for a `play` that
   * cannot start its round, and the port's (the sim's) codes.
   */
  mission(step: JsonObject): MissionStepRefusal | null {
    const id = step['mission'];
    const action = step['action'];
    if (typeof id !== 'string') return refusal('bad_step', 'a mission step names its "mission"');
    switch (action) {
      case 'open':
        return this.launch(id);
      case 'delegate':
        return this.delegate(id);
      case 'quit':
        return this.quit(id);
      case 'play': {
        const script = step['input'];
        return this.play(id, script === undefined ? undefined : (script as unknown as InputScript));
      }
      default:
        return refusal('bad_step', `"${String(action)}" is not a mission action`);
    }
  }

  /** Opens mission `id` now (the live path's launch, and a run file's `open`). */
  launch(id: string): MissionStepRefusal | null {
    if (this.hosted !== null) return this.roundHosted();
    const def = this.defs.get(id);
    if (def === undefined) return this.unknown(id);
    const opened = this.port.open(def);
    if (!opened.ok) return refusal(opened.code, opened.error);
    this.opened.set(id, { def, snapshot: opened.snapshot, seed: opened.seed, resolved: false });
    return null;
  }

  /** Delegates open mission `id`: the world draws its outcome; it commits at its commit tick. */
  delegate(id: string): MissionStepRefusal | null {
    if (this.hosted !== null) return this.roundHosted();
    if (!this.defs.has(id)) return this.unknown(id);
    const done = this.port.delegate(id);
    if (!done.ok) return refusal(done.code, done.error);
    const open = this.opened.get(id);
    if (open) open.resolved = true;
    return null;
  }

  /** Quits open mission `id` without playing a round: its `onQuit` outcome. */
  quit(id: string): MissionStepRefusal | null {
    if (this.hosted !== null) return this.roundHosted();
    if (!this.defs.has(id)) return this.unknown(id);
    const done = this.port.quit(id);
    if (!done.ok) return refusal(done.code, done.error);
    const open = this.opened.get(id);
    if (open) open.resolved = true;
    return null;
  }

  /**
   * Starts open mission `id`'s round: the mini game its `play` names, with the params its adapter
   * builds from the snapshot the mission opened with and the round seed the port gave. `script`
   * (a recorded `ScriptedInput` script, frame 0 the round's first tick) drives it instead of the
   * host's frames.
   */
  play(id: string, script?: InputScript): MissionStepRefusal | null {
    if (this.hosted !== null) return this.roundHosted();
    const def = this.defs.get(id);
    if (def === undefined) return this.unknown(id);
    const open = this.opened.get(id);
    if (open === undefined)
      return this.committed.has(id)
        ? refusal('mission_committed', `mission "${id}" is already committed; there are no do-overs`)
        : refusal('mission_not_open', `mission "${id}" is not open`);
    if (open.resolved)
      return refusal('mission_resolved', `mission "${id}" was already resolved; there are no do-overs`);
    if (def.play === undefined)
      return refusal('not_playable', `mission "${id}" has no "play": it is a choice, only delegated`);
    const miniGame = this.miniGames.get(def.play);
    if (miniGame === undefined)
      return refusal(
        'no_mini_game',
        `mission "${id}" plays "${def.play}", which is not one of the game's mini games`,
      );
    const adapter = this.opts.adapters[def.play];
    if (adapter === undefined)
      return refusal('no_adapter', `mission "${id}" plays "${def.play}", which has no mission adapter`);
    let game: MiniGame;
    try {
      const params = adapter.input(open.snapshot, def);
      const hostStatus = hostStatusFor(miniGame, { ...this.opts.hostStatus?.(), mission: def.title });
      game = miniGame.create({ params, attempt: 1, ...(hostStatus ? { hostStatus } : {}) }, open.seed);
    } catch (err) {
      return refusal(
        'bad_mission_input',
        `mission "${id}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.hosted = {
      mission: def,
      game,
      adapter,
      input: new RoundInput(miniGame.inputMap),
      script: script === undefined ? null : new ScriptedInput(script),
      recorder: this.recording ? new InputRecorder() : null,
      ticks: 0,
      outcome: null,
      refused: null,
    };
    if (this.hosted.recorder !== null)
      this.recorded.push({ mission: id, tick: this.steps, round: this.hosted });
    if (!this.experience.has(id)) this.experience.set(id, 0);
    return null;
  }

  /**
   * Records the input of every round started from now on (`on` true), or stops for rounds started
   * later (Engine 0.14 T9, gap M19). A round records the host actions its `RoundInput` let through
   * each tick (`RoundInput.source()`, before the def's `inputMap`), from its frame 0: fed back as
   * its `play` step's `input`, the round plays the same. Never in the snapshot: no hash moves.
   */
  recordRounds(on: boolean): void {
    this.recording = on;
  }

  /** The rounds recorded so far, in play order (`{ mission, tick, ticks, done, input }`). */
  roundRecordings(): RoundRecording[] {
    return this.recorded.map(({ mission, tick, round }) => ({
      mission,
      tick,
      ticks: round.ticks,
      done: round !== this.hosted,
      input: round.recorder!.script(),
    }));
  }

  /** The ticks each mission's rounds took, in first-play order. */
  missionExperience(): { mission: string; ticks: number }[] {
    return [...this.experience].map(([mission, ticks]) => ({ mission, ticks }));
  }

  private stepRound(round: HostedRound, host: InputFrame): void {
    let frame: InputFrame = host;
    if (round.script !== null) {
      round.script.next();
      frame = round.script;
    }
    round.game.step(round.input.advance(frame));
    round.recorder?.record(round.input.source(), round.input.taps());
    round.ticks++;
    const id = round.mission.id;
    this.experience.set(id, (this.experience.get(id) ?? 0) + 1);
    const result = round.game.result();
    if (result !== null) this.finish(round, result);
  }

  /** Maps the round's end and resolves the mission through the port, on the tick it ends. */
  private finish(round: HostedRound, result: MiniGameResult): void {
    this.hosted = null;
    this.ended = round;
    const id = round.mission.id;
    const end: MiniGameEnd = {
      result,
      report: round.game.report ? round.game.report() : null,
      ticks: round.ticks,
    };
    const mapped = missionRoundEnd(round.mission, round.adapter, end);
    if (!mapped.ok) {
      round.refused = refusal(mapped.code, mapped.error);
      return;
    }
    const done = mapped.quit ? this.port.quit(id) : this.port.play(id, mapped.result);
    if (!done.ok) {
      round.refused = refusal(done.code, done.error);
      return;
    }
    round.outcome = mapped.result.outcome;
    const open = this.opened.get(id);
    if (open) open.resolved = true;
  }

  private roundHosted(): MissionStepRefusal {
    return refusal(ROUND_HOSTED, `mission "${this.hosted?.mission.id}": a mission round is being played`);
  }

  private unknown(id: string): MissionStepRefusal {
    const known = [...this.defs.keys()].join(', ') || 'none';
    return refusal('unknown_mission', `the game has no mission "${id}" (known: ${known})`);
  }
}
