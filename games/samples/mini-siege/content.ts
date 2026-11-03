import { contentOf, loadContent, type ContentBundle } from '@engine/core/content/bundle';
import { MISSION_KIND } from '@engine/core/content/engine-kinds';
import { kitContentKinds } from '@engine/core/content/game-content';
import type { ContentResult } from '@engine/core/content/validate';
import type { MissionDef } from '@engine/core/missions';
import type { RtsTypes } from '@engine/core/rts-types';
import { rtsEnemyKind, rtsMapKind, rtsTypesKind, type EnemyPlan, type RtsMap } from '@kits/rts';
import { kit as rts } from '@kits/rts/kit';
import { roomKind, type RoomDef } from '@kits/topdown';
import { kit as topdown } from '@kits/topdown/kit';

/**
 * Glue between the mini siege's data files (`game.json` and `content/`) and the engine: the loaded
 * bundle as the map, the unit and building types, the raiders' plan, the missions and the mission
 * rooms. No content lives here: all of it is text files under `content/`.
 */

/** The side the player commands. The raiders are the plan's `faction` (`content/enemy/`). */
export const PLAYER = 'village';

const ROOM = roomKind();

/** The game's checked content, from `{ path: text }` pairs relative to `games/samples/mini-siege`. */
export function loadMiniSiege(files: Readonly<Record<string, string>>): ContentResult<ContentBundle> {
  // The kits of `game.json`: `kit` (rts), then `uses` (topdown, for the mission's room).
  return loadContent(files, kitContentKinds([rts, topdown]), { root: 'games/samples/mini-siege/' });
}

/** The one entry of `kind` the game has, or a thrown error naming the folder it belongs in. */
function only<T>(entries: readonly { value: T }[], what: string): T {
  if (entries.length !== 1)
    throw new Error(`the mini siege needs exactly one ${what}, it has ${entries.length}`);
  return entries[0]!.value;
}

/** The map (`content/maps/village.world.json`), a world scenario without its types table. */
export function siegeMap(content: ContentBundle): RtsMap {
  return only(contentOf(content, rtsMapKind()), 'map (content/maps/*.world.json)');
}

/** The unit and building types (`content/types/siege.json`). */
export function siegeTypes(content: ContentBundle): RtsTypes {
  return only(contentOf(content, rtsTypesKind()), 'types file (content/types/*.json)');
}

/** The raiders' plan (`content/enemy/raiders.json`). */
export function siegeEnemy(content: ContentBundle): EnemyPlan {
  return only(contentOf(content, rtsEnemyKind()), 'enemy plan (content/enemy/*.json)');
}

/** The missions (`content/missions/*.mission.json`), in file order. */
export function siegeMissions(content: ContentBundle): MissionDef[] {
  return contentOf(content, MISSION_KIND).map((e) => e.value);
}

/** The mission rooms (`content/rooms/`), each one a `mission-room` mission's room. */
export function siegeRooms(content: ContentBundle): RoomDef[] {
  return contentOf(content, ROOM).map((e) => e.value);
}

/**
 * The scenario the world is built from: the map with `seed` as the world's seed and the types
 * table spawned first (entity 2, after the terrain), so the map keeps no copy of it.
 */
export function siegeScenario(content: ContentBundle, seed: number): RtsMap {
  const map = siegeMap(content);
  const types = { key: 'types', components: { RtsTypes: siegeTypes(content) } };
  return { ...map, seed, entities: [types, ...map.entities] } as RtsMap;
}
