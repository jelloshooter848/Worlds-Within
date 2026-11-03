import { z } from 'zod';
import type { ContentKind } from '@engine/core/content/kinds';
import { defineKit } from '@engine/core/kit';
import { TdBot, type TdBotStep } from './bot';
import { TD_DEFENCE, tdDefenceParamsSchema, type TdDefenceRound } from './mission-defence';
import { TOWERDEFENSE_RULES } from './rules';
import { tdMapKind, tdTowersKind, tdWavesKind } from './schema';

/**
 * The tower-defense kit's hook for the tools (`engine/core/kit.ts`): its content kinds (`td-map`,
 * `td-towers`, `td-waves`) and its named rules. It opts in to strict mutant checks
 * (docs/BUILD-LOG.md, Engine 0.12, decision 1): since Engine 0.12 T4 the sample's run files
 * (`games/samples/tower-defense/runs/`) guard every rule, so a rule no run file guards fails `pnpm
 * cli mutants`. Its `paramsDocs` lists the `td-defence` mini game's params (Engine 0.12 T6) for the
 * schema reference. The tools find it by the kit name a `game.json` gives (`engine/tools/kits.ts`).
 * Its round bot (Engine 0.14 T9, gap M19) is `TdBot` over the round's game, for `pnpm cli record
 * --bot`: the plan is the bot's list of steps.
 */

/** A `TdBot` plan as JSON: its steps in order. */
export const tdBotPlanSchema = z.array(
  z.discriminatedUnion('do', [
    z.strictObject({
      do: z.literal('place'),
      tower: z.string(),
      col: z.number().int(),
      row: z.number().int(),
    }),
    z.strictObject({ do: z.literal('sell'), col: z.number().int(), row: z.number().int() }),
    z.strictObject({ do: z.literal('wave') }),
    z.strictObject({ do: z.literal('wait'), ticks: z.number().int().min(0) }),
    z.strictObject({ do: z.literal('clear') }),
  ]),
);
export const kit = defineKit({
  name: 'towerdefense',
  kinds: () => [tdMapKind(), tdTowersKind(), tdWavesKind()] as unknown as ContentKind[],
  rules: TOWERDEFENSE_RULES,
  strictMutants: true,
  paramsDocs: () => [
    {
      game: TD_DEFENCE,
      description:
        "A mission over a world played as one tower-defense round (Engine 0.12): a `*.mission.json`'s `params` when its `play` is `td-defence`. The map, which world entities (walls) stand on its build cells, where the gold comes from, the lives, which world units come as the wave, and ordered rules from the round's report to the mission's declared outcomes",
      schema: tdDefenceParamsSchema,
    },
  ],
  roundBots: () => [
    {
      game: TD_DEFENCE,
      description:
        'TdBot over the round\'s game: its steps in order (place, sell, wave, wait, clear), such as [{"do": "place", "tower": "archers", "col": 11, "row": 1}, {"do": "wave"}]',
      plan: tdBotPlanSchema,
      create(plan) {
        const bot = new TdBot(plan as TdBotStep[]);
        return { next: (round) => bot.next((round as TdDefenceRound).game) };
      },
    },
  ],
});
