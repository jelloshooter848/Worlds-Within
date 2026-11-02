import type { ContentBundle } from '@engine/core/content/bundle';
import type { ContentKind } from '@engine/core/content/kinds';
import { defineKit } from '@engine/core/kit';
import type { MiniGameUse } from '@engine/core/minigame-params';
import type { LevelDef } from './level';
import { profileKind } from './profile';
import { PLATFORMER_RULES } from './rules';
import { levelKind } from './schema';

/**
 * Every level trigger's mini game and params (gap G16, Engine 0.10): `triggers.<i>.game` and
 * `triggers.<i>.params` of each `level` file, in file and trigger order, for `validate`.
 */
export function levelMiniGameUses(content: ContentBundle): MiniGameUse[] {
  return content.entries
    .filter((e) => e.kind === 'level')
    .flatMap((e) =>
      (e.value as LevelDef).triggers.map((t, i) => ({
        file: e.file,
        game: t.game,
        gameAt: ['triggers', i, 'game'],
        params: t.params,
        paramsAt: ['triggers', i, 'params'],
      })),
    );
}

/**
 * The platformer kit's hook for the tools (`engine/core/kit.ts`): its content kinds (levels and
 * physics profiles), its named rules and where its levels name mini games (`miniGameUses`). It
 * opts in to strict mutant checks: a rule no run file guards fails `pnpm cli mutants`.
 */
export const kit = defineKit({
  name: 'platformer',
  kinds: () => [levelKind() as unknown as ContentKind, profileKind() as unknown as ContentKind],
  rules: PLATFORMER_RULES,
  strictMutants: true,
  miniGameUses: levelMiniGameUses,
});
