import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { ContentError } from '@engine/core/content/validate';
import type { HeadlessEntry } from '@engine/core/headless';
import type { JsonObject } from '@engine/core/headless';
import {
  miniGameParamErrors,
  missionMiniGameUses,
  type GameWorldScenario,
  type MiniGameUse,
} from '@engine/core/minigame-params';
import { SCENARIO_FORMAT, worldFromScenario, worldKeys } from '@engine/sim/index';
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

/**
 * The game's world scenarios (any content file in the `worlds-within/scenario` format, whatever
 * its kind: the RTS kit's `rts-map`), each built at tick 0 with `engine/sim` (Engine 0.15 T7,
 * lesson D7): its plain snapshot, key table and the missions its opportunities offer. A scenario
 * that does not build is left out (its own kind's checks report it). Builds worlds only: nothing
 * steps.
 */
export function worldScenarios(content: ContentBundle): GameWorldScenario[] {
  const out: GameWorldScenario[] = [];
  for (const entry of content.entries) {
    const value = entry.value as JsonObject | null;
    if (value === null || typeof value !== 'object' || value['format'] !== SCENARIO_FORMAT) continue;
    let world;
    try {
      world = worldFromScenario(value);
    } catch {
      continue;
    }
    const opportunities = Array.isArray(value['opportunities']) ? value['opportunities'] : [];
    const offers = opportunities.flatMap((o) => {
      const mission = (o as JsonObject | null)?.['mission'];
      return typeof mission === 'string' ? [mission] : [];
    });
    out.push({
      file: entry.file,
      snapshot: world.snapshot() as unknown as JsonObject,
      keys: { ...worldKeys(world) },
      offers,
    });
  }
  return out;
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
  return miniGameParamErrors(miniGameUses(content), mod.miniGames(content), root, worldScenarios(content));
}
