import type { ContentBundle } from '@engine/core/content/bundle';
import type { MiniGameDef } from '@engine/core/minigame';
import { roomChallenge } from '@kits/topdown';
import { classicRooms } from './content';

/**
 * The game's mini games: one top-down room challenge (`kits/topdown/challenge.ts`) per room file
 * in `content/rooms/`, its id the room's id and its title the room's `title` (gap G15, fixed in
 * 0.7 T9). What a round asks (goal, time limit, hit points) and what its result does are the door
 * level's trigger data (`content/levels/level-4.json`), not code. `disabledRules` are the top-down
 * kit's rules switched off in every round (a run file's `topdown:<id>`, Engine 0.14 gap G12).
 */
export function classicMiniGames(
  content: ContentBundle,
  disabledRules: readonly string[] = [],
): MiniGameDef[] {
  const size = content.manifest.screen;
  return classicRooms(content).map((room) =>
    roomChallenge({ id: room.id, room, ...(size ? { size } : {}), disabledRules }),
  );
}
