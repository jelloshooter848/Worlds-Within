import { z } from 'zod';
import type { ContentKind } from '@engine/core/content/kinds';

/**
 * Physics profiles: the movement numbers of a platformer and its actor types, as data. A level
 * names the profile it is played with (`"profile": "runner"` reads `runner.profile.json`).
 *
 * Units are whole numbers, NES style, so results never depend on floating-point rounding:
 *
 * - positions in sub-pixels, 1/256 px (`SUB`); a tile is 16 px, 4096 sub-pixels;
 * - velocities in 1/4096 px per tick (`VEL`: 4096 is 1 px per tick), and accelerations (gravity,
 *   accel, friction) in the same unit per tick; a body moves `v >> 4` sub-pixels a tick;
 * - sizes (`box`) in whole pixels, times (`runHold`) in ticks.
 *
 *   runner.profile.json  { "id": "runner", "player": { "walkAccel": 152, ... },
 *                          "actorGravity": 1024, "actorMaxFall": 16384,
 *                          "actors": { "walker": { "speed": 2048, "turnAt": "walls", ... } } }
 *
 * Actor types have generic names (`walker`, `shell`, ...) and every behaviour is set here, not in
 * code: speed, where it turns, whether a stomp beats it and what it turns into, whether it can be
 * kicked, whether touching it harms.
 */

/** Sub-pixels per pixel. */
export const SUB = 256;
/** Velocity units per pixel per tick. */
export const VEL = 4096;

const int = (min: number) => z.number().int().min(min);
const vel = (what: string, min = 0) => int(min).describe(`${what}, in 1/4096 px per tick`);
const optVel = (what: string, min = 0) => int(min).exactOptional().describe(`${what}, in 1/4096 px per tick`);
const acc = (what: string) => int(0).describe(`${what}, in 1/4096 px per tick, each tick`);

const box = z
  .strictObject({
    w: z.number().int().min(1).max(64).describe('width in px'),
    h: z.number().int().min(1).max(64).describe('height in px'),
  })
  .describe('the hit box in px, its bottom centre on the body position');

const jumpTier = z.strictObject({
  below: optVel('the |vx| at take-off this tier applies below (left out on the last tier)', 1),
  speed: vel('the take-off speed upwards'),
  holdGravity: acc('gravity while jump is held and the player still rises'),
  gravity: acc('gravity otherwise'),
});

const playerSchema = z.strictObject({
  box: box.describe("the player's hit box in px"),
  minWalk: vel('the speed a walk from rest starts at'),
  walkAccel: acc('acceleration while walking'),
  runAccel: acc('acceleration while running'),
  friction: acc('deceleration with no direction held'),
  skid: acc('deceleration while holding the way opposite to the motion (a skid)'),
  skidTurn: vel('below this speed a skid turns the player round at once'),
  maxWalk: vel('the walking speed cap'),
  maxRun: vel('the running speed cap'),
  runHold: z.number().int().min(0).describe('ticks the running cap lasts after run is let go'),
  jumps: z
    .array(jumpTier)
    .min(1)
    .describe('jump tiers by take-off speed, slowest first: the first whose `below` |vx| is under'),
  jumpBuffer: z
    .number()
    .int()
    .min(0)
    .max(30)
    .exactOptional()
    .describe('ticks a jump press is remembered until the player can jump (0 when left out)'),
  maxFall: vel('the fall speed cap'),
  fallReset: vel('the fall speed set when a fall goes over `maxFall`'),
  stompBounce: vel('the upward speed a stomp bounces the player with'),
});

/** One actor type's data-set behaviour. */
const actorSchema = z.strictObject({
  box: box.exactOptional().describe('the hit box in px (16x16 when left out)'),
  speed: vel('walking speed; 0 stands still'),
  turnAt: z
    .enum(['walls', 'ledges'])
    .describe('`walls`: turns round at a wall; `ledges`: also at the edge of a drop'),
  stompable: z.boolean().describe('a stomp from above beats it (and bounces the player)'),
  stompInto: z
    .string()
    .min(1)
    .exactOptional()
    .describe('the actor type a stomp turns it into; left out, a stomp defeats it'),
  kickable: z.boolean().describe('touching it while it stands still kicks it away'),
  kickSpeed: optVel('the speed a kick sends it at; required when kickable'),
  harms: z.boolean().describe('touching it (other than a stomp or a kick) harms the player'),
});

export const profileSchema = z
  .strictObject({
    id: z.string().min(1).describe('the profile id: its file name (`runner.profile.json` is `runner`)'),
    player: playerSchema.describe("the player's movement numbers"),
    actorGravity: acc('gravity on every actor'),
    actorMaxFall: vel("every actor's fall speed cap"),
    actors: z
      .record(z.string().regex(/^[a-z][a-z0-9-]*$/), actorSchema)
      .describe('actor types by generic name (`walker`, `shell`): lower-case letters, digits and "-"'),
  })
  .superRefine((p, ctx) => {
    const issue = (path: PropertyKey[], code: string, message: string) =>
      ctx.addIssue({ code: 'custom', path, message, params: { code } });
    const tiers = p.player.jumps;
    tiers.forEach((t, i) => {
      const last = i === tiers.length - 1;
      if (last && t.below !== undefined)
        issue(['player', 'jumps', i, 'below'], 'bad_jump_tiers', 'the last jump tier has no "below"');
      if (!last && t.below === undefined)
        issue(
          ['player', 'jumps', i, 'below'],
          'bad_jump_tiers',
          'every jump tier but the last needs "below"',
        );
      const prev = tiers[i - 1]?.below;
      if (t.below !== undefined && prev !== undefined && t.below <= prev)
        issue(
          ['player', 'jumps', i, 'below'],
          'bad_jump_tiers',
          `"below" must be over the last tier's ${prev}`,
        );
    });
    if (p.player.maxWalk > p.player.maxRun)
      issue(['player', 'maxWalk'], 'bad_speed_caps', 'the walking cap is over the running cap');
    for (const [name, a] of Object.entries(p.actors)) {
      if (a.stompInto !== undefined && !Object.hasOwn(p.actors, a.stompInto)) {
        const known = Object.keys(p.actors).join(', ');
        const msg = `a stomp turns it into "${a.stompInto}", which is not an actor type here (known: ${known})`;
        issue(['actors', name, 'stompInto'], 'unknown_actor', msg);
      }
      if (a.kickable && a.kickSpeed === undefined)
        issue(['actors', name, 'kickSpeed'], 'missing_field', 'a kickable actor needs "kickSpeed"');
    }
  });

export type ProfileDef = z.output<typeof profileSchema>;
export type PlayerPhysics = ProfileDef['player'];
export type ActorType = ProfileDef['actors'][string];

/** The `profile` content kind: a game's `*.profile.json` files. */
export function profileKind(): ContentKind<typeof profileSchema> {
  return {
    name: 'profile',
    description:
      'A platformer physics profile: player movement numbers and actor types in whole sub-pixel and 1/4096 px per tick units',
    schema: profileSchema,
  };
}
