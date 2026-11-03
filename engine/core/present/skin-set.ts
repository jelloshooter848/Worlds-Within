import { contentOf, type ContentBundle } from '../content/bundle';
import { SKIN_KIND, type SkinFile } from './skin';
import { presenterByStatus } from './switch';
import type { Presenter } from './types';

/**
 * Which skins one backend draws a game with (Engine 0.7 T8, gap G32 in
 * docs/reports/stacking-test.md; the stacking test's `testSkins` until then). A game that stacks
 * kits shows two kinds of frame in one stream, so each frame source gets its own skin, told apart
 * by file name: `content/skins/<backend>.json` is the game's own (its kit's tiles, kinds, camera
 * and HUD), and `content/skins/<backend>-<id>.json` the one for the frames of the mini game `<id>`
 * (another kit's). A host kit marks a mini game's frames with `status[MINI_GAME_STATUS]` (the
 * platformer kit's `status.miniGame`). Pages, views and tools (`pnpm cli screenshot --backend
 * three`) read the same set, so every way of showing a game picks the same skin per frame. Pure.
 */

/** The status value a host kit sets to the running mini game's id on its frames ('' for none). */
export const MINI_GAME_STATUS = 'miniGame';

/** One backend's skins for a game: its own, and one per mini game by the mini game's id. */
export interface SkinSet {
  /** `<backend>.json`, else the first skin of that backend that is not a mini game's; null: none. */
  main: SkinFile | null;
  /** `<backend>-<id>.json`, by `<id>`. */
  rounds: Record<string, SkinFile>;
}

/** The skins of `content` with `"backend": backend`, by file name (see {@link SkinSet}). */
export function skinSet(content: ContentBundle, backend: string): SkinSet {
  const skins = contentOf(content, SKIN_KIND).filter((e) => e.value.backend === backend);
  const prefix = `${backend}-`;
  const rounds: Record<string, SkinFile> = {};
  for (const e of skins) if (e.name.startsWith(prefix)) rounds[e.name.slice(prefix.length)] = e.value;
  const main = skins.find((e) => e.name === backend) ?? skins.find((e) => !e.name.startsWith(prefix)) ?? null;
  return { main: main?.value ?? null, rounds };
}

/** A {@link SkinSet} whose game skin is there. */
export interface FoundSkinSet extends SkinSet {
  main: SkinFile;
}

/**
 * {@link skinSet}, or a thrown error naming the game (`who`) and the file it lacks when the backend
 * has no skin of the game's own (Engine 0.15 T15, the API review: every sample wrote this check).
 */
export function mustSkinSet(content: ContentBundle, backend: string, who = 'the game'): FoundSkinSet {
  const set = skinSet(content, backend);
  if (!set.main) throw new Error(`${who} has no ${backend} skin (content/skins/${backend}.json)`);
  return { main: set.main, rounds: set.rounds };
}

/**
 * One presenter over a set of presenters: each frame goes to `rounds[status.miniGame]` while a
 * mini game with a presenter of its own runs, else to `main` (`presenterByStatus` on
 * {@link MINI_GAME_STATUS}).
 */
export function presenterBySkinSet(main: Presenter, rounds: Readonly<Record<string, Presenter>>): Presenter {
  return presenterByStatus(MINI_GAME_STATUS, rounds, main);
}
