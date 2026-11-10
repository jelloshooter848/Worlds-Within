import { defineRules } from '@engine/core/rules';

/** The player's movement and tile collision rules (`player.ts`, `body.ts`, `tiles.ts`). */
export const MOVEMENT_RULES = defineRules([
  { id: 'gravity', description: 'airborne bodies speed up downwards each tick' },
  { id: 'fall-cap', description: 'a fall faster than maxFall drops back to fallReset' },
  { id: 'walk', description: 'a held direction speeds the player up on the ground, from minWalk to maxWalk' },
  { id: 'run-speed', description: 'holding run raises the ground speed cap to maxRun with runAccel' },
  { id: 'run-hold', description: 'the run cap lasts runHold ticks after run is let go' },
  { id: 'friction', description: 'with no direction held, the player slows on the ground and stops' },
  { id: 'skid', description: 'holding the way opposite the motion brakes hard, then turns round' },
  { id: 'air-control', description: 'a held direction steers in the air, capped by the take-off speed' },
  { id: 'jump', description: 'pressing jump on the ground (or within jumpBuffer ticks of landing) jumps' },
  {
    id: 'coyote-time',
    description: 'for coyote ticks after walking off a ledge (not after a jump) a jump press still jumps',
  },
  { id: 'jump-by-speed', description: 'the jump tier (take-off speed, gravities) follows the take-off |vx|' },
  {
    id: 'variable-jump',
    description:
      'while jump is held and the player rises, the lower holdGravity applies; letting go while rising caps the rise at jumpCut',
  },
  { id: 'solid-tiles', description: 'solid tiles stop bodies on both axes' },
  { id: 'one-way-platforms', description: 'one-way tiles hold up a body falling onto them from above' },
  { id: 'ceiling-bump', description: 'a head bump on a solid tile stops the rise at once' },
  { id: 'level-bounds', description: "the player stays between the level's left and right edges" },
]);

/** The level object, enemy and outcome rules (`world.ts`, `actor.ts`). */
export const OBJECT_RULES = defineRules([
  { id: 'coins-collect', description: 'touching a coin tile takes it and counts it' },
  {
    id: 'bump-blocks',
    description: 'a head bump on a bump block gives what it holds and leaves it used',
  },
  {
    id: 'brick-break',
    description: 'a head bump breaks a brick when the player has breakBricksAt hit points or more',
  },
  { id: 'hazards-kill', description: 'touching a hazard tile kills the player' },
  { id: 'pits-kill', description: 'falling below the last row kills the player' },
  { id: 'goal-clears-level', description: 'touching a goal tile ends the level as cleared' },
  {
    id: 'checkpoints',
    description: 'touching a checkpoint tile makes it where a death with lives left respawns the player',
  },
  {
    id: 'scroll-lock',
    description: 'with scroll right, the view never scrolls back and its left edge holds the player in',
  },
  { id: 'actors-wake', description: 'an actor stays still until it comes near the view' },
  { id: 'walkers-turn', description: 'an actor that walks into a wall turns round' },
  { id: 'ledge-turn', description: 'an actor whose turnAt is ledges turns round at the edge of a drop' },
  {
    id: 'stomping',
    description: 'falling onto a stompable actor from above turns it into its stompInto type or defeats it',
  },
  { id: 'stomp-bounce', description: 'a stomp bounces the player up at stompBounce' },
  { id: 'shell-kick', description: 'touching a still kickable actor kicks it away at its kickSpeed' },
  { id: 'shell-hits-enemies', description: 'a moving kickable actor defeats the other actors it touches' },
  { id: 'enemy-touch-hurts', description: 'touching a harmful actor otherwise takes a hit point' },
  { id: 'invulnerability', description: 'after a hit the player cannot be harmed for invulnTicks ticks' },
]);

/** The mini game hook (`world.ts`, `engine/core/minigame.ts`). */
export const MINI_GAME_RULES = defineRules([
  {
    id: 'mini-games',
    description: 'touching a mini-game trigger pauses the level for its mini game, then applies the outcome',
  },
]);

/** The data-driven boss and its projectiles (`boss.ts`, `world.ts`; Engine 0.16 T2). */
export const BOSS_RULES = defineRules([
  {
    id: 'boss-pattern',
    description: "a boss steps through its pattern's telegraphs and attacks, looping (off: it stands still)",
  },
  {
    id: 'boss-phases',
    description: "a hit that takes a boss's hp to a phase's hp switches it to that phase's pattern",
  },
  {
    id: 'boss-stomp-hits',
    description:
      'a stomp on a boss takes one of its hit points and bounces the player (off: touching it only hurts)',
  },
  { id: 'boss-hit-invuln', description: 'after a hit a boss cannot be hit again for its hitInvuln ticks' },
  {
    id: 'boss-defeat-clears',
    description: 'with "clear": "boss", the end of the last boss\'s defeat sequence clears the level',
  },
  {
    id: 'boss-projectiles',
    description:
      'a projectile flies straight (or falls) and is gone at a wall, on landing or on touching the player',
  },
]);

/**
 * The platformer kit's named rules, for mutant checks (`engine/core/rules.ts`): each one's code is
 * guarded by `rules.isOn(id)`, so a run can switch it off. The kit opts in to strict mutants
 * (`kit.ts`), so every rule listed here must be guarded by a run file.
 */
export const PLATFORMER_RULES = defineRules([
  ...MOVEMENT_RULES,
  ...OBJECT_RULES,
  ...MINI_GAME_RULES,
  ...BOSS_RULES,
]);
