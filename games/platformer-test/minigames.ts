import type { ContentBundle } from '@engine/core/content/bundle';
import type { MiniGameDef } from '@engine/core/minigame';
import { roomChallenge } from '@kits/topdown';
import { testRooms } from './content';

/**
 * The game's mini games: one top-down room challenge (`kits/topdown/challenge.ts`) per room file
 * in `content/rooms/`, its id the room's id. What a round asks (goal, time limit, hit points) and
 * what its result does are the door level's trigger data (`content/levels/level-4.json`), not
 * code. The title is the id in capitals: a room file has no field for it (gap G15).
 */
export function testMiniGames(content: ContentBundle): MiniGameDef[] {
  const size = content.manifest.screen;
  return testRooms(content).map((room) =>
    roomChallenge({
      id: room.id,
      title: room.id.toUpperCase().replace(/-/g, ' '),
      room,
      ...(size ? { size } : {}),
    }),
  );
}
