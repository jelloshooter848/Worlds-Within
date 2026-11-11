import type { ContentKind } from '@engine/core/content/kinds';
import { defineKit } from '@engine/core/kit';
import { RTS_RULES } from './rules';
import { rtsEndKind, rtsEnemyKind, rtsMapKind, rtsTypesKind } from './schema';

/**
 * The RTS kit's hook for the tools (`engine/core/kit.ts`): its content kinds (`rts-map`,
 * `rts-types`, `rts-enemy`, and since Engine 0.16 part D `rts-end`) and its named rules. The tools find it by the kit name a `game.json`
 * gives (`engine/tools/kits.ts`).
 */
export const kit = defineKit({
  name: 'rts',
  kinds: () => [rtsMapKind(), rtsTypesKind(), rtsEnemyKind(), rtsEndKind()] as unknown as ContentKind[],
  rules: RTS_RULES,
});
