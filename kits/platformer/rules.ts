import { defineRules } from '@engine/core/rules';

/**
 * The platformer kit's named rules, for mutant checks (`engine/core/rules.ts`): each one's code is
 * guarded by `rules.isOn(id)`, so a run can switch it off. The kit opts in to strict mutants
 * (`kit.ts`), so every rule listed here must be guarded by a run file.
 */
export const PLATFORMER_RULES = defineRules([
  { id: 'gravity', description: 'airborne bodies speed up downwards each tick' },
  { id: 'fall-cap', description: 'a fall faster than maxFall drops back to fallReset' },
  { id: 'walk', description: 'a held direction speeds the player up on the ground, from minWalk to maxWalk' },
  { id: 'run-speed', description: 'holding run raises the ground speed cap to maxRun with runAccel' },
  { id: 'run-hold', description: 'the run cap lasts runHold ticks after run is let go' },
  { id: 'friction', description: 'with no direction held, the player slows on the ground and stops' },
  { id: 'skid', description: 'holding the way opposite the motion brakes hard, then turns round' },
  { id: 'air-control', description: 'a held direction steers in the air, capped by the take-off speed' },
  { id: 'jump', description: 'pressing jump on the ground (or within jumpBuffer ticks of landing) jumps' },
  { id: 'jump-by-speed', description: 'the jump tier (take-off speed, gravities) follows the take-off |vx|' },
  {
    id: 'variable-jump',
    description: 'while jump is held and the player rises, the lower holdGravity applies',
  },
  { id: 'solid-tiles', description: 'solid tiles stop bodies on both axes' },
  { id: 'one-way-platforms', description: 'one-way tiles hold up a body falling onto them from above' },
  { id: 'ceiling-bump', description: 'a head bump on a solid tile stops the rise at once' },
  { id: 'level-bounds', description: "the player stays between the level's left and right edges" },
]);
