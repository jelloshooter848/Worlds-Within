import { defineRules } from '@engine/core/rules';

/**
 * The RTS kit's named rules (`engine/core/rules.ts`), for `disabledRules` and `pnpm cli mutants`.
 * The kit holds no world rules (movement, combat, the economy are `engine/sim` systems); these are
 * the kit's own decisions: how the scripted enemy follows its plan and how pointer commands turn
 * into orders. Every rule is on by default.
 */
export const RTS_RULES = defineRules([
  { id: 'enemy-follows-plan', description: "the scripted enemy issues its plan's orders" },
  {
    id: 'enemy-waits-for-trigger',
    description: 'a plan step with a `when` condition fires only once the condition holds',
  },
  {
    id: 'enemy-knows-only-what-it-saw',
    description:
      'a plan with `knowledge: "fog"` targets and counts only the enemies its side sees or remembers (off: it reads the whole world)',
  },
  { id: 'box-selects-own-units', description: "a box selects only the player's own units" },
  {
    id: 'command-attacks-enemies',
    description: 'a command on an enemy unit or building attacks it (off: it moves there)',
  },
  {
    id: 'command-gathers-resources',
    description: 'a command on a resource node sends the gatherers to gather it (off: they move there)',
  },
]);

export type RtsRuleId = (typeof RTS_RULES)[number]['id'];
