import { defineRules } from '@engine/core/rules';

/**
 * The platformer kit's named rules, for mutant checks (`engine/core/rules.ts`): each one's code is
 * guarded by `rules.isOn(id)`, so a run can switch it off. The kit opts in to strict mutants
 * (`kit.ts`), so every rule listed here must be guarded by a run file. Empty until the world
 * (gravity, variable jump, stomping, ...) arrives in Engine 0.5's T5.
 */
export const PLATFORMER_RULES = defineRules([]);
