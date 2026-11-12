import { contentOf, loadContent, type ContentBundle } from '@engine/core/content/bundle';
import { kitContentKinds, manifestOptions } from '@engine/core/content/game-content';
import type { ContentResult } from '@engine/core/content/validate';
import type { RtsTypes } from '@engine/core/rts-types';
import { mustSkinSet, type SkinFile } from '@engine/core/present';
import {
  rtsEndKind,
  rtsEnemyKind,
  rtsMapKind,
  rtsScenario,
  rtsTypesKind,
  type EnemyPlan,
  type RtsEnd,
  type RtsMap,
} from '@kits/rts';
import { kit as rts } from '@kits/rts/kit';

/**
 * Glue between the skirmish's data files (`game.json` and `content/`) and the engine: the loaded
 * bundle as the map, the unit and building types, the AI opponent's plan, the end rule and the
 * skin. No content lives here: the map, types, plan, end rule, art and skin are all text files
 * under `content/` (the pack's PNGs under `assets/`).
 */

/** The song the page plays (`content/songs/ford.json`, Engine 0.15 T14). */
export const SKIRMISH_MUSIC = 'ford';

/** The side the player commands. The AI's side is the plan's `faction` (`content/enemy/`). */
export const PLAYER = 'red';

/** The game's checked content, from `{ path: text }` pairs relative to `games/samples/rts-skirmish`. */
export function loadSkirmish(files: Readonly<Record<string, string>>): ContentResult<ContentBundle> {
  return loadContent(files, kitContentKinds([rts], manifestOptions(files)), {
    root: 'games/samples/rts-skirmish/',
  });
}

/** The one entry of `kind` the game has, or a thrown error naming the folder it belongs in. */
function only<T>(entries: readonly { value: T }[], what: string): T {
  if (entries.length !== 1)
    throw new Error(`the skirmish needs exactly one ${what}, it has ${entries.length}`);
  return entries[0]!.value;
}

/** The map (`content/maps/ford.world.json`), a world scenario without its types table. */
export function skirmishMap(content: ContentBundle): RtsMap {
  return only(contentOf(content, rtsMapKind()), 'map (content/maps/*.world.json)');
}

/** The unit and building types (`content/types/skirmish.json`). */
export function skirmishTypes(content: ContentBundle): RtsTypes {
  return only(contentOf(content, rtsTypesKind()), 'types file (content/types/*.json)');
}

/** The AI opponent's plan (`content/enemy/blue.json`, the kit's `rts-enemy`, knowledge `fog`). */
export function skirmishEnemy(content: ContentBundle): EnemyPlan {
  return only(contentOf(content, rtsEnemyKind()), 'enemy plan (content/enemy/*.json)');
}

/** The match's end rule (`content/end/ford.json`, the kit's `rts-end`): when red wins or loses. */
export function skirmishEnd(content: ContentBundle): RtsEnd {
  return only(contentOf(content, rtsEndKind()), 'end rule (content/end/*.json)');
}

/**
 * The scenario the world is built from: the map with `seed` as the world's seed and the types
 * table spawned first (entity 2, after the terrain), so the map keeps no copy of it.
 */
export function skirmishScenario(content: ContentBundle, seed: number): RtsMap {
  return rtsScenario(skirmishMap(content), skirmishTypes(content), seed);
}

/** The skin one backend draws the game with (`content/skins/<backend>.json`). */
export function skirmishSkin(content: ContentBundle, backend: string): SkinFile {
  return mustSkinSet(content, backend, 'the skirmish').main;
}
