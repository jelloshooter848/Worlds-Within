import type { ContentKind } from '@engine/core/content/kinds';
import { defineKit } from '@engine/core/kit';
import { TOWERDEFENSE_RULES } from './rules';
import { tdMapKind, tdTowersKind, tdWavesKind } from './schema';

/**
 * The tower-defense kit's hook for the tools (`engine/core/kit.ts`): its content kinds (`td-map`,
 * `td-towers`, `td-waves`) and its named rules. It does not opt in to strict mutant checks yet
 * (docs/BUILD-LOG.md, Engine 0.12, decision 1): that comes once the sample's run files guard every
 * rule. The tools find it by the kit name a `game.json` gives (`engine/tools/kits.ts`).
 */
export const kit = defineKit({
  name: 'towerdefense',
  kinds: () => [tdMapKind(), tdTowersKind(), tdWavesKind()] as unknown as ContentKind[],
  rules: TOWERDEFENSE_RULES,
});
