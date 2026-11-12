import { z } from 'zod';
import { ease, EASE_NAMES, isEaseName } from '../fx/ease';
import { shakeSpecSchema } from '../fx/schema';
import type { DeepReadonly, PresentEvent } from './types';

/**
 * Projectiles (Engine 0.16 E6, the tower defense's shots): an event entry's `projectile` look, a
 * sprite frame (or a small square) flying from the event's `fromX`/`fromY` to its `x`/`y` over
 * `ticks` presentation frames, optionally on an arc and turned to the way it flies, then an
 * `impact` (emitters, a sound, a camera shake) on the frame it lands. Presentation only: it is
 * started by a frame's events and timed by frame numbers, so it never reaches a kit, a frame or a
 * hash; the impact's particles draw through the presentation RNG (`fxRng`) as any emitter's do.
 * The maths here is pure; the 2D walk (`engine/core/draw`) draws it.
 */

const id = z.string().min(1);
const color = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  message: 'expected a hex colour like #fff or #ffffff',
});
const emitRefs = z
  .union([id, z.array(id).min(1)])
  .describe("the name of an emitter in the skin's `emitters`, or a list of names");

/** A projectile's square side, px, when it has no frame and gives no `size`. */
export const PROJECTILE_DEFAULT_SIZE = 2;

/** A projectile's square colour when it has no frame and gives no `color`. */
export const PROJECTILE_DEFAULT_COLOR = '#fcfcfc';

/** The most projectiles one presenter keeps in flight; a shot over it lands at once. */
export const PROJECTILE_MAX = 256;

export const projectileImpactSchema = z
  .strictObject({
    emit: emitRefs
      .exactOptional()
      .describe("emitters started where it lands (the event's `x`/`y`), on the frame it lands"),
    sound: id.exactOptional().describe('a song or sfx played as it lands'),
    shake: shakeSpecSchema.exactOptional().describe('a camera shake as it lands, `{ amount, ticks }`'),
  })
  .describe('what happens where and when the projectile lands; with no flight (no `fromX`/`fromY`) at once');

export const projectileSchema = z
  .strictObject({
    frame: id
      .exactOptional()
      .describe('2D: the sprite frame drawn centred on its place (from `sheet`, else `sheets.sheet`)'),
    sheet: id
      .exactOptional()
      .describe('2D: the sprite file or image sheet of `frame` (default `sheets.sheet`)'),
    palette: id.exactOptional().describe("2D: the frame's palette (default `sheets.palette`)"),
    color: color
      .exactOptional()
      .describe(
        `the square's colour without a frame, or with one its sheet lacks (default \`${PROJECTILE_DEFAULT_COLOR}\`)`,
      ),
    size: z
      .number()
      .int()
      .min(1)
      .max(16)
      .exactOptional()
      .describe(`the square's side in world px without a frame (default ${PROJECTILE_DEFAULT_SIZE})`),
    ticks: z
      .number()
      .int()
      .min(1)
      .max(240)
      .describe('presentation frames it flies: it lands on the event frame plus `ticks`'),
    arc: z
      .number()
      .min(0)
      .max(256)
      .exactOptional()
      .describe('world px it rises above the straight line at mid-flight (a lobbed shell; default 0)'),
    ease: z.string().exactOptional().describe('the easing of its way along the flight (default `linear`)'),
    turn: z
      .boolean()
      .exactOptional()
      .describe('turn the frame to the way it flies (art drawn pointing right; default false)'),
    impact: projectileImpactSchema.exactOptional(),
  })
  .superRefine((v, ctx) => {
    if (v.ease !== undefined && !isEaseName(v.ease))
      ctx.addIssue({
        code: 'custom',
        path: ['ease'],
        message: `unknown ease "${v.ease}"; one of ${EASE_NAMES.join(', ')}`,
        params: { code: 'bad_ease' },
      });
  })
  .describe(
    "2D: a projectile flying from the event's `fromX`/`fromY` to its `x`/`y` over `ticks` frames, then its `impact` (Engine 0.16 E6)",
  );

export type SkinProjectile = z.output<typeof projectileSchema>;
export type SkinProjectileImpact = z.output<typeof projectileImpactSchema>;

/** Where a flight starts and ends (world px), read from an event; null without both points. */
export function projectileFlight(
  ev: DeepReadonly<PresentEvent>,
): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const fx = num(ev['fromX']);
  const fy = num(ev['fromY']);
  const tx = num(ev.x);
  const ty = num(ev.y);
  if (fx === null || fy === null || tx === null || ty === null) return null;
  return { from: { x: fx, y: fy }, to: { x: tx, y: ty } };
}

/** A projectile in flight: its centre in world px and the way it points (degrees clockwise from right). */
export interface ProjectilePlace {
  x: number;
  y: number;
  angle: number;
}

/**
 * A projectile's place `age` frames after its event (0 is the event's frame): its share of the
 * way is `ease(age / ticks)`, the straight line raised by `arc * 4 s (1 - s)` (the top of the arc
 * at mid-way), and its angle that of the path's tangent there. Null once it has landed (`age >=
 * ticks`) or before it started (`age < 0`).
 */
export function projectilePlace(
  look: DeepReadonly<Pick<SkinProjectile, 'ticks' | 'arc' | 'ease'>>,
  from: { x: number; y: number },
  to: { x: number; y: number },
  age: number,
): ProjectilePlace | null {
  if (age < 0 || age >= look.ticks) return null;
  const s = ease(look.ease !== undefined && isEaseName(look.ease) ? look.ease : undefined, age / look.ticks);
  const arc = look.arc ?? 0;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const x = from.x + dx * s;
  const y = from.y + dy * s - arc * 4 * s * (1 - s);
  // The tangent along the path (d/ds), whatever the ease: the way the path points there.
  const ty = dy - arc * 4 * (1 - 2 * s);
  const angle = dx === 0 && ty === 0 ? 0 : (Math.atan2(ty, dx) * 180) / Math.PI;
  return { x, y, angle };
}
