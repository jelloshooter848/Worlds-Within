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
 * mesh entries (`mesh`, `color`, `scale?`, `depth?`, `z?`), every other backend sprite entries
 * (`sheet`, `frames`, `fallbackColor`, ...). Both shapes share one field list, so 0.6 added meshes
 * without a format break, and a field of the other shape is an error at that field.
 *
 * A 3D skin (Engine 0.6) describes every mesh as text, low-poly and procedural:
 *
 *   { "backend": "three",
 *     "meshes": { "hero": [{ "shape": "box", "size": { "w": 12, "h": 10, "d": 8 }, "at": { "x": 2, "y": 6, "z": 0 } },
 *                          { "shape": "sphere", "size": { "w": 10, "h": 8, "d": 8 }, "at": { "x": 3, "y": 0, "z": 0 },
 *                            "color": "#fcbcb0" }] },
 *     "kinds": { "hero": { "mesh": "hero", "color": "#d82800" }, "coin": { "mesh": "cylinder", "color": "#fcfc00", "depth": 4 } },
 *     "tiles": { "#": { "mesh": "box", "color": "#c84c0c" }, "/": { "mesh": "wedge", "color": "#00a800" } },
 *     "camera3d": { "fov": 40, "tilt": 6, "layerDepth": 16, "lights": { "ambient": 0.6, "directional": 0.8 } } }
 *
 * A `mesh` names a primitive ({@link MESH_PRIMITIVES}), which fills the entity box (or the tile)
 * and is `depth` px thick (default: as deep as the box is wide, so a tile is a cube-shaped block),
 * or a key of `meshes`, a compound mesh: a list of primitive parts, sized and placed in world px.
 * Local space is world px with x right, y down (as in 2D) and z toward the camera; a part's `at`
 * is its top-left corner in x and y from the entity box's top-left, and its centre in z from the
 * entity's depth plane. {@link resolveMeshParts} is the one reading of this text that backends and
 * tests share. `camera3d` gives the 3D framing defaults ({@link DEFAULT_CAMERA3D}).
 *
 * Checks: every `mesh` must be a primitive or a key of `meshes` (`missing_ref`, in the skin
 * itself). Cross-file (`SKIN_KIND.checkAll`): every sheet, palette and sound a skin names must be a
 * sprite, palette, song or sfx of the game (`missing_ref`), and every frame a frame of its sheet
 * (`missing_frame`).
 */

/** Backends whose skins hold meshes; every other backend's skin holds sprites. */
export const MESH_BACKENDS: readonly string[] = ['three'];

/**
 * The shapes a mesh is built from, sized by a `{ w, h, d }` box in world px (before `rotate`):
 * - `box`: fills the box.
 * - `wedge`: a slope; its side profile (x-y) rises from nothing at the left to full height at the
 *   right, through the full depth.
 * - `cylinder`, `cone`: upright (along y), with an elliptic base of w x d; a cone's tip is at the top.
 * - `sphere`: an ellipsoid filling the box.
 * - `plane`: a flat w x h face toward the camera at the box's middle depth (`d` is ignored).
 * Round shapes use {@link LOW_POLY_SEGMENTS}, so every backend draws the same low-poly shape.
 */
export const MESH_PRIMITIVES = ['box', 'wedge', 'cylinder', 'cone', 'sphere', 'plane'] as const;
export type MeshPrimitive = (typeof MESH_PRIMITIVES)[number];

/** Segment counts for round primitives: around a cylinder, cone or sphere, and a sphere's rings. */
export const LOW_POLY_SEGMENTS = { radial: 8, rings: 6 } as const;

/** 3D framing defaults, used for every field a skin's `camera3d` leaves out. */
export const DEFAULT_CAMERA3D = {
  fov: 45,
  tilt: 0,
  layerDepth: 16,
  lights: { ambient: 0.6, directional: 0.8 },
} as const;

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
const SPRITE_FIELDS = ['sheet', 'palette', 'frames', 'flipFacing', 'size', 'fallbackColor', 'frame'] as const;
const MESH_FIELDS = ['mesh', 'color', 'scale', 'depth', 'z'] as const;
/** Skin-level fields only a 3D skin has. */
const MESH_SKIN_FIELDS = ['meshes', 'camera3d'] as const;

const meshRef = id.describe(
  `3D: a primitive (${MESH_PRIMITIVES.map((p) => `\`${p}\``).join(', ')}) or a key of \`meshes\``,
);
const depth = z
  .number()
  .positive()
  .exactOptional()
  .describe("3D: a primitive mesh's thickness in px (default: the box's width; a tile is one tile deep)");
const zOffset = z
  .number()
  .exactOptional()
  .describe('3D: px toward the camera from the depth plane (default 0)');

const meshPart = z.strictObject({
  shape: z.enum(MESH_PRIMITIVES).describe('the primitive'),
  size: z
    .strictObject({
      w: z.number().positive().describe('width (x) in px'),
      h: z.number().positive().describe('height (y) in px'),
      d: z.number().positive().describe('depth (z) in px'),
    })
    .describe('its box before `rotate`'),
  at: z
    .strictObject({
      x: z.number().describe('px right of the entity box left edge, to the part left edge'),
      y: z.number().describe('px down from the entity box top, to the part top'),
      z: z.number().describe("px toward the camera from the depth plane, to the part's centre"),
    })
    .exactOptional()
    .describe('where it sits (default all 0)'),
  color: color.exactOptional().describe("its colour (default the entry's `color`)"),
  rotate: z
    .number()
    .int()
    .min(0)
    .max(3)
    .exactOptional()
    .describe('quarter turns about the upright (y) axis through its centre (default 0)'),
});

const camera3d = z.strictObject({
  fov: z
    .number()
    .min(1)
    .max(179)
    .exactOptional()
    .describe(`vertical field of view, degrees (default ${DEFAULT_CAMERA3D.fov})`),
  tilt: z
    .number()
    .min(-45)
    .max(45)
    .exactOptional()
    .describe(`pitch, degrees; positive looks down a little (default ${DEFAULT_CAMERA3D.tilt})`),
  layerDepth: z
    .number()
    .min(0)
    .exactOptional()
    .describe(`px toward the camera per entity \`layer\` (default ${DEFAULT_CAMERA3D.layerDepth})`),
  lights: z
    .strictObject({
      ambient: z
        .number()
        .min(0)
        .exactOptional()
        .describe(`ambient light intensity (default ${DEFAULT_CAMERA3D.lights.ambient})`),
      directional: z
        .number()
        .min(0)
        .exactOptional()
        .describe(`the one directional light's intensity (default ${DEFAULT_CAMERA3D.lights.directional})`),
    })
    .exactOptional()
    .describe('kept minimal: ambient plus one directional light'),
});

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
  mesh: meshRef.exactOptional(),
  color: color.exactOptional().describe("3D: the mesh's colour"),
  scale: z
    .number()
    .positive()
    .exactOptional()
    .describe("3D: size factor about the box's bottom centre (default 1)"),
  depth,
  z: zOffset,
  offset: offset.exactOptional(),
});

const tileEntry = z.strictObject({
  sheet: id.exactOptional().describe('2D: the sprite file (default `sheets.sheet`)'),
  frame: id.exactOptional().describe('2D: the frame name in the sheet'),
  fallbackColor: color
    .exactOptional()
    .describe('2D: the colour when the frame is missing (default `sheets.fallbackColor`)'),
  mesh: meshRef.exactOptional(),
  color: color.exactOptional().describe("3D: the mesh's colour"),
  depth,
  z: zOffset,
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

/** 3D-only skin fields on a 2D skin, mesh ids that name nothing, and meshes that shadow a primitive. */
function checkMeshes(
  skin: {
    backend: string;
    kinds: Record<string, { mesh?: string }>;
    tiles?: Record<string, { mesh?: string }>;
    meshes?: Record<string, unknown>;
    camera3d?: unknown;
  },
  ctx: z.RefinementCtx,
): void {
  if (!MESH_BACKENDS.includes(skin.backend)) {
    for (const field of MESH_SKIN_FIELDS) {
      if (skin[field] === undefined) continue;
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: `"${field}" is a 3D field; backend "${skin.backend}" takes sprites`,
        params: { code: 'wrong_backend_field' },
      });
    }
    return;
  }
  const meshes = skin.meshes ?? {};
  for (const name of Object.keys(meshes)) {
    if (isPrimitive(name)) {
      ctx.addIssue({ code: 'custom', path: ['meshes', name], message: `"${name}" is a primitive's name` });
    }
  }
  for (const where of ['kinds', 'tiles'] as const) {
    for (const [key, entry] of Object.entries(skin[where] ?? {})) {
      if (entry.mesh === undefined || isPrimitive(entry.mesh) || Object.hasOwn(meshes, entry.mesh)) continue;
      ctx.addIssue({
        code: 'custom',
        path: [where, key, 'mesh'],
        message: `no primitive or mesh "${entry.mesh}" (primitives: ${MESH_PRIMITIVES.join(', ')})`,
        params: { code: 'missing_ref' },
      });
    }
  }
}

function isPrimitive(name: string): name is MeshPrimitive {
  return (MESH_PRIMITIVES as readonly string[]).includes(name);
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
    meshes: z
      .record(id, z.array(meshPart).min(1))
      .exactOptional()
      .describe('3D: named compound meshes, each a list of primitive parts in world px'),
    camera3d: camera3d.exactOptional().describe('3D: perspective framing and light defaults'),
  })
  .superRefine((skin, ctx) => {
    checkMeshes(skin, ctx);
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
export type SkinTileEntry = z.output<typeof tileEntry>;
export type SkinMeshPart = z.output<typeof meshPart>;
export type SkinCamera3d = z.output<typeof camera3d>;

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

// ---- Reading meshes ----

/** One primitive of a mesh, ready to build: everything resolved, in world px. */
export interface MeshPart {
  shape: MeshPrimitive;
  /** Its box before `rotate`. */
  size: { w: number; h: number; d: number };
  /** Its top-left corner in x and y from the entity box's top-left, its centre in z from the depth plane. */
  at: { x: number; y: number; z: number };
  color: string;
  /** Quarter turns about the upright (y) axis through its centre, 0 to 3. */
  rotate: number;
}

/**
 * The parts to build for a kind's or tile's mesh entry, in world px from the entity box's top-left
 * (x right, y down) and its depth plane (z toward the camera). `box` is the entity box or the tile
 * (`{ w: tileSize, h: tileSize }`). A primitive is one part filling `box`, `depth` px thick
 * (default `box.w`); a compound mesh is its parts as written, each defaulting to the entry's
 * colour. `scale` then grows every part about the box's bottom centre (so feet stay on the
 * ground), and `offset` and `z` move the whole mesh. An entry with no `mesh` (a sprite entry), or
 * a mesh id the skin lacks, gives no parts. Pure.
 */
export function resolveMeshParts(
  skin: DeepReadonly<SkinFile>,
  entry: DeepReadonly<SkinKindEntry | SkinTileEntry>,
  box: { w: number; h: number },
): MeshPart[] {
  const name = entry.mesh;
  if (name === undefined) return [];
  const color = entry.color ?? DEFAULT_FALLBACK_COLOR;
  let parts: MeshPart[];
  if (isPrimitive(name)) {
    const d = entry.depth ?? box.w;
    parts = [{ shape: name, size: { w: box.w, h: box.h, d }, at: { x: 0, y: 0, z: 0 }, color, rotate: 0 }];
  } else if (skin.meshes !== undefined && Object.hasOwn(skin.meshes, name)) {
    parts = skin.meshes[name]!.map((p) => ({
      shape: p.shape,
      size: { ...p.size },
      at: p.at ? { ...p.at } : { x: 0, y: 0, z: 0 },
      color: p.color ?? color,
      rotate: p.rotate ?? 0,
    }));
  } else return [];

  const scale = 'scale' in entry ? (entry.scale ?? 1) : 1;
  const offset = 'offset' in entry ? entry.offset : undefined;
  const dx = offset?.x ?? 0;
  const dy = offset?.y ?? 0;
  const dz = entry.z ?? 0;
  const cx = box.w / 2;
  const cy = box.h;
  return parts.map((p) => ({
    ...p,
    size: { w: p.size.w * scale, h: p.size.h * scale, d: p.size.d * scale },
    at: {
      x: cx + (p.at.x - cx) * scale + dx,
      y: cy + (p.at.y - cy) * scale + dy,
      z: p.at.z * scale + dz,
    },
  }));
}

/** A skin's 3D framing, with {@link DEFAULT_CAMERA3D} for every field it leaves out. Pure. */
export function resolveCamera3d(skin: DeepReadonly<SkinFile>): {
  fov: number;
  tilt: number;
  layerDepth: number;
  lights: { ambient: number; directional: number };
} {
  const c = skin.camera3d;
  const d = DEFAULT_CAMERA3D;
  return {
    fov: c?.fov ?? d.fov,
    tilt: c?.tilt ?? d.tilt,
    layerDepth: c?.layerDepth ?? d.layerDepth,
    lights: {
      ambient: c?.lights?.ambient ?? d.lights.ambient,
      directional: c?.lights?.directional ?? d.lights.directional,
    },
  };
}
