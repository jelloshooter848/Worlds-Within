import type { CampaignSave } from '@engine/core/campaign';
import type { JsonObject, JsonValue, RunStart } from '@engine/core/headless';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { InputScript } from '@engine/core/input/scripted-input';
import type { CheckOp } from '../check-values';
import type { Change } from '@engine/sim/index';
import type { DumpFile } from '../dump-file';
import type { EventFilter } from '../event-filter';
import type { CheckResult, DebugMismatch, StateDiff } from './model';

/**
 * What the CLI's `debug` command hands the debugger page (Engine 0.14 T10; docs/BUILD-LOG.md,
 * Engine 0.14, decisions 1 and 2): everything the page needs, so it reads no files. The server
 * gives it at {@link DEBUG_JOB_PATH}; the page fetches it once. Plain JSON, so it also goes through
 * Playwright and into Node tests as it is.
 */

/** Where the debug server serves the job (read-only, the job in memory; never a file read). */
export const DEBUG_JOB_PATH = '/__ww-debugger/job.json';

/** The debugger page, relative to the repo root. */
export const DEBUG_PAGE = 'engine/tools/debugger/index.html';

/** The kinds of file the debugger opens, told apart by their shape. */
export const DEBUG_KINDS = ['run', 'replay', 'dump'] as const;
export type DebugKind = (typeof DEBUG_KINDS)[number];

/** A state hash the run is meant to give, and where it comes from. */
export interface ExpectedHash {
  tick: number;
  hash: string;
  /**
   * `golden`: the run file's `<name>.hashes.json`; `run`: its own sync `hashes`; `replay`: the
   * hashes a replay file's source run printed.
   */
  source: 'golden' | 'run' | 'replay';
}

/** One of the run file's checks, as the page makes it. */
export interface DebugCheck {
  kind: 'assertion' | 'invariant';
  /** Its index in the run file's `assertions` or `invariants`. */
  index: number;
  /** An assertion's tick; null for an invariant (checked at every tick). */
  tick: number | null;
  path: string;
  op: CheckOp;
  value: JsonValue;
}

/** A run or replay file (a game run), ready to step. */
export interface DebugRunJob {
  kind: 'run' | 'replay';
  /** The file opened, relative to the working folder. */
  file: string;
  /** The game folder, relative to the working folder. */
  game: string;
  /** The game's files as `{ path: text }` (as `readGameFiles` gives them). */
  files: Record<string, string>;
  /** The game folder as a repo path with a trailing `/` (`games/demo/`), for error messages. */
  root: string;
  /** The URL path the page imports the game's headless module from (served by Vite). */
  headlessUrl: string;
  /** The URL path of the game's view module, or null for a game without `view`. */
  viewUrl: string | null;
  seed: number;
  /** The run's last tick. */
  ticks: number;
  hashEvery: number;
  input: InputScript;
  /** Recorded orders, `{ tick, ...order }`, in tick order. */
  orders: ({ tick: number } & JsonObject)[];
  /** Mission steps, `{ tick, mission, action, input? }`, in tick order. */
  missions: ({ tick: number } & JsonObject)[];
  /** The game's own kit's rules switched off (`HeadlessOptions.disabledRules`). */
  disabledRules: string[];
  /** Every kit's rules switched off, by kit (`HeadlessOptions.disabledRulesByKit`). */
  disabledRulesByKit: Record<string, string[]>;
  /** The campaign save the run starts at (its `from`, as `run` reads it), or null. */
  campaign: CampaignSave | null;
  /** The run's `start` (a level or campaign entry), or null. */
  start: RunStart | null;
  /** The game's picture size (`screen` in `game.json`). */
  screen: ScreenSize;
  /** The run file's assertions and invariants. */
  checks: DebugCheck[];
  /** The hashes the run must give: the golden file's, the run file's sync hashes, a replay's. */
  expected: ExpectedHash[];
  /** A replay file's stored failure (`replay.failure`), or null. */
  failure: { tick: number; kind: string; path: string; message: string } | null;
  /** The tick the page opens at. */
  openTick: number;
}

/** A dump file: a still picture of one tick, with the run it came from when that can be played. */
export interface DebugDumpJob {
  kind: 'dump';
  file: string;
  dump: DumpFile;
  /** The dump's run as a run job (for Play from here), or null (a world run, or no such file). */
  run: DebugRunJob | null;
  /** Always the dump's tick. */
  openTick: number;
}

export type DebugJob = DebugRunJob | DebugDumpJob;

/**
 * What the page puts on `window.__wwDebugger` (for tests, `debug --check` and the console). On a
 * dump `step` and `goto` throw (a dump is read-only) until `playFromHere()` plays its run.
 */
export interface DebuggerApi {
  /** True once the file is loaded and the open tick is shown. */
  readonly ready: boolean;
  /** Why the page could not load the file, or null. */
  readonly error: string | null;
  /** What is shown: a run, a replay, or a dump (until Play from here, which makes it `run`). */
  readonly kind: DebugKind;
  readonly tick: number;
  readonly ticks: number;
  /** The state hash at the tick shown. */
  hash(): string;
  /** The snapshot at the tick shown. */
  state(): JsonObject;
  /** The world's kept event log now, filtered; null for a game with no world. */
  events(filter?: EventFilter): Change[] | null;
  /** The changes of the world ticks the last step covered; null for a game with no world. */
  stepEvents(): Change[] | null;
  /** The number of kept changes in the world's log now; null for a game with no world. */
  eventCount(): number | null;
  /** Steps n ticks (default 1); returns the tick reached. */
  step(n?: number): number;
  /** Goes to a tick, back or forward; returns the tick reached. */
  goto(tick: number): number;
  /** The checks at the tick shown (invariants, and this tick's assertions). */
  checks(): CheckResult[];
  /** The differences from the previous tick. */
  diff(): StateDiff[];
  /** The first mismatch found (stored hash, rewind, view), or null. */
  mismatch(): DebugMismatch | null;
  /** A dump only: play its run to the dump's tick and step from there. */
  playFromHere(): Promise<void>;
}

declare global {
  interface Window {
    __wwDebugger?: DebuggerApi;
  }
}
