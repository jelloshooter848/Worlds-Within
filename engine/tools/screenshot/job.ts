import type { CampaignSave } from '@engine/core/campaign';
import type { RunStart } from '@engine/core/headless';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { InputScript } from '@engine/core/input/scripted-input';

/** The backends `pnpm cli screenshot` can draw with (`--backend`). */
export const SHOT_BACKENDS = ['canvas2d', 'three'] as const;
export type ShotBackend = (typeof SHOT_BACKENDS)[number];

/**
 * A recorded order as the page gets it: `tick` plus the order's JSON fields (typed loosely so the
 * job stays something Playwright can pass to the page).
 */
export type OrderEntryJson = { tick: number } & Record<string, unknown>;

/** What the CLI sends the screenshot page: everything it needs, so the page reads no files. */
export interface ShotJob {
  /** The game's files as `{ path: text }` (as `readGameFiles` gives them). */
  files: Record<string, string>;
  /** The game folder as a repo path with a trailing `/`, for error messages (`games/demo/`). */
  root: string;
  /** The URL the page imports the game's view module from (served by Vite). */
  viewUrl: string;
  seed: number;
  /** How many steps to play; the page draws every tick on the way and returns the last picture. */
  ticks: number;
  /** Report the state hash every this many ticks (the run file's `hashEvery`), and at the last tick. */
  hashEvery: number;
  input: InputScript;
  /**
   * The run file's recorded orders (`{ tick, ...order }`, in tick order), each handed to the
   * view's `order` after its tick's state and before the step from it, as `run` does.
   */
  orders: OrderEntryJson[];
  /**
   * The run file's mission steps (`{ tick, mission, action, input? }`, in tick order; Engine 0.11
   * T9), each handed to the view's `mission` (`HeadlessGame.mission`) after its tick's orders, as
   * `run` does. Empty for a run without missions.
   */
  missions: OrderEntryJson[];
  /** The game's own kit's rules switched off (`HeadlessOptions.disabledRules`). */
  disabledRules: string[];
  /** Every kit's rules switched off, by kit (`HeadlessOptions.disabledRulesByKit`, Engine 0.14, gap G12). */
  disabledRulesByKit: Record<string, string[]>;
  /**
   * The campaign save the run starts at (its `from`, as `run` reads it; Engine 0.13 T8, gap M33),
   * handed to the view's `createView` as `HeadlessOptions.campaign`; null for a run without `from`.
   */
  campaign: CampaignSave | null;
  /**
   * The level or campaign entry the run starts at (its `start`, Engine 0.14, gap G9), handed to
   * the view's `createView` as `HeadlessOptions.start`; null for a run without `start`.
   */
  start: RunStart | null;
  /** The game's picture size from its manifest (`screen`): the page's viewport and canvas. */
  screen: ScreenSize;
  /**
   * What draws the picture: `canvas2d` (the view's `render` every tick) or `three` (the view's
   * `frame()` every tick through a `ThreePresenter` and the game's `three` skin, drawn once).
   */
  backend: ShotBackend;
  /** `three` only: go on when WebGL runs on a software renderer (SwiftShader, llvmpipe...). */
  allowSoftwareGl: boolean;
}

/** What the page gives back. */
export interface ShotResult {
  /** The canvas as `data:image/png;base64,...`. */
  png: string;
  width: number;
  height: number;
  /** The snapshot at the drawn tick, as canonical JSON (the CLI hashes it). */
  snapshot: string;
  /**
   * The state hashes the page saw while drawing every tick (as `run` reports them: tick 0, every
   * `hashEvery` ticks and the last tick), so the CLI can check drawing changed nothing.
   */
  hashes: { tick: number; hash: string }[];
  /** `three`: the WebGL renderer string the picture was drawn with; `canvas2d`: null. */
  renderer: string | null;
}

/**
 * What the page gives back instead of a picture when it cannot take one: the view has no
 * `frame()` (`no_frame_hook`), the canvas gives no WebGL context (`no_webgl`), or WebGL runs on a
 * software renderer and the job does not allow it (`software_gl`).
 */
export interface ShotRefusal {
  refused: 'no_frame_hook' | 'no_webgl' | 'software_gl';
  /** The WebGL renderer string, when there was a context to read it from. */
  renderer: string | null;
  message: string;
}
