import { z } from 'zod';
import { CLOCK_STATUS } from '../clock';
import { lerpColor } from '../fx/color';
import { ease, EASE_NAMES, isEaseName, type EaseName } from '../fx/ease';
import type { Scene3dLook } from './scene3d';
import type { DeepReadonly, PresentFrame } from './types';

/**
 * The time of day in a 3D skin (Engine 0.16 F4): `scene3d.timeOfDay`, keyframes by hour that move
 * the sun, ambient, hemisphere, fog, background and exposure through the day, read from the
 * world clock a frame carries (`clockStatus` in `engine/core/clock.ts`: `clock.day` and
 * `clock.fraction`). Pure data and maths; the 3D backend applies the look each frame.
 *
 *   "timeOfDay": {
 *     "tween": 45, "ease": "sineInOut",
 *     "keys": [
 *       { "hour": 6, "sun": { "color": "#ffb070", "intensity": 0.8, "direction": { "x": -3, "y": 1, "z": 1 } },
 *         "ambient": { "intensity": 0.25 }, "fog": { "color": "#f0b890" }, "background": "#f0b890" },
 *       { "hour": 13, "sun": { "color": "#fff4d8", "intensity": 1.6 } },
 *       { "hour": 19, "sun": { "color": "#ff8040", "intensity": 0.6, "direction": { "x": 3, "y": 1, "z": 1 } },
 *         "background": "#c06040", "exposure": 0.9 },
 *       { "hour": 23, "sun": { "color": "#6080c0", "intensity": 0.2 }, "background": "#101828" }
 *     ] }
 *
 * Each key's fields are optional: one a key leaves out is the skin's own `scene3d` value (or the
 * skin's `background`). Between two keys every value is interpolated (colours channel by
 * channel, the sun's direction part by part); after the last key it runs on to the first one,
 * round midnight. A frame without the clock shows the skin's own look, so a skin keeps the look it
 * had before for every frame that carries no clock.
 *
 * World time jumps (a mission's commit cost moves the world tick two hours at once): a move of more
 * than {@link TIME_JUMP_HOURS} between two frames eases over `tween` display frames
 * ({@link DayClockTween}) instead of snapping; a steady clock follows at once.
 */

const color = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  message: 'a colour is "#rgb" or "#rrggbb"',
});

/** Display frames a jump in world time eases over when a skin gives none. */
export const DEFAULT_TIME_TWEEN = 45;

/** The easing of a jump when a skin gives none. */
export const DEFAULT_TIME_EASE: EaseName = 'sineInOut';

/** A move of the clock between two frames larger than this many hours eases instead of snapping. */
export const TIME_JUMP_HOURS = 0.5;

export const timeOfDayKeySchema = z.strictObject({
  hour: z.number().min(0).lt(24).describe('the hour of the day this key is the look at, 0 up to 24'),
  sun: z
    .strictObject({
      color: color.exactOptional().describe("the sun's colour"),
      intensity: z.number().min(0).exactOptional().describe("the sun's strength"),
      direction: z
        .strictObject({
          x: z.number().describe('px right'),
          y: z.number().describe('px up'),
          z: z.number().describe('px toward the camera'),
        })
        .exactOptional()
        .describe('where it shines from (as `scene3d.sun.direction`)'),
    })
    .exactOptional()
    .describe('the sun at this hour'),
  ambient: z
    .strictObject({
      color: color.exactOptional().describe('its colour'),
      intensity: z.number().min(0).exactOptional().describe('its strength'),
    })
    .exactOptional()
    .describe('the ambient light at this hour'),
  hemisphere: z
    .strictObject({
      sky: color.exactOptional().describe('the colour from above'),
      ground: color.exactOptional().describe('the colour from below'),
      intensity: z.number().min(0).exactOptional().describe('its strength'),
    })
    .exactOptional()
    .describe('the sky and ground light at this hour (strength 0 where the skin has none)'),
  fog: z
    .strictObject({
      color: color.exactOptional().describe('the fog colour'),
      near: z.number().exactOptional().describe('linear fog: where it starts'),
      far: z.number().positive().exactOptional().describe('linear fog: where it is full'),
      density: z.number().positive().exactOptional().describe('exp2 fog: how thick it is'),
    })
    .exactOptional()
    .describe("the fog at this hour (needs the skin's `scene3d.fog`)"),
  background: color.exactOptional().describe('the sky: the colour behind everything at this hour'),
  exposure: z.number().positive().exactOptional().describe("the tone mapping's exposure at this hour"),
});

export type TimeOfDayKey = z.output<typeof timeOfDayKeySchema>;

export const timeOfDaySchema = z
  .strictObject({
    status: z
      .string()
      .min(1)
      .exactOptional()
      .describe(
        `the clock's status prefix: it reads \`<status>.day\` and \`<status>.fraction\` (default \`${CLOCK_STATUS}\`)`,
      ),
    tween: z
      .int()
      .min(0)
      .exactOptional()
      .describe(`display frames a jump in world time eases over (default ${DEFAULT_TIME_TWEEN}; 0 snaps)`),
    ease: z.string().exactOptional().describe(`the jump's easing curve (default \`${DEFAULT_TIME_EASE}\`)`),
    keys: z
      .array(timeOfDayKeySchema)
      .min(1)
      .describe('the looks by hour, in rising hour order (round midnight from the last to the first)'),
  })
  .superRefine((t, ctx) => {
    if (t.ease !== undefined && !isEaseName(t.ease))
      ctx.addIssue({
        code: 'custom',
        path: ['ease'],
        message: `unknown ease "${t.ease}"; one of ${EASE_NAMES.join(', ')}`,
        params: { code: 'bad_ease' },
      });
    t.keys.forEach((k, i) => {
      if (i > 0 && k.hour <= t.keys[i - 1]!.hour)
        ctx.addIssue({
          code: 'custom',
          path: ['keys', i, 'hour'],
          message: `must be after the key before it (${t.keys[i - 1]!.hour}): give the keys in rising hour order`,
          params: { code: 'bad_time_key' },
        });
    });
  });

export type SkinTimeOfDay = z.output<typeof timeOfDaySchema>;

/** The look a time of day moves: every value filled. */
export interface DayLook {
  sun: { color: string; intensity: number; direction: { x: number; y: number; z: number } };
  ambient: { color: string; intensity: number };
  /** Strength 0 where the skin has no hemisphere light. */
  hemisphere: { sky: string; ground: string; intensity: number };
  /** Null where the skin has no fog. */
  fog: { color: string; near: number; far: number; density: number } | null;
  background: string;
  exposure: number;
}

/** A skin's own look (its `scene3d` with defaults, and its background) as a {@link DayLook}. */
export function baseDayLook(look: Scene3dLook, background: string): DayLook {
  const fog = look.fog;
  return {
    sun: { color: look.sun.color, intensity: look.sun.intensity, direction: { ...look.sun.direction } },
    ambient: { ...look.ambient },
    hemisphere:
      look.hemisphere === null ? { sky: '#ffffff', ground: '#ffffff', intensity: 0 } : { ...look.hemisphere },
    fog:
      fog === null
        ? null
        : fog.kind === 'linear'
          ? { color: fog.color, near: fog.near, far: fog.far, density: 0 }
          : { color: fog.color, near: 0, far: 0, density: fog.density },
    background,
    exposure: look.toneMapping.exposure,
  };
}

/** A key's look: its own values, the base's where it gives none. */
export function keyDayLook(base: DayLook, key: DeepReadonly<TimeOfDayKey>): DayLook {
  const fog = base.fog;
  return {
    sun: {
      color: key.sun?.color ?? base.sun.color,
      intensity: key.sun?.intensity ?? base.sun.intensity,
      direction: { ...(key.sun?.direction ?? base.sun.direction) },
    },
    ambient: {
      color: key.ambient?.color ?? base.ambient.color,
      intensity: key.ambient?.intensity ?? base.ambient.intensity,
    },
    hemisphere: {
      sky: key.hemisphere?.sky ?? base.hemisphere.sky,
      ground: key.hemisphere?.ground ?? base.hemisphere.ground,
      intensity: key.hemisphere?.intensity ?? base.hemisphere.intensity,
    },
    fog:
      fog === null
        ? null
        : {
            color: key.fog?.color ?? fog.color,
            near: key.fog?.near ?? fog.near,
            far: key.fog?.far ?? fog.far,
            density: key.fog?.density ?? fog.density,
          },
    background: key.background ?? base.background,
    exposure: key.exposure ?? base.exposure,
  };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** The look `t` of the way from `a` to `b` (0 gives `a`, 1 gives `b`). */
export function lerpDayLook(a: DayLook, b: DayLook, t: number): DayLook {
  const d = (k: 'x' | 'y' | 'z') => mix(a.sun.direction[k], b.sun.direction[k], t);
  return {
    sun: {
      color: lerpColor(a.sun.color, b.sun.color, t),
      intensity: mix(a.sun.intensity, b.sun.intensity, t),
      direction: { x: d('x'), y: d('y'), z: d('z') },
    },
    ambient: {
      color: lerpColor(a.ambient.color, b.ambient.color, t),
      intensity: mix(a.ambient.intensity, b.ambient.intensity, t),
    },
    hemisphere: {
      sky: lerpColor(a.hemisphere.sky, b.hemisphere.sky, t),
      ground: lerpColor(a.hemisphere.ground, b.hemisphere.ground, t),
      intensity: mix(a.hemisphere.intensity, b.hemisphere.intensity, t),
    },
    fog:
      a.fog === null || b.fog === null
        ? a.fog
        : {
            color: lerpColor(a.fog.color, b.fog.color, t),
            near: mix(a.fog.near, b.fog.near, t),
            far: mix(a.fog.far, b.fog.far, t),
            density: mix(a.fog.density, b.fog.density, t),
          },
    background: lerpColor(a.background, b.background, t),
    exposure: mix(a.exposure, b.exposure, t),
  };
}

/** A skin's time of day over its own look: {@link TimeOfDayLook.at} gives the look at any hour. */
export class TimeOfDayLook {
  /** The skin's own look (a frame without the clock shows it). */
  readonly base: DayLook;
  private readonly keys: { hour: number; look: DayLook }[];

  constructor(spec: DeepReadonly<SkinTimeOfDay>, base: DayLook) {
    this.base = base;
    this.keys = spec.keys.map((k) => ({ hour: k.hour, look: keyDayLook(base, k) }));
  }

  /** The look at `hour` of the day (any number: taken round the 24-hour day). */
  at(hour: number): DayLook {
    const h = ((hour % 24) + 24) % 24;
    const keys = this.keys;
    if (keys.length === 1) return keys[0]!.look;
    let i = keys.length - 1;
    for (let k = 0; k < keys.length; k++) if (keys[k]!.hour <= h) i = k;
    const a = keys[i]!;
    const b = keys[(i + 1) % keys.length]!;
    // Round midnight: the last key runs on to the first one of the next day.
    const from = a.hour;
    let to = b.hour;
    let at = h;
    if (to <= from) to += 24;
    if (at < from) at += 24;
    return lerpDayLook(a.look, b.look, (at - from) / (to - from));
  }
}

/**
 * The clock a frame carries as hours since day 1, 00:00 (`(day - 1) * 24 + fraction * 24`), or
 * null when its status lacks `<prefix>.day` or `<prefix>.fraction` as numbers.
 */
export function statusHours(
  status: DeepReadonly<PresentFrame['status']>,
  prefix: string = CLOCK_STATUS,
): number | null {
  const day = status[`${prefix}.day`];
  const fraction = status[`${prefix}.fraction`];
  if (typeof day !== 'number' || typeof fraction !== 'number') return null;
  return (day - 1) * 24 + fraction * 24;
}

/**
 * The hour a picture shows, one display frame at a time: the clock itself while it moves steadily,
 * and an eased move over `ticks` frames when it jumps by more than {@link TIME_JUMP_HOURS} (from
 * wherever the picture was to wherever the clock is now, so a clock that goes on moving during
 * the ease is followed). Presentation state only: one per scene, never in a frame or a hash.
 */
export class DayClockTween {
  private readonly ticks: number;
  private readonly curve: EaseName;
  private last: number | null = null;
  private shownHours: number | null = null;
  private from = 0;
  private t = 0;
  private easing = false;

  constructor(opts: { ticks?: number; ease?: string } = {}) {
    this.ticks = opts.ticks ?? DEFAULT_TIME_TWEEN;
    this.curve = opts.ease !== undefined && isEaseName(opts.ease) ? opts.ease : DEFAULT_TIME_EASE;
  }

  /** Whether a jump is being eased. */
  get active(): boolean {
    return this.easing;
  }

  /** The hours to show this frame for the clock at `hours` (null: no clock; it starts afresh). */
  shown(hours: number | null): number | null {
    if (hours === null) {
      this.last = this.shownHours = null;
      this.easing = false;
      return null;
    }
    if (this.last === null || this.shownHours === null) {
      this.last = this.shownHours = hours;
      return hours;
    }
    if (Math.abs(hours - this.last) > TIME_JUMP_HOURS && this.ticks > 0) {
      this.from = this.shownHours;
      this.t = 0;
      this.easing = true;
    }
    this.last = hours;
    if (this.easing) {
      this.t++;
      this.shownHours = mix(this.from, hours, ease(this.curve, Math.min(1, this.t / this.ticks)));
      if (this.t >= this.ticks) this.easing = false;
    } else this.shownHours = hours;
    return this.shownHours;
  }
}
