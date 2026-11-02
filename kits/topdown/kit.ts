import type { ContentKind } from '@engine/core/content/kinds';
import { defineKit } from '@engine/core/kit';
import { TOPDOWN_RULES } from './rules';
import { roomKind } from './schema';

/**
 * The top-down kit's hook for the tools (`engine/core/kit.ts`): its content kinds (rooms) and its
 * named rules. The tools find it by the kit name a `game.json` gives (`engine/tools/kits.ts`).
 */
export const kit = defineKit({
  name: 'topdown',
  kinds: () => [roomKind() as unknown as ContentKind],
  rules: TOPDOWN_RULES,
});
