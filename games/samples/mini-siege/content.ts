import type { CampaignDef } from '@engine/core/campaign';
import { contentOf, loadContent, type ContentBundle } from '@engine/core/content/bundle';
import { CAMPAIGN_KIND, MISSION_KIND } from '@engine/core/content/engine-kinds';
import { kitContentKinds, manifestOptions } from '@engine/core/content/game-content';
import type { ContentResult } from '@engine/core/content/validate';
import type { MissionDef } from '@engine/core/missions';
import type { RtsTypes } from '@engine/core/rts-types';
import { rtsEnemyKind, rtsMapKind, rtsTypesKind, type EnemyPlan, type RtsMap } from '@kits/rts';
import { kit as rts } from '@kits/rts/kit';
import { roomKind, type RoomDef } from '@kits/topdown';
import { kit as topdown } from '@kits/topdown/kit';
import { tdMapKind, tdTowersKind, towerTable, type TdMap, type TowerTable } from '@kits/towerdefense';
import { kit as towerdefense } from '@kits/towerdefense/kit';

/**
 * Glue between the mini siege's data files (`game.json` and `content/`) and the engine: the loaded
 * bundle as the map, the unit and building types, the raiders' plan, the missions, the mission
 * rooms and the walls' tower-defense maps and towers. No content lives here: all of it is text files under `content/`.
 */

/** The side the player commands. The raiders are the plan's `faction` (`content/enemy/`). */
export const PLAYER = 'village';

const ROOM = roomKind();

/** The game's checked content, from `{ path: text }` pairs relative to `games/samples/mini-siege`. */
export function loadMiniSiege(files: Readonly<Record<string, string>>): ContentResult<ContentBundle> {
  // The kits of `game.json`: `kit` (rts), then `uses` (topdown for the sabotage room,
  // towerdefense for the fortify map).
  return loadContent(files, kitContentKinds([rts, topdown, towerdefense], manifestOptions(files)), {
    root: 'games/samples/mini-siege/',
  });
}

/** The one entry of `kind` the game has, or a thrown error naming the folder it belongs in. */
function only<T>(entries: readonly { value: T }[], what: string): T {
  if (entries.length !== 1)
    throw new Error(`the mini siege needs exactly one ${what}, it has ${entries.length}`);
  return entries[0]!.value;
}

/** The scenario the game starts with when no campaign save says otherwise (the siege itself). */
export const FIRST_SCENARIO = 'village';

/**
 * A map (`content/maps/<name>.world.json`), a world scenario without its types table: `village`,
 * the siege, or (Engine 0.13 T7) `dawn`, the follow-up that starts from the siege's results. Which
 * one is played comes from the campaign (`siegeCampaign`), never from code.
 */
export function siegeMap(content: ContentBundle, name: string = FIRST_SCENARIO): RtsMap {
  const map = contentOf(content, rtsMapKind()).find((e) => e.name === name);
  if (map === undefined)
    throw new Error(`the mini siege has no map "${name}" (content/maps/${name}.world.json)`);
  return map.value;
}

/** The campaign (`content/campaigns/siege.campaign.json`): the siege, then the dawn assault. */
export function siegeCampaign(content: ContentBundle): CampaignDef {
  return only(contentOf(content, CAMPAIGN_KIND), 'campaign (content/campaigns/*.campaign.json)');
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

/** The tower-defense maps (`content/defence/maps/`), each one a `td-defence` mission's map. */
export function siegeDefenceMaps(content: ContentBundle): TdMap[] {
  return contentOf(content, tdMapKind()).map((e) => e.value);
}

/** The tower types the walls can be manned with (`content/defence/towers.json`). */
export function siegeTowers(content: ContentBundle): TowerTable {
  return towerTable(contentOf(content, tdTowersKind()));
}

/**
 * The scenario the world is built from: the map `name` (the siege when left out) with `seed` as
 * the world's seed and the types table spawned first (entity 2, after the terrain), so the map
 * keeps no copy of it.
 */
export function siegeScenario(content: ContentBundle, seed: number, name: string = FIRST_SCENARIO): RtsMap {
  const map = siegeMap(content, name);
  const types = { key: 'types', components: { RtsTypes: siegeTypes(content) } };
  return { ...map, seed, entities: [types, ...map.entities] } as RtsMap;
}
