import type { ContentKind } from '@engine/core/content/kinds';
import { defineKit } from '@engine/core/kit';
import { TD_DEFENCE, tdDefenceParamsSchema } from './mission-defence';
import { TOWERDEFENSE_RULES } from './rules';
import { tdMapKind, tdTowersKind, tdWavesKind } from './schema';

/**
 * The tower-defense kit's hook for the tools (`engine/core/kit.ts`): its content kinds (`td-map`,
 * `td-towers`, `td-waves`) and its named rules. It opts in to strict mutant checks
 * (docs/BUILD-LOG.md, Engine 0.12, decision 1): since Engine 0.12 T4 the sample's run files
 * (`games/samples/tower-defense/runs/`) guard every rule, so a rule no run file guards fails `pnpm
 * cli mutants`. Its `paramsDocs` lists the `td-defence` mini game's params (Engine 0.12 T6) for the
 * schema reference. The tools find it by the kit name a `game.json` gives (`engine/tools/kits.ts`).
 */
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
});
