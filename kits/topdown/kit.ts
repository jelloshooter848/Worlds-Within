import type { ContentKind } from '@engine/core/content/kinds';
import { defineKit } from '@engine/core/kit';
import { MISSION_ROOM, missionRoomParamsSchema } from './mission-room';
import { TOPDOWN_RULES } from './rules';
import { roomKind } from './schema';

/**
 * The top-down kit's hook for the tools (`engine/core/kit.ts`): its content kinds (rooms), its
 * named rules and, for the schema reference, the params of its `mission-room` mini game. The tools find it by the kit name a `game.json` gives (`engine/tools/kits.ts`).
 */
export const kit = defineKit({
  name: 'topdown',
  kinds: () => [roomKind() as unknown as ContentKind],
  rules: TOPDOWN_RULES,
  paramsDocs: () => [
    {
      game: MISSION_ROOM,
      description:
        "A mission over a world played as one top-down room (Engine 0.11): a `*.mission.json`'s `params` when its `play` is `mission-room`. Which world entities become which foes in the room's slot cells, the round's goal and limits, and ordered rules from the round's report to the mission's declared outcomes",
      schema: missionRoomParamsSchema,
    },
  ],
});
