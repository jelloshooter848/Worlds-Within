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
  coyote: z
    .number()
    .int()
    .min(0)
    .max(30)
    .exactOptional()
    .describe(
      'coyote time: ticks after walking off a ledge (not after a jump) in which a jump press still jumps (0 when left out)',
    ),
  jumpCut: optVel(
    'letting go of jump while rising caps the upward speed at this (a short hop); left out, no cap',
  ),
  maxFall: vel('the fall speed cap'),
  fallReset: vel('the fall speed set when a fall goes over `maxFall`'),
  stompBounce: vel('the upward speed a stomp bounces the player with'),
  hp: z
    .number()
    .int()
    .min(1)
    .max(99)
    .default(1)
    .describe('the hit points (power level) the player starts with; a harm takes one, at 0 it dies'),
  maxHp: z
    .number()
    .int()
    .min(1)
    .max(99)
    .exactOptional()
    .describe('the most hit points a power-up can raise it to (`hp` when left out)'),
  invulnTicks: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('ticks after a harm in which the player cannot be harmed again'),
  breakBricksAt: z
    .number()
    .int()
    .min(1)
    .exactOptional()
    .describe('from this many hit points up a head bump breaks a brick; left out, bricks never break'),
  lives: z
    .number()
    .int()
    .min(1)
    .max(99)
    .default(1)
    .describe(
      'tries at the level: a death with a life left respawns the player at the last checkpoint touched, else the start',
    ),
});

const ticks = (what: string, min = 1) => z.number().int().min(min).max(600).describe(`${what}, in ticks`);
const attackName = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .describe('the attack it announces (a name for the skin: `charge`, `leap`, ...)');

/**
 * One step of a boss's attack pattern (Engine 0.16 T2). The pattern loops: after its last step
 * the first comes again. `idle` stands, `telegraph` stands and announces an attack (the
 * `boss-telegraph` event), `charge` runs at the player's side until a wall, `leap` jumps towards
 * the player and ends on landing, `shoot` fires a projectile actor ahead, `drop` drops one from
 * the top of the level over the player.
 */
const bossStep = z.discriminatedUnion('do', [
  z.strictObject({ do: z.literal('idle'), ticks: ticks('how long it stands') }),
  z.strictObject({
    do: z.literal('telegraph'),
    ticks: ticks('how long it announces the attack'),
    attack: attackName,
  }),
  z.strictObject({
    do: z.literal('charge'),
    speed: vel('the run towards the side the player is on, until a wall', 1),
    ticks: ticks('the longest the charge lasts when no wall stops it').exactOptional(),
  }),
  z.strictObject({
    do: z.literal('leap'),
    speed: vel('the take-off speed upwards', 1),
    run: vel('the speed towards the player in the air'),
  }),
  z.strictObject({
    do: z.literal('shoot'),
    actor: z.string().min(1).describe('the projectile actor type it fires ahead, at its own speed'),
    ticks: ticks('how long it stands after firing (1 when left out)').exactOptional(),
  }),
  z.strictObject({
    do: z.literal('drop'),
    actor: z.string().min(1).describe('the projectile actor type dropped from the top over the player'),
    spread: z
      .number()
      .int()
      .min(0)
      .max(16)
      .exactOptional()
      .describe("up to this many tiles either side of the player's column, from the world's rng (0)"),
    ticks: ticks('how long it stands after dropping (1 when left out)').exactOptional(),
  }),
]);

const bossPattern = z.array(bossStep).min(1).max(64);

/** A boss form: hit points, a looping attack pattern and phases (Engine 0.16 T2). */
const bossSchema = z.strictObject({
  hp: z.number().int().min(1).max(99).describe('the hits it takes to beat it (a stomp is one)'),
  hitInvuln: ticks('after a hit, how long a stomp only bounces off it', 0),
  defeatTicks: ticks('how long its defeat sequence lasts before it is gone'),
  pattern: bossPattern.describe('its attack steps, looped'),
  phases: z
    .array(
      z.strictObject({
        hp: z.number().int().min(1).max(98).describe('the phase starts once its hp is this or under'),
        pattern: bossPattern.describe("the phase's attack steps, looped, from its first"),
      }),
    )
    .max(8)
    .exactOptional()
    .describe('later patterns by hit points left, highest hp first (a faster pattern below half hp)'),
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
  kickGrace: z
    .number()
    .int()
    .min(0)
    .max(120)
    .exactOptional()
    .describe(
      'ticks after a kick (or a stomp that makes it) in which it does not touch the player (15 when left out)',
    ),
  projectile: z
    .enum(['flies', 'falls'])
    .exactOptional()
    .describe(
      'a projectile (Engine 0.16 T2): `flies` straight at its speed with no gravity, `falls` with gravity; either is gone at a wall, on landing or on touching the player',
    ),
  boss: bossSchema
    .exactOptional()
    .describe('a boss form (Engine 0.16 T2): hit points, a looping, telegraphed attack pattern and phases'),
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
    if (p.player.maxHp !== undefined && p.player.maxHp < p.player.hp)
      issue(['player', 'maxHp'], 'bad_hp', `maxHp ${p.player.maxHp} is under the starting hp ${p.player.hp}`);
    for (const [name, a] of Object.entries(p.actors)) {
      if (a.stompInto !== undefined && !Object.hasOwn(p.actors, a.stompInto)) {
        const known = Object.keys(p.actors).join(', ');
        const msg = `a stomp turns it into "${a.stompInto}", which is not an actor type here (known: ${known})`;
        issue(['actors', name, 'stompInto'], 'unknown_actor', msg);
      }
      if (a.kickable && a.kickSpeed === undefined)
        issue(['actors', name, 'kickSpeed'], 'missing_field', 'a kickable actor needs "kickSpeed"');
      if (a.boss) checkBoss(name, a, p, issue);
    }
  });

type Issue = (path: PropertyKey[], code: string, message: string) => void;

/**
 * A boss form's checks beyond its shape: not kickable and no `stompInto` (`bad_boss`), phases
 * under its hp in falling order (`bad_boss`), and every projectile a real, non-boss actor type
 * (`unknown_actor`).
 */
function checkBoss(
  name: string,
  a: z.output<typeof actorSchema>,
  p: { actors: Record<string, unknown> },
  issue: Issue,
) {
  const boss = a.boss!;
  const at = ['actors', name];
  if (a.kickable) issue([...at, 'kickable'], 'bad_boss', 'a boss cannot be kickable');
  if (a.stompInto !== undefined)
    issue([...at, 'stompInto'], 'bad_boss', 'a boss has no "stompInto": stomps hit it');
  let above = boss.hp;
  (boss.phases ?? []).forEach((ph, i) => {
    if (ph.hp >= above)
      issue(
        [...at, 'boss', 'phases', i, 'hp'],
        'bad_boss',
        `a phase's hp must be under ${above} (its hp or the last phase's)`,
      );
    above = Math.min(above, ph.hp);
  });
  const patterns = [boss.pattern, ...(boss.phases ?? []).map((ph) => ph.pattern)];
  patterns.forEach((pattern, pi) =>
    pattern.forEach((step, i) => {
      if (step.do !== 'shoot' && step.do !== 'drop') return;
      const path =
        pi === 0
          ? [...at, 'boss', 'pattern', i, 'actor']
          : [...at, 'boss', 'phases', pi - 1, 'pattern', i, 'actor'];
      const type = p.actors[step.actor] as { boss?: unknown } | undefined;
      if (type === undefined)
        issue(
          path,
          'unknown_actor',
          `"${step.actor}" is not an actor type here (known: ${Object.keys(p.actors).join(', ')})`,
        );
      else if (type.boss !== undefined)
        issue(path, 'bad_boss', `"${step.actor}" is a boss, not a projectile`);
    }),
  );
}

export type ProfileDef = z.output<typeof profileSchema>;
/** A boss form (`ActorType.boss`) and one step of its pattern. */
export type BossDef = NonNullable<ActorType['boss']>;
export type BossStep = BossDef['pattern'][number];
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
