import { defineRules } from '@engine/core/rules';

/**
 * The tower-defense kit's named rules, for mutant checks (`engine/core/rules.ts`): each one's code
 * in `world.ts` is guarded by `rules.isOn(id)`, so a run can switch it off. The kit opts in to
 * strict mutants (docs/BUILD-LOG.md, Engine 0.12, decision 1): the sample's run files
 * (`games/samples/tower-defense/runs/`) guard every rule, and `pnpm cli mutants` fails on one they
 * do not.
 */
export const TOWERDEFENSE_RULES = defineRules([
  {
    id: 'build-on-build-cells',
    description: 'a tower can be placed only on a build cell (off: on any cell without a tower)',
  },
  {
    id: 'build-costs-gold',
    description: 'placing a tower needs its cost in gold and pays it (off: towers are free)',
  },
  { id: 'sell-refunds', description: "selling a tower gives back its type's sell value" },
  {
    id: 'wave-timer',
    description: "with the wave list's timer, the next wave starts by itself timer ticks after the last",
  },
  {
    id: 'spawn-spacing',
    description: "a group's enemies come spacing (plus jitter) ticks apart (off: all at once)",
  },
  { id: 'enemies-walk', description: 'enemies walk the path from the entry at their speed' },
  { id: 'towers-fire', description: 'a tower whose cooldown is up fires at an enemy in range' },
  {
    id: 'target-first',
    description:
      'a tower targets the enemy furthest along the path, ties to the lowest id (off: the lowest id in range)',
  },
  { id: 'tower-range', description: 'a tower reaches only enemies within its range (off: every enemy)' },
  { id: 'tower-cooldown', description: 'after a shot a tower waits its cooldown (off: it fires every tick)' },
  { id: 'kill-bounty', description: 'a killed enemy pays its bounty in gold' },
  { id: 'leak-costs-life', description: 'an enemy reaching the exit costs a life' },
  { id: 'win-on-clear', description: 'the round is won once every wave has come and no enemy is left' },
  { id: 'lose-at-zero-lives', description: 'the round is lost when the lives reach 0' },
]);
