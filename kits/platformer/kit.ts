import type { ContentKind } from '@engine/core/content/kinds';
import { defineKit } from '@engine/core/kit';
import { profileKind } from './profile';
import { PLATFORMER_RULES } from './rules';
import { levelKind } from './schema';

/**
 * The platformer kit's hook for the tools (`engine/core/kit.ts`): its content kinds (levels and
 * physics profiles) and its named rules. It opts in to strict mutant checks: a rule no run file
 * guards fails `pnpm cli mutants`.
 */
export const kit = defineKit({
  name: 'platformer',
  kinds: () => [levelKind() as unknown as ContentKind, profileKind() as unknown as ContentKind],
  rules: PLATFORMER_RULES,
  strictMutants: true,
});
