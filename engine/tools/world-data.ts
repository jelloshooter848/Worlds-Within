import { MANIFEST_FILE } from '@engine/core/content/manifest';
import { contentError, type ContentError } from '@engine/core/content/validate';
import type { WorldEvents } from '@engine/core/headless';
import type { Timeline } from '@engine/sim/index';
import { playRun, type PlayedRun } from './headless-run';

/**
 * A run's world data for `events`, `timeline` and `dump --out` (Engine 0.14 T7; docs/BUILD-LOG.md,
 * Engine 0.14, decisions 2-4): plays the run file to `untilTick` (no checks, like `dump`) with
 * `withWorld`, so a world run keeps its event log and a game is asked through its optional
 * `worldEvents` and `timeline` hooks (`engine/core/headless.ts`).
 */

/** A played run whose world data the game (or world) gave. */
export interface WorldData {
  played: PlayedRun;
  /** The whole kept event log at the last tick. */
  events: WorldEvents;
  /** The timeline record at the last tick (a game run's with its `clock`). */
  timeline: Timeline;
}

export type WorldDataOutcome =
  | { ok: true; value: WorldData }
  | { ok: false; errors: ContentError[] }
  /** A game run whose game has no world hooks (a platformer): `no_world`. */
  | { ok: false; noWorld: true; played: PlayedRun; errors: ContentError[] };

/**
 * The `no_world` content error for a game without `worldEvents` and `timeline`: at `headless` in
 * the game's `game.json`, naming the hooks.
 */
export function noWorldError(played: PlayedRun): ContentError {
  const dir = played.loaded.gameDir ?? '.';
  const file = dir === '.' ? MANIFEST_FILE : `${dir}/${MANIFEST_FILE}`;
  return contentError(
    file,
    ['headless'],
    'no_world',
    'the game has no world event log: its headless game has no worldEvents(sinceTick) and timeline() methods (engine/core/headless.ts)',
  );
}

/** Plays `runFile` to `untilTick` and reads its world data, or says why there is none. */
export async function playWorldData(
  cwd: string,
  runFile: string,
  untilTick: number,
): Promise<WorldDataOutcome> {
  const played = await playRun(cwd, runFile, { untilTick, withWorld: true });
  if (!played.ok) return played;
  const { worldEvents, timeline } = played.value;
  if (worldEvents === null || worldEvents === undefined || timeline === null || timeline === undefined)
    return { ok: false, noWorld: true, played: played.value, errors: [noWorldError(played.value)] };
  return { ok: true, value: { played: played.value, events: worldEvents, timeline } };
}
