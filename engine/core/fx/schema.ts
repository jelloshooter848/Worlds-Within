import { z } from 'zod';
import { EASE_NAMES } from './ease';

/**
 * Tween specs as text (docs/ROADMAP.md, Engine 0.16 part A): what a skin writes under an event's
 * `tween` or a kind's `spawnTween`. One spec tweens one property of one entity, in presentation
 * frames:
 *
 *   { "prop": "scale", "from": 1.4, "to": 1, "frames": 8, "ease": "backOut" }
 *   { "prop": "color", "from": "#fcfcfc", "to": "#d82800", "frames": 6, "yoyo": true, "amount": 0.6 }
 *
 * Numeric properties are offsets and factors laid on top of the entity's own look (`x`/`y` world
 * px added, `scale`/`scaleX`/`scaleY` and `alpha` multiplied, `rotate` degrees added); `color` is
 * an overlay over the entity's box. A tween never writes back to a frame.
 */

/** The numeric properties a tween can drive, with the value that leaves the entity unchanged. */
export const TWEEN_REST = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, alpha: 1 } as const;

export type NumberTweenProp = keyof typeof TWEEN_REST;

/** Every property a tween can drive: the numeric ones and `color`. */
export const TWEEN_PROPS = [...(Object.keys(TWEEN_REST) as NumberTweenProp[]), 'color'] as const;

export type TweenProp = (typeof TWEEN_PROPS)[number];

/** The colour a `color` tween starts from when it gives no `from`. */
export const TWEEN_DEFAULT_FROM_COLOR = '#ffffff';
/** How strongly a `color` tween's overlay covers the entity when it gives no `amount`. */
export const TWEEN_DEFAULT_AMOUNT = 0.5;

const hex = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  message: 'a colour is #rgb or #rrggbb',
});

const timing = {
  frames: z.number().int().min(1).describe('presentation frames one play takes'),
  delay: z
    .number()
    .int()
    .min(0)
    .exactOptional()
    .describe('frames to wait, holding `from`, before it starts (default 0)'),
  ease: z
    .enum(EASE_NAMES)
    .exactOptional()
    .describe(`the easing curve (default \`linear\`): ${EASE_NAMES.join(', ')}`),
  yoyo: z.boolean().exactOptional().describe('each play goes to `to` and back to `from` (twice as long)'),
  repeat: z
    .union([z.number().int().min(0), z.literal('forever')])
    .exactOptional()
    .describe('extra plays after the first (default 0), or `forever`'),
};

const numberTween = z.strictObject({
  prop: z
    .enum(Object.keys(TWEEN_REST) as [NumberTweenProp, ...NumberTweenProp[]])
    .describe(
      '`x`/`y` (world px added), `scale`/`scaleX`/`scaleY`/`alpha` (multiplied), `rotate` (degrees added)',
    ),
  from: z
    .number()
    .exactOptional()
    .describe("the start value (default the property's rest: 0, or 1 for scales and alpha)"),
  to: z.number().describe('the end value'),
  ...timing,
});

const colorTween = z.strictObject({
  prop: z.literal('color').describe('an overlay colour over the entity'),
  from: hex.exactOptional().describe(`the start colour (default \`${TWEEN_DEFAULT_FROM_COLOR}\`)`),
  to: hex.describe('the end colour'),
  amount: z
    .number()
    .min(0)
    .max(1)
    .exactOptional()
    .describe(`how strongly the overlay covers the entity, 0 to 1 (default ${TWEEN_DEFAULT_AMOUNT})`),
  ...timing,
});

/** One tween spec: a numeric property or `color` (told apart by `prop`). */
export const tweenSpecSchema = z
  .discriminatedUnion('prop', [numberTween, colorTween])
  .describe('one property tweened over presentation frames');

/** One spec or a list of them, run together: what a skin's `tween` and `spawnTween` take. */
export const tweensSchema = z
  .union([tweenSpecSchema, z.array(tweenSpecSchema).min(1)])
  .describe(
    'a tween spec `{ prop, from?, to, frames, delay?, ease?, yoyo?, repeat?, amount? }` or a list of them',
  );

export type TweenSpec = z.output<typeof tweenSpecSchema>;
export type NumberTweenSpec = z.output<typeof numberTween>;
export type ColorTweenSpec = z.output<typeof colorTween>;
export type TweensSpec = z.output<typeof tweensSchema>;
