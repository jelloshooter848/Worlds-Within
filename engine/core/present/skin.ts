import { z } from 'zod';
import type { ContentKind, ContentLookup, KindIssue } from '../content/kinds';
import type { FieldPath } from '../content/validate';
import type { DeepReadonly, Facing, PresentEntity } from './types';

/**
 * Skin files (docs/ROADMAP.md, Engine 0.4): one text file per backend that says how each kind of
 * entity, each map tile and each event looks and sounds. A kit names kinds and events; a skin
 * maps them to a game's sprites (2D) or meshes (3D), sounds and effects. No rules live here.
 *
 *   { "backend": "canvas2d",
 *     "sheets": { "sheet": "demo-hero", "fallbackColor": "#00a800" },
 *     "kinds": { "hero": { "frames": { "walk": { "down": { "frames": ["down-0", "down-1"], "ticks": 8 } } },
 *                          "flipFacing": true } },
 *     "tiles": { "#": { "sheet": "walls", "frame": "wall", "fallbackColor": "#7c7c7c" } },
 *     "events": { "hit": { "sound": "hurt", "effect": { "kind": "flash", "color": "#fcfcfc" } } },
 *     "hud": [{ "status": "health", "as": "hearts", "x": 8, "y": 8, "frame": "heart" }] }
 *
 * The backend decides the entry shape: a 3D backend (`three`, see {@link MESH_BACKENDS}) takes
 * mesh entries (`mesh`, `color`, `scale?`), every other backend sprite entries (`sheet`, `frames`,
 * `fallbackColor`, ...). Both shapes share one field list, so 0.6 adds meshes without a format
 * break, and a field of the other shape is an error at that field.
 *
 * Cross-file checks (`SKIN_KIND.checkAll`): every sheet, palette and sound a skin names must be a
 * sprite, palette, song or sfx of the game (`missing_ref`), and every frame a frame of its sheet
 * (`missing_frame`).
 */

/** Backends whose skins hold meshes; every other backend's skin holds sprites. */
export const MESH_BACKENDS: readonly string[] = ['three'];

/** The colour a backend draws a box in when a kind has no skin entry and the skin gives none. */
export const DEFAULT_FALLBACK_COLOR = '#ff00ff';

/** Ticks a frame of a cycle shows when the cycle gives no `ticks`. */
export const DEFAULT_FRAME_TICKS = 8;

const FACINGS: readonly Facing[] = ['up', 'down', 'left', 'right'];

const color = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  message: 'a colour is "#rgb" or "#rrggbb"',
});
const id = z.string().min(1);

const cycle = z.strictObject({
  frames: z.array(id).min(1).describe('the frame names, shown in turn'),
  ticks: z
    .number()
    .int()
    .min(1)
    .exactOptional()
    .describe(`ticks each frame shows (default ${DEFAULT_FRAME_TICKS})`),
  loop: z
    .boolean()
    .exactOptional()
    .describe('start again after the last frame (default true); false holds it'),
});

/** One frame name, or a cycle of frames. */
const oneOrCycle = z.union([id, cycle]);

const facingFrames = Object.fromEntries(
  FACINGS.map((f) => [f, oneOrCycle.exactOptional().describe(`the frame or cycle when facing ${f}`)]),
) as Record<Facing, z.ZodExactOptional<typeof oneOrCycle>>;

/** An animation state's frames: a frame name, a cycle, or a frame or cycle per facing. */
const stateFrames = z.union([
  id,
  z
    .strictObject({
      frames: cycle.shape.frames.exactOptional(),
      ticks: cycle.shape.ticks,
      loop: cycle.shape.loop,
      ...facingFrames,
    })
    .superRefine((v, ctx) => {
      const facings = FACINGS.filter((f) => v[f] !== undefined);
      if (v.frames === undefined && facings.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'give "frames" (a cycle) or a frame per facing' });
      }
      if (v.frames !== undefined && facings.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: [facings[0]!],
          message: 'a state has either "frames" (a cycle) or a frame per facing, not both',
        });
      }
      if (v.frames === undefined) {
        for (const key of ['ticks', 'loop'] as const) {
          if (v[key] !== undefined) {
            ctx.addIssue({ code: 'custom', path: [key], message: `"${key}" goes with "frames"` });
          }
        }
      }
    }),
]);

const offset = z
  .strictObject({ x: z.number().int().describe('pixels right'), y: z.number().int().describe('pixels down') })
  .describe("where the sprite or mesh sits from the entity box's top-left corner");

/** Fields only a sprite (2D) entry has, and only a mesh (3D) entry has. */
const SPRITE_FIELDS = ['sheet', 'palette', 'frames', 'flipFacing', 'size', 'fallbackColor'] as const;
const MESH_FIELDS = ['mesh', 'color', 'scale'] as const;

const kindEntry = z.strictObject({
  sheet: id.exactOptional().describe('2D: the sprite file the frames are in (default `sheets.sheet`)'),
  palette: id.exactOptional().describe("2D: a palette to draw with instead of the sprite's own"),
  frames: z
    .record(id, stateFrames)
    .exactOptional()
    .describe(
      '2D: animation state -> a frame name, `{ frames, ticks?, loop? }` (a cycle) or `{ up?, down?, left?, right? }` (a frame or cycle per facing); `idle` is used for a state not listed',
    ),
  flipFacing: z
    .boolean()
    .exactOptional()
    .describe('2D: draw the right-facing frames mirrored when the entity faces left'),
  size: z
    .strictObject({
      w: z.number().int().min(1).describe('width in pixels'),
      h: z.number().int().min(1).describe('height in pixels'),
    })
    .exactOptional()
    .describe('2D: the drawn size, when it is not the frame size'),
  fallbackColor: color
    .exactOptional()
    .describe('2D: the box colour when a frame is missing (default `sheets.fallbackColor`)'),
  mesh: id.exactOptional().describe('3D: a mesh id or a primitive (`box`, `sphere`...)'),
  color: color.exactOptional().describe("3D: the mesh's colour"),
  scale: z.number().positive().exactOptional().describe('3D: size factor (default 1)'),
  offset: offset.exactOptional(),
});

const tileEntry = z.strictObject({
  sheet: id.exactOptional().describe('2D: the sprite file (default `sheets.sheet`)'),
  frame: id.exactOptional().describe('2D: the frame name in the sheet'),
  fallbackColor: color
    .exactOptional()
    .describe('2D: the colour when the frame is missing (default `sheets.fallbackColor`)'),
  mesh: id.exactOptional().describe('3D: a mesh id or primitive'),
  color: color.exactOptional().describe("3D: the mesh's colour"),
});

const effect = z.strictObject({
  kind: z.enum(['flash', 'particles', 'shake', 'tint']).describe('what the backend shows'),
  color: color.exactOptional().describe('its colour'),
  ticks: z.number().int().min(1).exactOptional().describe('how long it lasts'),
  count: z.number().int().min(1).exactOptional().describe('particles: how many'),
  size: z.number().positive().exactOptional().describe('particles: size in pixels; shake: strength'),
});

const eventEntry = z.strictObject({
  sound: id.exactOptional().describe('a song or sfx id to play'),
  effect: effect.exactOptional().describe('a presentation-only effect at the event'),
});

const hudItem = z
  .strictObject({
    status: id.describe('the status key it shows (`health`, `score`)'),
    as: z.enum(['hearts', 'number', 'text', 'icon']).describe('how it shows'),
    x: z.number().int().describe('left edge, screen pixels'),
    y: z.number().int().describe('top edge, screen pixels'),
    sheet: id.exactOptional().describe('the sprite file for hearts and icons (default `sheets.sheet`)'),
    frame: id.exactOptional().describe('the frame for hearts and icons'),
    font: id.exactOptional().describe('the font for numbers and text'),
  })
  .superRefine((v, ctx) => {
    if ((v.as === 'hearts' || v.as === 'icon') && v.frame === undefined) {
      ctx.addIssue({ code: 'custom', path: ['frame'], message: `"${v.as}" needs a frame` });
    }
  });

const camera = z.strictObject({
  zoom: z.number().positive().exactOptional().describe('scale factor (default 1)'),
  follow: id.exactOptional().describe('the entity kind or id to keep in view'),
  deadzone: z
    .strictObject({
      w: z.number().int().min(0).describe('width in pixels'),
      h: z.number().int().min(0).describe('height in pixels'),
    })
    .exactOptional()
    .describe('a box round the screen centre the followed entity moves in freely'),
  lerp: z
    .number()
    .min(0)
    .max(1)
    .exactOptional()
    .describe('how far the camera closes the gap each frame (1 snaps)'),
});

const sheets = z.strictObject({
  sheet: id.exactOptional().describe('the sprite file for entries that name none'),
  palette: id.exactOptional().describe('the palette for entries that name none'),
  fallbackColor: color.exactOptional().describe('the box colour for entries that give none'),
});

/** Problems when entries hold fields of the other backend's shape, or lack ones theirs needs. */
function checkShapes(
  backend: string,
  defaults: z.output<typeof sheets> | undefined,
  entries: Record<string, Record<string, unknown>>,
  where: string,
  needs2d: readonly string[],
  ctx: z.RefinementCtx,
): void {
  const mesh = MESH_BACKENDS.includes(backend);
  const wrong: readonly string[] = mesh ? SPRITE_FIELDS : MESH_FIELDS;
  const needs = mesh ? ['mesh', 'color'] : needs2d;
  for (const [key, entry] of Object.entries(entries)) {
    for (const field of wrong) {
      if (entry[field] === undefined) continue;
      const msg = `"${field}" is a ${mesh ? '2D' : '3D'} field; backend "${backend}" takes ${mesh ? 'meshes' : 'sprites'}`;
      ctx.addIssue({
        code: 'custom',
        path: [where, key, field],
        message: msg,
        params: { code: 'wrong_backend_field' },
      });
    }
    for (const field of needs) {
      const fromDefault = (field === 'sheet' || field === 'fallbackColor') && defaults?.[field] !== undefined;
      if (entry[field] !== undefined || fromDefault) continue;
      ctx.addIssue({
        code: 'custom',
        path: [where, key, field],
        message: `needs "${field}"${field === 'sheet' || field === 'fallbackColor' ? ` (or sheets.${field})` : ''}`,
        params: { code: 'missing_field' },
      });
    }
  }
}

export const skinSchema = z
  .strictObject({
    backend: id.describe('the backend it is for: `canvas2d`, `three` (meshes) or another backend name'),
    sheets: sheets.exactOptional().describe('defaults for entries that leave a field out'),
    kinds: z.record(id, kindEntry).describe('entity kind -> how it looks'),
    tiles: z.record(id, tileEntry).exactOptional().describe('map tile character or id -> how it looks'),
    events: z.record(id, eventEntry).exactOptional().describe('event type -> its sound and effect'),
    hud: z.array(hudItem).exactOptional().describe('status values drawn on screen, in order'),
    camera: camera.exactOptional().describe("framing defaults; a frame's own camera hint wins"),
  })
  .superRefine((skin, ctx) => {
    checkShapes(skin.backend, skin.sheets, skin.kinds, 'kinds', ['sheet', 'frames', 'fallbackColor'], ctx);
    checkShapes(
      skin.backend,
      skin.sheets,
      skin.tiles ?? {},
      'tiles',
      ['sheet', 'frame', 'fallbackColor'],
      ctx,
    );
  });

export type SkinFile = z.output<typeof skinSchema>;
export type SkinKindEntry = z.output<typeof kindEntry>;
export type SkinStateFrames = z.output<typeof stateFrames>;
export type SkinCycle = z.output<typeof cycle>;

// ---- Cross-file checks ----

/** A frame name a skin uses, and its path inside the entry that names it. */
interface NamedFrame {
  frame: string;
  path: FieldPath;
}

/** Every sprite, palette and sound a skin names that the game lacks, and every frame its sheet lacks. */
export function checkSkinRefs(name: string, skin: SkinFile, others: ContentLookup): KindIssue[] {
  const issues: KindIssue[] = [];
  const sprites = new Map(
    others('sprite').map((e) => [e.name, e.value as { frames?: Record<string, unknown> }]),
  );
  const palettes = new Set(others('palette').map((e) => e.name));
  const sounds = new Set([...others('song'), ...others('sfx')].map((e) => e.name));
  const missing = (path: FieldPath, what: string, ref: string) =>
    issues.push({ name, path, code: 'missing_ref', message: `no ${what} "${ref}" in the game` });

  /** A sheet named at `path` (or the default sheet) and the frames, `{ frame, path }`, used from it. */
  const sheetAt = (path: FieldPath, sheet: string | undefined, frames: readonly NamedFrame[]) => {
    const used = sheet ?? skin.sheets?.sheet;
    if (used === undefined) return;
    const sprite = sprites.get(used);
    if (!sprite) {
      if (sheet !== undefined) missing([...path, 'sheet'], 'sprite', sheet);
      return;
    }
    for (const f of frames) {
      if (sprite.frames && !Object.hasOwn(sprite.frames, f.frame)) {
        const message = `sprite "${used}" has no frame "${f.frame}"`;
        issues.push({ name, path: [...path, ...f.path], code: 'missing_frame', message });
      }
    }
  };
  const one = (frame: string | undefined): NamedFrame[] =>
    frame === undefined ? [] : [{ frame, path: ['frame'] }];

  if (skin.sheets?.sheet !== undefined && !sprites.has(skin.sheets.sheet)) {
    missing(['sheets', 'sheet'], 'sprite', skin.sheets.sheet);
  }
  if (skin.sheets?.palette !== undefined && !palettes.has(skin.sheets.palette)) {
    missing(['sheets', 'palette'], 'palette', skin.sheets.palette);
  }
  for (const [kind, entry] of Object.entries(skin.kinds)) {
    if (entry.palette !== undefined && !palettes.has(entry.palette)) {
      missing(['kinds', kind, 'palette'], 'palette', entry.palette);
    }
    if (entry.mesh === undefined) sheetAt(['kinds', kind], entry.sheet, framesOf(entry.frames ?? {}));
  }
  for (const [tile, entry] of Object.entries(skin.tiles ?? {})) {
    if (entry.mesh === undefined) sheetAt(['tiles', tile], entry.sheet, one(entry.frame));
  }
  for (const [type, entry] of Object.entries(skin.events ?? {})) {
    if (entry.sound !== undefined && !sounds.has(entry.sound)) {
      missing(['events', type, 'sound'], 'song or sfx', entry.sound);
    }
  }
  (skin.hud ?? []).forEach((item, i) => sheetAt(['hud', i], item.sheet, one(item.frame)));
  return issues;
}

/** Every frame name in an entry's `frames`, with its path inside the entry. */
function framesOf(frames: Record<string, SkinStateFrames>): NamedFrame[] {
  const out: NamedFrame[] = [];
  const add = (spec: string | SkinCycle, path: FieldPath) => {
    if (typeof spec === 'string') out.push({ frame: spec, path });
    else spec.frames.forEach((f, i) => out.push({ frame: f, path: [...path, 'frames', i] }));
  };
  for (const [state, spec] of Object.entries(frames)) {
    const at: FieldPath = ['frames', state];
    if (typeof spec === 'string') add(spec, at);
    else if (spec.frames !== undefined) add({ frames: spec.frames }, at);
    else for (const f of FACINGS) if (spec[f] !== undefined) add(spec[f], [...at, f]);
  }
  return out;
}

/** The `skin` content kind: a per-backend skin, JSON. */
export const SKIN_KIND = {
  name: 'skin',
  description:
    'How a backend shows a game: each kind as a sprite or mesh, tiles, event sounds and effects, the HUD',
  schema: skinSchema,
  checkAll: (entries, others) => entries.flatMap((e) => checkSkinRefs(e.name, e.value, others)),
} satisfies ContentKind<typeof skinSchema>;

// ---- Picking a frame ----

/** What to draw for one entity: a sprite frame, or (when `frame` is null) a box of `fallbackColor`. */
export interface SkinFrame {
  /** The sprite file, or null when there is nothing to draw from. */
  sheet: string | null;
  /** The frame name in `sheet`, or null: draw a `fallbackColor` box. */
  frame: string | null;
  /** Draw mirrored left to right. */
  flipX: boolean;
  palette?: string;
  fallbackColor: string;
  size?: { w: number; h: number };
  offset?: { x: number; y: number };
}

/** The frame of a cycle at tick `t`. */
function cycleFrame(spec: string | DeepReadonly<SkinCycle>, t: number): string {
  if (typeof spec === 'string') return spec;
  const step = Math.floor(t / (spec.ticks ?? DEFAULT_FRAME_TICKS));
  const n = spec.frames.length;
  return spec.frames[spec.loop === false ? Math.min(step, n - 1) : step % n]!;
}

/**
 * The frame to draw for `entity` with `skin`: its kind's entry, the frames of its animation state
 * (`idle` when the state is not listed, else the first state), the frame of a cycle at `anim.t`,
 * and the facing's frame. A left-facing entity with no `left` frame uses `right` mirrored when the
 * entry sets `flipFacing`; a state without a frame for the facing uses `down`, then the first
 * given. A kind the skin does not list, or a mesh entry, gives a `fallbackColor` box. Pure.
 */
export function resolveSkinFrame(
  skin: DeepReadonly<SkinFile>,
  entity: Pick<DeepReadonly<PresentEntity>, 'kind' | 'facing' | 'anim'>,
): SkinFrame {
  const defaults = skin.sheets;
  const entry = Object.hasOwn(skin.kinds, entity.kind) ? skin.kinds[entity.kind] : undefined;
  const fallbackColor =
    entry?.fallbackColor ?? entry?.color ?? defaults?.fallbackColor ?? DEFAULT_FALLBACK_COLOR;
  const sheet = entry?.sheet ?? defaults?.sheet ?? null;
  const out: SkinFrame = { sheet, frame: null, flipX: false, fallbackColor };
  if (!entry || entry.mesh !== undefined || sheet === null) return out;
  const palette = entry.palette ?? defaults?.palette;
  if (palette !== undefined) out.palette = palette;
  if (entry.size) out.size = { ...entry.size };
  if (entry.offset) out.offset = { ...entry.offset };

  const frames = entry.frames ?? {};
  const states = Object.keys(frames);
  const state = Object.hasOwn(frames, entity.anim.state)
    ? entity.anim.state
    : 'idle' in frames
      ? 'idle'
      : states[0];
  if (state === undefined) return out;
  const spec = frames[state]!;
  const flipFacing = entry.flipFacing === true;
  if (typeof spec === 'string' || spec.frames !== undefined) {
    out.frame =
      typeof spec === 'string' ? spec : cycleFrame({ ...spec, frames: spec.frames! }, entity.anim.t);
    out.flipX = flipFacing && entity.facing === 'left';
    return out;
  }
  let facing: Facing | undefined = entity.facing;
  if (spec[facing] === undefined) {
    if (facing === 'left' && flipFacing && spec.right !== undefined) {
      facing = 'right';
      out.flipX = true;
    } else facing = spec.down !== undefined ? 'down' : FACINGS.find((f) => spec[f] !== undefined);
  }
  if (facing !== undefined) out.frame = cycleFrame(spec[facing]!, entity.anim.t);
  return out;
}
