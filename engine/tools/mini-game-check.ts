import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { ContentError } from '@engine/core/content/validate';
import type { HeadlessEntry } from '@engine/core/headless';
import { miniGameParamErrors, missionMiniGameUses, type MiniGameUse } from '@engine/core/minigame-params';
import { findKit } from './kits';

/**
 * `validate`'s mini game check (Engine 0.10, gap G16, item 157): a game's mini games come from its
 * headless module (`HeadlessEntry.miniGames(content)`, imported by its path at run time like
 * `createGame`, never a static import), and every place its content names one (each kit's
 * `miniGameUses`, plus the engine's missions) is checked against them with
 * `miniGameParamErrors` (`engine/core/minigame-params.ts`).
 *
 * A game whose headless module is missing or exports no `miniGames` is checked as before (no
 * errors here): `run` reports a missing headless module. Building the defs starts no round.
 */

/** Every use of a mini game in `content`: each kit's (`kit`, then `uses`), then the missions'. */
export function miniGameUses(content: ContentBundle): MiniGameUse[] {
  const names = [content.manifest.kit, ...(content.manifest.uses ?? [])];
  const uses: MiniGameUse[] = [];
  for (const name of names) uses.push(...(findKit(name)?.miniGameUses?.(content) ?? []));
  uses.push(...missionMiniGameUses(content));
  return uses;
}

/** The mini game errors of the checked game in `gameDir` (relative to `cwd`), naming repo paths. */
export async function miniGameErrors(
  cwd: string,
  gameDir: string,
  content: ContentBundle,
): Promise<ContentError[]> {
  const abs = resolve(cwd, gameDir, content.manifest.headless);
  if (!existsSync(abs)) return [];
  const mod = (await import(pathToFileURL(abs).href)) as Partial<HeadlessEntry>;
  if (typeof mod.miniGames !== 'function') return [];
  const root = gameDir === '.' ? '' : `${gameDir}/`;
  return miniGameParamErrors(miniGameUses(content), mod.miniGames(content), root);
}
