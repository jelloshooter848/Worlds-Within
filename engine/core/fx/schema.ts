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

// ---- Particle emitters (Engine 0.16 T3) ----

/** What an emitter's particles look like when the skin leaves a field out. */
export const EMITTER_DEFAULTS = {
  max: 64,
  life: 12,
  speed: 0,
  angle: [0, 360] as [number, number],
  size: 1,
  color: '#fcfcfc',
  alpha: 1,
  duration: 20,
} as const;

/** A number, or `[min, max]`: each particle draws its own value in that range (fxRng). */
const range = (what: string, min?: number) => {
  const n = min === undefined ? z.number() : z.number().min(min);
  return z
    .union([n, z.tuple([n, n])])
    .describe(`${what}: one number, or [min, max] drawn per particle`)
    .refine((v) => !Array.isArray(v) || v[0] <= v[1], { message: 'a range is [min, max] with min <= max' });
};

/** Keyframes over a particle's life: one value, values evenly spaced, or `{ at, value }` stops. */
function keyframes<T extends z.ZodType>(value: T, what: string) {
  const stop = z.strictObject({
    at: z.number().min(0).max(1).describe('0 at birth, 1 at the last frame of its life'),
    value,
  });
  return z
    .union([value, z.array(value).min(1), z.array(stop).min(1)])
    .describe(
      `${what} over the particle's life: one value, a list spaced evenly from birth to death, or a list of \`{ at, value }\` stops (at 0 to 1, ascending)`,
    )
    .refine(
      (v) =>
        !Array.isArray(v) ||
        v.every((s, i) => {
          if (typeof s !== 'object' || s === null || !('at' in s)) return true;
          const prev = i === 0 ? undefined : (v[i - 1] as { at?: number }).at;
          return prev === undefined || prev <= (s as { at: number }).at;
        }),
      { message: 'stops must be in ascending `at` order' },
    );
}

const emitterShape = z
  .union([
    z.literal('point'),
    z.strictObject({ circle: z.number().positive().describe('radius in world px') }),
    z.strictObject({
      box: z.strictObject({
        w: z.number().positive().describe('width in world px'),
        h: z.number().positive().describe('height in world px'),
      }),
    }),
  ])
  .describe('where particles are born round the emitter: `point`, `{ circle: r }` or `{ box: { w, h } }`');

/**
 * One named particle emitter as a skin writes it under `emitters` (Engine 0.16 T3): how many
 * particles it makes (`burst` at once, `rate` per frame), how they move (`speed`, `angle`,
 * `gravity`, `drag`) and how they look over their life (`size`, `color`, `alpha` keyframes, an
 * optional sprite `frame`, `blend`, `glow`). Units are world px and presentation frames.
 *
 *   "dust": { "burst": 6, "life": [10, 16], "speed": [0.3, 0.8], "angle": [190, 350],
 *             "gravity": 0.02, "drag": 0.08, "size": [2, 1], "color": "#d8c8a8", "alpha": [0.9, 0] }
 */
export const emitterSchema = z
  .strictObject({
    burst: z
      .number()
      .int()
      .min(0)
      .exactOptional()
      .describe('particles made at once when it starts (default 0)'),
    rate: z
      .number()
      .positive()
      .exactOptional()
      .describe('particles made each frame while it runs (fractions add up: 0.25 is one every 4 frames)'),
    duration: z
      .number()
      .int()
      .min(1)
      .exactOptional()
      .describe(
        `frames a \`rate\` emitter started by an event runs (default ${EMITTER_DEFAULTS.duration}); a kind's emitter runs while the entity shows`,
      ),
    life: range('frames each particle lives', 1).exactOptional(),
    speed: range('start speed, world px per frame', 0).exactOptional(),
    angle: range('start direction in degrees (0 right, 90 down, 270 up)').exactOptional(),
    even: z
      .boolean()
      .exactOptional()
      .describe('spread a burst evenly across `angle` instead of at random (a ring)'),
    gravity: z
      .number()
      .exactOptional()
      .describe('px per frame added to the downward speed each frame (default 0)'),
    drag: z
      .number()
      .min(0)
      .max(1)
      .exactOptional()
      .describe('the share of its speed a particle loses each frame (default 0)'),
    shape: emitterShape.exactOptional(),
    offset: z
      .strictObject({ x: z.number().describe('world px right'), y: z.number().describe('world px down') })
      .exactOptional()
      .describe('world px from the anchor point to the emitter'),
    anchor: z
      .enum(['centre', 'feet', 'top'])
      .exactOptional()
      .describe("on an entity: its box's centre, bottom centre (`feet`) or top centre (default centre)"),
    follow: z
      .boolean()
      .exactOptional()
      .describe(
        "started by an event: keep moving with the event's entity while it runs (a kind's emitter always does)",
      ),
    size: keyframes(z.number().min(0), 'size in world px').exactOptional(),
    color: keyframes(hex, 'colour').exactOptional(),
    alpha: keyframes(z.number().min(0).max(1), 'opacity').exactOptional(),
    frame: z
      .string()
      .min(1)
      .exactOptional()
      .describe('2D: a sprite frame drawn for each particle instead of a square (3D draws squares)'),
    sheet: z.string().min(1).exactOptional().describe("2D: the frame's sprite file (default `sheets.sheet`)"),
    blend: z
      .enum(['normal', 'add'])
      .exactOptional()
      .describe('`add` brightens what is under it (fire, sparks, magic); default `normal`'),
    glow: z
      .number()
      .positive()
      .exactOptional()
      .describe('2D: a soft glow of this radius in px round each particle'),
    max: z
      .number()
      .int()
      .min(1)
      .exactOptional()
      .describe(`the most particles of one running emitter alive at once (default ${EMITTER_DEFAULTS.max})`),
  })
  .describe('a particle emitter');

export type EmitterDef = z.output<typeof emitterSchema>;
/** Keyframes as an emitter gives them. */
export type Keyframes<T> = T | readonly T[] | readonly { at: number; value: T }[];

// ---- Camera effects (Engine 0.16 T4) ----

/**
 * A camera shake as a skin's event entry writes it (`events.stomp.shake`): trauma that decays
 * over `ticks` presentation frames, `amount` the largest offset in picture px at its start.
 *
 *   "shake": { "amount": 4, "ticks": 12 }
 */
export const shakeSpecSchema = z
  .strictObject({
    amount: z.number().positive().describe('the largest offset in picture px when it starts'),
    ticks: z.number().int().min(1).describe('presentation frames until it has decayed to nothing'),
  })
  .describe('a camera shake: trauma decaying over `ticks`, noise from the presentation RNG');

/**
 * A zoom punch (`events.cleared.zoom`): the camera zooms by the factor `to` (2 is twice as close)
 * over `ticks` with `ease`, holds it `hold` frames, then goes back to 1 over `back` frames (default
 * `ticks`) with the same curve played backwards.
 *
 *   "zoom": { "to": 1.5, "ticks": 10, "ease": "cubicOut", "hold": 20 }
 */
export const zoomSpecSchema = z
  .strictObject({
    to: z.number().positive().describe('the zoom factor it reaches, on top of the camera zoom (1 is none)'),
    ticks: z.number().int().min(1).describe('presentation frames to reach it'),
    ease: z
      .enum(EASE_NAMES)
      .exactOptional()
      .describe('the easing curve (default `linear`), played backwards on the way back'),
    hold: z.number().int().min(0).exactOptional().describe('frames it stays at `to` (default 0)'),
    back: z
      .number()
      .int()
      .min(0)
      .exactOptional()
      .describe('frames to go back to 1 (default `ticks`; 0 snaps back)'),
  })
  .describe('a zoom punch: to `to` and back');

/**
 * A screen flash (`events.hurt.flash`): the whole picture covered in `color` at `alpha`, fading to
 * nothing over `ticks`. Skipped with the player's reduced-flashing setting.
 *
 *   "flash": { "color": "#fcfcfc", "alpha": 0.7, "ticks": 6 }
 */
export const flashSpecSchema = z
  .strictObject({
    color: hex.exactOptional().describe('the colour (default `#fcfcfc`)'),
    alpha: z.number().min(0).max(1).exactOptional().describe('its opacity when it starts (default 1)'),
    ticks: z.number().int().min(1).describe('presentation frames it fades over'),
  })
  .describe('a full-screen flash, skipped with reduced flashing');

/**
 * A hit-pause (`events.stomp.hitPause`): the browser shell holds the game's ticks for `ticks`
 * display frames while the presenters keep drawing (a freeze frame). Headless runs ignore it, so
 * the tick sequence and every hash stay the same.
 */
export const hitPauseSpecSchema = z
  .strictObject({
    ticks: z.number().int().min(1).max(60).describe('display frames the game is held (at most 60)'),
  })
  .describe('a hit-pause (freeze frames) in the browser shell');

export type ShakeSpec = z.output<typeof shakeSpecSchema>;
export type ZoomSpec = z.output<typeof zoomSpecSchema>;
export type FlashSpec = z.output<typeof flashSpecSchema>;
export type HitPauseSpec = z.output<typeof hitPauseSpecSchema>;

// ---- Parallax layers (Engine 0.16 T4) ----

/** How a parallax layer repeats: across (`x`), down (`y`), both (`xy`) or not at all (`none`). */
export const PARALLAX_REPEATS = ['x', 'y', 'xy', 'none'] as const;
export type ParallaxRepeat = (typeof PARALLAX_REPEATS)[number];

/** The bands a gradient layer is drawn in when it gives none (pixel-art steps, not a smooth ramp). */
export const PARALLAX_DEFAULT_BANDS = 8;

const parallaxFactor = z
  .union([
    z.number().min(0).max(2),
    z.strictObject({
      x: z.number().min(0).max(2).describe('across'),
      y: z.number().min(0).max(2).describe('down'),
    }),
  ])
  .describe(
    'how fast it scrolls with the camera: 0 stays put on the screen (a sky), 1 moves with the world; one number or `{ x, y }`',
  );

/**
 * One parallax background layer (a skin's top-level `parallax` list, back to front), drawn
 * behind the map: a sprite `frame` (from `sheet`, else `sheets.sheet`), repeated as `repeat` says,
 * or a colour `gradient` (top to bottom, in `bands` flat steps, `height` px tall). Its top is `y`
 * picture px down when the camera is at the world's top, and it scrolls `factor` as fast as the
 * world. `depth` places it in 3D: a plane that far behind the blocks.
 *
 *   { "gradient": ["#3cbcfc", "#a4e4fc"], "factor": 0 }
 *   { "frame": "hills-far", "factor": { "x": 0.25, "y": 0.1 }, "y": 120, "depth": 400 }
 */
export const parallaxLayerSchema = z
  .strictObject({
    frame: z
      .string()
      .min(1)
      .exactOptional()
      .describe('a sprite frame drawn as the layer (or give `gradient`)'),
    sheet: z.string().min(1).exactOptional().describe("the frame's sprite file (default `sheets.sheet`)"),
    gradient: z
      .array(hex)
      .min(1)
      .exactOptional()
      .describe('colours from top to bottom, blended in `bands` flat steps (or give `frame`)'),
    bands: z
      .number()
      .int()
      .min(1)
      .max(64)
      .exactOptional()
      .describe(`a gradient's flat steps (default ${PARALLAX_DEFAULT_BANDS})`),
    height: z
      .number()
      .int()
      .min(1)
      .exactOptional()
      .describe("a gradient's height in picture px (default the picture's)"),
    factor: parallaxFactor,
    repeat: z
      .enum(PARALLAX_REPEATS)
      .exactOptional()
      .describe('a frame repeats across (`x`, the default), down (`y`), both (`xy`) or not (`none`)'),
    x: z.number().int().exactOptional().describe('picture px right of the scroll origin (default 0)'),
    y: z
      .number()
      .int()
      .exactOptional()
      .describe("its top in picture px when the camera is at the world's top (default 0)"),
    depth: z
      .number()
      .positive()
      .exactOptional()
      .describe(
        '3D: how far behind the blocks the plane stands, in px (default further back for earlier layers)',
      ),
  })
  .superRefine((v, ctx) => {
    if ((v.frame === undefined) === (v.gradient === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: [v.frame === undefined ? 'frame' : 'gradient'],
        message: 'give exactly one of "frame" (a sprite) and "gradient" (colours)',
      });
    }
    for (const key of ['bands', 'height'] as const) {
      if (v[key] !== undefined && v.gradient === undefined)
        ctx.addIssue({ code: 'custom', path: [key], message: `"${key}" goes with "gradient"` });
    }
    for (const key of ['sheet', 'repeat'] as const) {
      if (v[key] !== undefined && v.frame === undefined)
        ctx.addIssue({ code: 'custom', path: [key], message: `"${key}" goes with "frame"` });
    }
  })
  .describe('a parallax background layer');

export type ParallaxLayer = z.output<typeof parallaxLayerSchema>;
