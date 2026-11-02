import { defineRules } from '@engine/core/rules';

/**
 * The top-down kit's named rules (`engine/core/rules.ts`): each guards one piece of kit code with
 * `world.rules.isOn(id)`, so a run can switch it off (`disableRules`) and `pnpm cli mutants` can
 * tell whether a run file notices. A few clear rules for now; the kit names the rest in Engine 0.5.
 */
export const TOPDOWN_RULES = defineRules([
  { id: 'walls-block-movement', description: 'wall tiles stop the hero, enemies and blocks' },
  { id: 'doors-change-room', description: 'walking off the room through a doorway slides to the next room' },
  { id: 'damage-reduces-hp', description: 'a hit takes half hearts off the hero' },
  { id: 'keys-open-locked-doors', description: 'bumping a locked doorway with a key held opens it' },
]);

/** One of the kit's rule ids. */
export type TopdownRule = (typeof TOPDOWN_RULES)[number]['id'];
