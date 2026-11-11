import { z } from 'zod';
import { timeOfDaySchema } from './time-of-day';
import type { DeepReadonly, PresentEntity, PresentFrame } from './types';

/**
 * The 3D scene look (Engine 0.16 T12): lights, shadows, fog, tone mapping and world-anchored
 * labels, written in a `three` skin. Pure data and readings; the 3D backend builds them.
 *
 *   "scene3d": {
 *     "sun": { "color": "#fff4d8", "intensity": 1.6, "direction": { "x": -1, "y": 2, "z": 3 },
 *              "shadow": { "mapSize": 1024, "bias": -0.0005, "radius": 2 } },
 *     "ambient": { "color": "#b8c8ff", "intensity": 0.35 },
 *     "hemisphere": { "sky": "#a4e4fc", "ground": "#503000", "intensity": 0.5 },
 *     "fog": { "kind": "linear", "color": "#a4e4fc", "near": 80, "far": 900 },
 *     "toneMapping": { "kind": "aces", "exposure": 1.1 },
 *     "colorSpace": "srgb" }
 *
 * A kind entry's `light` (`{ kind: "point", color, intensity, distance, decay?, offset?, flicker? }`)
 * hangs a point light on each entity of the kind; `castShadow` / `receiveShadow` on kinds and
 * tiles say which meshes take part in the sun's shadows. A skin's `labels` (kind -> one label or a
 * list) draws text, bars and timers over entities on the HUD layer.
 *
 * A skin without `scene3d` keeps the look it had before (`camera3d.lights`: an ambient and one
 * directional light, no shadows, no fog, no tone mapping, sRGB output).
 */

const color = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  message: 'a colour is "#rgb" or "#rrggbb"',
});

const vec3 = z.strictObject({
  x: z.number().describe('px right'),
  y: z.number().describe('px up'),
  z: z.number().describe('px toward the camera'),
});

/** The direction the sun shines from when a skin gives none: up, left and in front. */
export const DEFAULT_SUN_DIRECTION = { x: -1, y: 2, z: 3 } as const;

/** Shadow defaults: the map's size, depth bias and blur radius (PCF). */
export const DEFAULT_SHADOW = { mapSize: 1024, bias: -0.0005, radius: 2 } as const;

/** Tone mapping kinds: ACES filmic, AgX, or none (the default). */
export const TONE_MAPPINGS = ['aces', 'agx', 'none'] as const;
export type ToneMappingKind = (typeof TONE_MAPPINGS)[number];

/** Fog kinds: `linear` (from `near` to `far` behind the z = 0 plane) or `exp2` (`density`). */
export const FOG_KINDS = ['linear', 'exp2'] as const;

/** Output colour spaces. */
export const OUTPUT_COLOR_SPACES = ['srgb', 'linear'] as const;

/** The largest render scale a skin or page may ask for (8 x 240 px is 1920 px tall). */
export const MAX_RENDER_SCALE = 8;

/** How far a ground view's `skirt` reaches past each map edge by default, px (Engine 0.16 F9). */
export const DEFAULT_SKIRT_MARGIN = 2048;

const shadowSchema = z.strictObject({
  mapSize: z
    .number()
    .int()
    .min(64)
    .max(4096)
    .exactOptional()
    .describe(`the shadow map's width and height in texels (default ${DEFAULT_SHADOW.mapSize})`),
  bias: z
    .number()
    .min(-0.1)
    .max(0.1)
    .exactOptional()
    .describe(`depth bias against shadow acne (default ${DEFAULT_SHADOW.bias})`),
  radius: z
    .number()
    .min(0)
    .max(16)
    .exactOptional()
    .describe(`blur radius of the soft edge, in texels (default ${DEFAULT_SHADOW.radius})`),
});

export const scene3dSchema = z
  .strictObject({
    sun: z
      .strictObject({
        color: color.exactOptional().describe('its colour (default white)'),
        intensity: z
          .number()
          .min(0)
          .exactOptional()
          .describe('its strength (default `camera3d.lights.directional`)'),
        direction: vec3
          .exactOptional()
          .describe(
            `where it shines from, toward the view's centre (default ${JSON.stringify(DEFAULT_SUN_DIRECTION)})`,
          ),
        shadow: shadowSchema
          .exactOptional()
          .describe(
            'soft shadows from meshes with `castShadow` onto those with `receiveShadow` (none without it)',
          ),
      })
      .exactOptional()
      .describe('the one directional light'),
    ambient: z
      .strictObject({
        color: color.exactOptional().describe('its colour (default white)'),
        intensity: z
          .number()
          .min(0)
          .exactOptional()
          .describe('its strength (default `camera3d.lights.ambient`)'),
      })
      .exactOptional()
      .describe('light from everywhere'),
    hemisphere: z
      .strictObject({
        sky: color.describe('the colour from above'),
        ground: color.describe('the colour from below'),
        intensity: z.number().min(0).exactOptional().describe('its strength (default 1)'),
      })
      .exactOptional()
      .describe('a sky and ground light, added to the ambient (none without it)'),
    fog: z
      .strictObject({
        kind: z.enum(FOG_KINDS).describe('`linear` or `exp2`'),
        color: color.describe('the fog colour (usually the background or the far sky)'),
        near: z
          .number()
          .exactOptional()
          .describe('linear: px behind the z = 0 plane where it starts (default 0)'),
        far: z
          .number()
          .positive()
          .exactOptional()
          .describe('linear: px behind the z = 0 plane where it is full (default 1000)'),
        density: z
          .number()
          .positive()
          .exactOptional()
          .describe('exp2: how thick it is, per px from the camera (default 0.001)'),
      })
      .exactOptional()
      .describe('fog on distant things: parallax planes and layers far behind the blocks'),
    toneMapping: z
      .strictObject({
        kind: z.enum(TONE_MAPPINGS).describe('`aces`, `agx` or `none`'),
        exposure: z.number().positive().exactOptional().describe('exposure (default 1)'),
      })
      .exactOptional()
      .describe('how lit colours map to the screen (default none: colours as written)'),
    colorSpace: z
      .enum(OUTPUT_COLOR_SPACES)
      .exactOptional()
      .describe('the output colour space (default `srgb`)'),
    renderScale: z
      .number()
      .int()
      .min(1)
      .max(MAX_RENDER_SCALE)
      .exactOptional()
      .describe(
        'draw the 3D picture at this many times the picture size (supersampled; the HUD, labels and menus keep their picture-px layout and draw scaled, nearest neighbour): a 320x180 picture at 6 is 1920x1080 (default 1; a page or `screenshot --render-scale` may override it; Engine 0.16 F3)',
      ),
    skirt: z
      .strictObject({
        color: color.describe('its colour (lit as the map is)'),
        margin: z
          .number()
          .int()
          .positive()
          .exactOptional()
          .describe(`px it reaches past each map edge (default ${DEFAULT_SKIRT_MARGIN})`),
      })
      .exactOptional()
      .describe(
        'ground view: a flat ground of this colour under the map reaching past its edges, so a view wider than the map shows ground there, not the background (Engine 0.16 F9)',
      ),
    timeOfDay: timeOfDaySchema
      .exactOptional()
      .describe(
        "keyframes by hour moving the sun, ambient, hemisphere, fog, background and exposure through the day from the frame's world clock (`clock.day`, `clock.fraction`); a jump in world time eases (Engine 0.16 F4; `time-of-day.ts`)",
      ),
  })
  .superRefine((s, ctx) => {
    if (s.fog !== undefined) return;
    s.timeOfDay?.keys.forEach((k, i) => {
      if (k.fog !== undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['timeOfDay', 'keys', i, 'fog'],
          message: "a time-of-day fog needs the skin's own `scene3d.fog` (its kind and default values)",
          params: { code: 'missing_field' },
        });
    });
  });

export type SkinScene3d = z.output<typeof scene3dSchema>;

export const kindLightSchema = z
  .strictObject({
    kind: z.literal('point').describe('a point light (the only kind so far)'),
    color: color.describe('its colour'),
    intensity: z.number().min(0).describe('its strength'),
    distance: z.number().positive().describe('px from the light where it fades to nothing'),
    decay: z.number().min(0).exactOptional().describe('how fast it fades with distance (default 1)'),
    offset: z
      .strictObject({
        x: z.number().describe('px right'),
        y: z.number().describe('px down'),
        z: z.number().describe('px toward the camera'),
      })
      .exactOptional()
      .describe("where it sits from the entity box's centre, in the skin's mesh space (y down; default 0)"),
    flicker: z
      .number()
      .min(0)
      .max(1)
      .exactOptional()
      .describe('how much its strength flickers each frame, 0..1 (presentation RNG; default 0)'),
  })
  .describe('3D: a light that goes with each entity of the kind (a torch, a lamp)');

export type SkinKindLight = z.output<typeof kindLightSchema>;

/** What a label shows. */
export const LABEL_TYPES = ['text', 'bar', 'timer'] as const;

/** Where a label's anchor sits on the entity box. */
export const LABEL_ANCHORS = ['top', 'center', 'bottom'] as const;

export const labelSchema = z.strictObject({
  from: z
    .union([
      z.enum(['id', 'kind']),
      z.strictObject({ tag: z.string().min(1).describe('a tag prefix: the rest of the first tag with it') }),
      z.strictObject({ status: z.string().min(1).describe("a field of the frame's status") }),
    ])
    .exactOptional()
    .describe(
      'the value: `id`, `kind`, `{ tag: "<prefix>" }` (the rest of the first tag with that prefix) or `{ status: "<field>" }`; a text label without it shows its `format`',
    ),
  as: z
    .enum(LABEL_TYPES)
    .describe('`text` (the value), `bar` (a number of `max`) or `timer` (ticks as m:ss)'),
  format: z.string().exactOptional().describe('text and timer: the text, `{value}` replaced by the value'),
  max: z
    .union([z.number().positive(), z.string().min(1)])
    .exactOptional()
    .describe(
      'bar: the full value, a number or a status field (default 100; a tag value `n/m` gives its own)',
    ),
  font: z.string().min(1).exactOptional().describe('text and timer: a font file of the game'),
  color: color.exactOptional().describe('text: the ink (default white); bar: the fill (default green)'),
  shadow: color.exactOptional().describe('text: a one-px drop shadow'),
  outline: color.exactOptional().describe('text: a one-px outline'),
  back: color.exactOptional().describe("bar: the empty part's colour"),
  border: color.exactOptional().describe("bar: a one-px frame's colour"),
  w: z.number().int().min(1).exactOptional().describe('bar: width in picture px (default 16)'),
  h: z.number().int().min(1).exactOptional().describe('bar: height in picture px (default 3)'),
  anchor: z
    .enum(LABEL_ANCHORS)
    .exactOptional()
    .describe(
      'the entity box point the label hangs from: `top` (default, the label sits above it), `center`, `bottom`',
    ),
  offset: z
    .strictObject({ x: z.number().int(), y: z.number().int() })
    .exactOptional()
    .describe('picture px from the anchor (y down; default 0, -2)'),
});

export type SkinLabel = z.output<typeof labelSchema>;

export const labelsSchema = z
  .record(z.string().min(1), z.union([labelSchema, z.array(labelSchema).min(1)]))
  .describe(
    'entity kind -> a label or a list, drawn over each entity (3D: on the HUD layer; 2D from Engine 0.16 F8: over the entities, before the HUD)',
  );

/** The scene look with every default filled in. */
export interface Scene3dLook {
  sun: {
    color: string;
    intensity: number;
    direction: { x: number; y: number; z: number };
    shadow: { mapSize: number; bias: number; radius: number } | null;
  };
  ambient: { color: string; intensity: number };
  hemisphere: { sky: string; ground: string; intensity: number } | null;
  fog:
    | { kind: 'linear'; color: string; near: number; far: number }
    | { kind: 'exp2'; color: string; density: number }
    | null;
  toneMapping: { kind: ToneMappingKind; exposure: number };
  colorSpace: (typeof OUTPUT_COLOR_SPACES)[number];
  /** Drawing-buffer pixels per picture pixel, a whole number (Engine 0.16 F3; default 1). */
  renderScale: number;
}

/**
 * A skin's 3D scene look (Engine 0.16 T12) with every default filled in: `lights` are the
 * `camera3d.lights` intensities ({@link resolveCamera3d}), used where `scene3d` gives none. Pure.
 */
export function resolveScene3d(
  scene: DeepReadonly<SkinScene3d> | undefined,
  lights: { ambient: number; directional: number },
): Scene3dLook {
  const s = scene ?? {};
  const shadow = s.sun?.shadow;
  const fog = s.fog;
  return {
    sun: {
      color: s.sun?.color ?? '#ffffff',
      intensity: s.sun?.intensity ?? lights.directional,
      direction: { ...(s.sun?.direction ?? DEFAULT_SUN_DIRECTION) },
      shadow:
        shadow === undefined
          ? null
          : {
              mapSize: shadow.mapSize ?? DEFAULT_SHADOW.mapSize,
              bias: shadow.bias ?? DEFAULT_SHADOW.bias,
              radius: shadow.radius ?? DEFAULT_SHADOW.radius,
            },
    },
    ambient: { color: s.ambient?.color ?? '#ffffff', intensity: s.ambient?.intensity ?? lights.ambient },
    hemisphere:
      s.hemisphere === undefined
        ? null
        : { sky: s.hemisphere.sky, ground: s.hemisphere.ground, intensity: s.hemisphere.intensity ?? 1 },
    fog:
      fog === undefined
        ? null
        : fog.kind === 'linear'
          ? { kind: 'linear', color: fog.color, near: fog.near ?? 0, far: fog.far ?? 1000 }
          : { kind: 'exp2', color: fog.color, density: fog.density ?? 0.001 },
    toneMapping: { kind: s.toneMapping?.kind ?? 'none', exposure: s.toneMapping?.exposure ?? 1 },
    colorSpace: s.colorSpace ?? 'srgb',
    renderScale: s.renderScale ?? 1,
  };
}

/** The labels a skin gives an entity's kind, as a list (none when it lists none). */
export function skinLabels(
  labels: DeepReadonly<Record<string, SkinLabel | SkinLabel[]>> | undefined,
  kind: string,
): readonly DeepReadonly<SkinLabel>[] {
  if (labels === undefined || !Object.hasOwn(labels, kind)) return [];
  const entry = labels[kind]!;
  return Array.isArray(entry)
    ? (entry as readonly DeepReadonly<SkinLabel>[])
    : [entry as DeepReadonly<SkinLabel>];
}

/**
 * A label's value for an entity: its id or kind, the rest of its first tag with the prefix, or a
 * status field; undefined when there is none (the label hides, unless it is text with a `format`).
 */
export function labelValue(
  label: DeepReadonly<SkinLabel>,
  entity: DeepReadonly<PresentEntity>,
  status: DeepReadonly<PresentFrame['status']>,
): string | number | boolean | undefined {
  const from = label.from;
  if (from === undefined) return undefined;
  if (from === 'id') return entity.id;
  if (from === 'kind') return entity.kind;
  if ('tag' in from) {
    const tag = entity.tags.find((t) => t.startsWith(from.tag));
    return tag === undefined ? undefined : tag.slice(from.tag.length);
  }
  return Object.hasOwn(status, from.status) ? status[from.status] : undefined;
}

/** A bar label's value and full value: a number, or a tag's `n/m` text; null when there is none. */
export function labelBar(
  label: DeepReadonly<SkinLabel>,
  value: string | number | boolean | undefined,
  status: DeepReadonly<PresentFrame['status']>,
): { value: number; max: number } | null {
  let max: number | undefined;
  if (typeof label.max === 'number') max = label.max;
  else if (label.max !== undefined) {
    const m = status[label.max];
    max = typeof m === 'number' ? m : typeof m === 'string' && m.trim() !== '' ? Number(m) : undefined;
  }
  if (typeof value === 'number') return { value, max: max ?? 100 };
  if (typeof value !== 'string') return null;
  const pair = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(value);
  if (pair) return { value: Number(pair[1]), max: max ?? Number(pair[2]) };
  const n = value.trim() === '' ? NaN : Number(value);
  return Number.isFinite(n) ? { value: n, max: max ?? 100 } : null;
}

/** Ticks per second of a timer label (the loop's rate). */
export const LABEL_TICKS_PER_SECOND = 60;

/** Ticks as a timer's text: `m:ss` (seconds rounded up, so 1 tick left shows `0:01`). */
export function timerText(ticks: number): string {
  const secs = Math.max(0, Math.ceil(ticks / LABEL_TICKS_PER_SECOND));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}
