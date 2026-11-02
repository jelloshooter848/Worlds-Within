import type { ScreenSize } from '@engine/core/gfx/screen';
import type { InputScript } from '@engine/core/input/scripted-input';

/** What the CLI sends the screenshot page: everything it needs, so the page reads no files. */
export interface ShotJob {
  /** The game's files as `{ path: text }` (as `readGameFiles` gives them). */
  files: Record<string, string>;
  /** The game folder as a repo path with a trailing `/`, for error messages (`games/demo/`). */
  root: string;
  /** The URL the page imports the game's view module from (served by Vite). */
  viewUrl: string;
  seed: number;
  /** How many steps to play before drawing. */
  ticks: number;
  input: InputScript;
  disabledRules: string[];
  /** The game's picture size from its manifest (`screen`): the page's viewport and canvas. */
  screen: ScreenSize;
}

/** What the page gives back. */
export interface ShotResult {
  /** The canvas as `data:image/png;base64,...`. */
  png: string;
  width: number;
  height: number;
  /** The snapshot at the drawn tick, as canonical JSON (the CLI hashes it). */
  snapshot: string;
}
