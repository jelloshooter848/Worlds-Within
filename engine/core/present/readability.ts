import { z } from 'zod';

/**
 * Readable at every zoom (Engine 0.16 part D, D4): three 2D kind fields that keep units and their
 * marks legible when the RTS camera zooms from 0.5 to 2, and the pure readings the 2D draw walk
 * (`engine/core/draw`) uses. All three default off, so a skin without them draws as before.
 *
 * - `outline`: a one-picture-pixel outline round the sprite's opaque pixels (its alpha), in a
 *   colour or `"team"` (the entity's team colour). A box (no frame) gets a box one pixel larger.
 * - `team`: one sprite for every side. The entity's tag `<prefix><name>` (default prefix
 *   `faction:`) picks a colour from `colors`; the sprite's pixels of the `mask` colour, or with a
 *   hue in the `hue` range, take it (keeping their lightness in the hue case), or with neither the
 *   whole sprite is tinted (multiplied) by it. A box is filled with the team colour.
 * - `screenScale`: the drawn scale is the camera's zoom held between `min` and `max`, about the
 *   box's `anchor` point (default its centre), so a health bar, selection ring or order marker keeps
 *   a minimum on-screen size when zoomed out and does not balloon when zoomed in. `{ min: 1, max:
 *   1 }` is fully zoom-stable.
 */

const color = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  message: 'a colour is "#rgb" or "#rrggbb"',
});

/** The tag prefix a `team` reads when it gives none. */
export const DEFAULT_TEAM_PREFIX = 'faction:';

/** The outline value that means "the entity's team colour". */
export const OUTLINE_TEAM = 'team';

/** Where a `screenScale` look is scaled about (a point of the entity box). */
export const SCREEN_SCALE_ANCHORS = ['center', 'top', 'bottom'] as const;
export type ScreenScaleAnchor = (typeof SCREEN_SCALE_ANCHORS)[number];

export const outlineSchema = z
  .union([color, z.literal(OUTLINE_TEAM)])
  .describe(
    "2D: a one-pixel outline round the sprite's opaque pixels (or round a box), in this colour or `\"team\"` (the entity's team colour from the kind's `team`; none without one) (Engine 0.16 part D)",
  );

export const teamSchema = z
  .strictObject({
    prefix: z
      .string()
      .exactOptional()
      .describe(
        `the entity tag prefix naming its team (default \`${DEFAULT_TEAM_PREFIX}\`: \`faction:blue\`; \`""\` reads whole tags, such as the RTS kit's \`own\` and \`enemy\`)`,
      ),
    colors: z
      .record(z.string().min(1), color)
      .refine((c) => Object.keys(c).length > 0, { message: 'give at least one team colour' })
      .describe('team name (the rest of the tag) -> its colour'),
    mask: color.exactOptional().describe("the sprite's pixels of exactly this colour take the team colour"),
    hue: z
      .strictObject({
        min: z.number().min(0).max(360).describe('the lowest hue, degrees'),
        max: z
          .number()
          .min(0)
          .max(360)
          .describe('the highest hue, degrees (below `min` wraps through red: 330 to 30)'),
      })
      .exactOptional()
      .describe(
        "the sprite's coloured (not grey) pixels with a hue in this range take the team colour's hue and saturation, keeping their lightness",
      ),
  })
  .superRefine((v, ctx) => {
    if (v.mask !== undefined && v.hue !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['hue'],
        message: 'give at most one of "mask" and "hue" (neither tints the whole sprite)',
        params: { code: 'bad_team' },
      });
    }
  })
  .describe(
    "2D: team colours for one sprite on every side (Engine 0.16 part D): `{ prefix?, colors, mask? | hue? }`; the entity's `<prefix><name>` tag picks the colour, recolouring the `mask` colour or the `hue` range, else tinting the whole sprite; a box is filled with it. Recoloured once per sheet and colour, then cached",
  );

export const screenScaleSchema = z
  .strictObject({
    min: z
      .number()
      .positive()
      .exactOptional()
      .describe('the smallest drawn scale: zoomed out further, the look stays this size on screen'),
    max: z
      .number()
      .positive()
      .exactOptional()
      .describe('the largest drawn scale: zoomed in further, the look stays this size on screen'),
    anchor: z
      .enum(SCREEN_SCALE_ANCHORS)
      .exactOptional()
      .describe('the point of the entity box that stays put on the world (default `center`)'),
  })
  .superRefine((v, ctx) => {
    if (v.min !== undefined && v.max !== undefined && v.min > v.max) {
      ctx.addIssue({
        code: 'custom',
        path: ['max'],
        message: `"max" ${v.max} is below "min" ${v.min}`,
        params: { code: 'bad_range' },
      });
    }
  })
  .describe(
    "2D: zoom-stable looks (Engine 0.16 part D): the drawn scale is the camera zoom held between `min` and `max` (`{ min: 1, max: 1 }`: always one picture pixel per sprite pixel), about the box's `anchor`; for health bars, selection rings and order markers",
  );

export type SkinOutline = z.output<typeof outlineSchema>;
export type SkinTeam = z.output<typeof teamSchema>;
export type SkinScreenScale = z.output<typeof screenScaleSchema>;

/** What `team`, `outline` and `screenScale` read from a kind entry. */
export interface ReadableEntry {
  readonly outline?: SkinOutline;
  readonly team?: {
    readonly prefix?: string;
    readonly colors: { readonly [name: string]: string };
    readonly mask?: string;
    readonly hue?: { readonly min: number; readonly max: number };
  };
  readonly screenScale?: {
    readonly min?: number;
    readonly max?: number;
    readonly anchor?: ScreenScaleAnchor;
  };
}

/**
 * The team colour of an entity with `tags` under `entry.team`: the colour of the first tag (in the
 * entity's order) `<prefix><name>` whose name `colors` lists, or null (no `team`, no such tag).
 */
export function skinTeamColor(
  entry: ReadableEntry | undefined,
  tags: readonly string[] | undefined,
): string | null {
  const team = entry?.team;
  if (team === undefined || tags === undefined) return null;
  const prefix = team.prefix ?? DEFAULT_TEAM_PREFIX;
  for (const tag of tags) {
    if (!tag.startsWith(prefix)) continue;
    const name = tag.slice(prefix.length);
    if (Object.hasOwn(team.colors, name)) return team.colors[name]!;
  }
  return null;
}

/** The outline colour of an entity: the entry's `outline`, its team colour for `"team"`, or null. */
export function skinOutlineColor(
  entry: ReadableEntry | undefined,
  tags: readonly string[] | undefined,
): string | null {
  const outline = entry?.outline;
  if (outline === undefined) return null;
  return outline === OUTLINE_TEAM ? skinTeamColor(entry, tags) : outline;
}

/** The scale a look is drawn at for a camera `zoom`: the zoom, held inside `screenScale`'s range. */
export function screenScaleAt(spec: ReadableEntry['screenScale'], zoom: number): number {
  if (spec === undefined) return zoom;
  let s = zoom;
  if (spec.min !== undefined) s = Math.max(s, spec.min);
  if (spec.max !== undefined) s = Math.min(s, spec.max);
  return s;
}

/** The world point of a box a `screenScale` look keeps in place. */
export function screenScalePivot(
  anchor: ScreenScaleAnchor | undefined,
  box: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
  const x = box.x + box.w / 2;
  if (anchor === 'top') return { x, y: box.y };
  if (anchor === 'bottom') return { x, y: box.y + box.h };
  return { x, y: box.y + box.h / 2 };
}
