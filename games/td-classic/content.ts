import { loadContent, type ContentBundle } from '@engine/core/content/bundle';
import { kitContentKinds, manifestOptions } from '@engine/core/content/game-content';
import type { ContentResult } from '@engine/core/content/validate';
import { tdRound, type TdRoundDef } from '@kits/towerdefense';
import { kit as towerdefense } from '@kits/towerdefense/kit';

/**
 * Glue between the sample's data files (`game.json` and `content/`) and the tower-defense kit: the
 * loaded bundle and the one round it holds. No content lives here: the map, the tower types and
 * the waves are text files under `content/`, and every rule of the round is the kit's.
 */

/** The game's checked content, from `{ path: text }` pairs relative to `games/td-classic`. */
export function loadTowerDefense(files: Readonly<Record<string, string>>): ContentResult<ContentBundle> {
  return loadContent(files, kitContentKinds([towerdefense], manifestOptions(files)), {
    root: 'games/td-classic/',
  });
}

/**
 * The round: the one map (`content/maps/road.json` and its `.map.txt` grid), every tower type
 * (`content/towers/`) and the wave list the map names (`content/waves/road.json`).
 */
export function sampleRound(content: ContentBundle): TdRoundDef {
  return tdRound(content);
}
