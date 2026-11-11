import { z } from 'zod';
import type { ContentKind } from '@engine/core/content/kinds';
import { defineKit, kitOptionsOf, type KitManifest } from '@engine/core/kit';
import { TopDownBot, type BotStep } from './bot';
import type { RoomChallenge } from './challenge';
import { DEFAULT_ITEMS, dashItem, type DashTuning, type TdItem } from './items';
import { MISSION_ROOM, missionRoomParamsSchema } from './mission-room';
import { TOPDOWN_RULES } from './rules';
import { roomKind, topdownOptionsSchema, type RoomMode } from './schema';

/**
 * The top-down kit's hook for the tools (`engine/core/kit.ts`): its content kinds (rooms, checked as
 * one dungeon or, with the game's `kitOptions.topdown.rooms` `"separate"`, each alone: gap G17), its
 * named rules and, for the schema reference, the params of its `mission-room` mini game. The tools find it by the kit name a `game.json` gives (`engine/tools/kits.ts`).
 * Its round bot (Engine 0.14 T9, gap M19) is `TopDownBot` over the room's world, for `pnpm cli
 * record --bot`: the plan is the bot's plans per room id, with the steps that are plain data.
 */

/** A `TopDownBot` plan as JSON: per room id, the steps that need no function (`fight`, `goto`, ...). */
export const topdownBotPlanSchema = z.record(
  z.string(),
  z.array(
    z.discriminatedUnion('do', [
      z.strictObject({ do: z.literal('fight') }),
      z.strictObject({ do: z.literal('goto'), x: z.number(), y: z.number() }),
      z.strictObject({ do: z.literal('pickup') }),
      z.strictObject({ do: z.literal('chest') }),
      z.strictObject({ do: z.literal('leave'), side: z.enum(['n', 'e', 's', 'w']) }),
    ]),
  ),
);
/**
 * How a game checks its room files (Engine 0.15, gap G17): its `game.json`'s
 * `kitOptions.topdown.rooms`, `dungeon` (one dungeon, the default) or `separate` (each room alone).
 */
export function roomMode(manifest?: KitManifest): RoomMode {
  const { rooms } = kitOptionsOf({ name: 'topdown', options: topdownOptionsSchema }, manifest) as {
    rooms?: RoomMode;
  };
  return rooms ?? 'dungeon';
}

/**
 * The kit's items for a game (Engine 0.16 part C T5): `DEFAULT_ITEMS` with the dash tuned by the
 * game's `kitOptions.topdown.dash` (`dashTuningSchema`; fields left out keep `DASH_TUNING`). A
 * game passes it as the world's `items`.
 */
export function topdownItems(manifest?: KitManifest): Readonly<Record<string, TdItem>> {
  const { dash } = kitOptionsOf({ name: 'topdown', options: topdownOptionsSchema }, manifest) as {
    dash?: Partial<DashTuning>;
  };
  return dash ? { ...DEFAULT_ITEMS, dash: dashItem(dash) } : DEFAULT_ITEMS;
}

export const kit = defineKit({
  name: 'topdown',
  kinds: (manifest?: KitManifest) => [
    roomKind({}, 1, { oneDungeon: roomMode(manifest) === 'dungeon' }) as unknown as ContentKind,
  ],
  options: topdownOptionsSchema,
  rules: TOPDOWN_RULES,
  paramsDocs: () => [
    {
      game: MISSION_ROOM,
      description:
        "A mission over a world played as one top-down room (Engine 0.11): a `*.mission.json`'s `params` when its `play` is `mission-room`. Which world entities become which foes in the room's slot cells, the round's goal and limits, and ordered rules from the round's report to the mission's declared outcomes",
      schema: missionRoomParamsSchema,
    },
  ],
  roundBots: () => [
    {
      game: MISSION_ROOM,
      description:
        'TopDownBot over the room\'s world: per room id a list of steps (fight, goto, pickup, chest, leave), such as {"engine-camp": [{"do": "fight"}]}',
      plan: topdownBotPlanSchema,
      create(plan) {
        const bot = new TopDownBot(plan as Record<string, BotStep[]>);
        return { next: (round) => bot.next((round as RoomChallenge).world) };
      },
    },
  ],
});
