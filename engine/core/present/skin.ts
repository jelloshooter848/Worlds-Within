import { z } from 'zod';
import type { ContentKind, ContentLookup, KindIssue } from '../content/kinds';
import type { FieldPath } from '../content/validate';
import {
  emitterSchema,
  flashSpecSchema,
  lightingSchema,
  hitPauseSpecSchema,
  parallaxLayerSchema,
  shakeSpecSchema,
  tweensSchema,
  zoomSpecSchema,
  type EmitterDef,
  type LightingSpec,
} from '../fx/schema';
import { EASE_NAMES, isEaseName } from '../fx/ease';
import { imageSheetFrames, imageSheetSchema } from '../gfx/image-sheet';
import {
  checkMusicLayers,
  checkSoundRange,
  skinMusicSchema,
  soundVariationFields,
  type SoundCue,
} from '../audio/mix';
import { compileSong, type Song } from '../audio/mml';
import { kindLightSchema, labelsSchema, scene3dSchema, skinLabels } from './scene3d';
import { tileJoinSchema, tileVarySchema } from './tile-join';
import { missingGlyphs, type FontFile } from '../ui/font';
import {
  cardinalFacing,
  FACINGS,
  facesLeft,
  mirrorFacing,
  type DeepReadonly,
  type Facing,
  type PresentEntity,
} from './types';

/**
 * Skin files (docs/ROADMAP.md, Engine 0.4): one text file per backend that says how each kind of
 * entity, each map tile and each event looks and sounds. A kit names kinds and events; a skin
 * maps them to a game's sprites (2D) or meshes (3D), sounds and effects. No rules live here.
 *
 *   { "backend": "canvas2d",
 *     "sheets": { "sheet": "hero", "fallbackColor": "#00a800" },
 *     "kinds": { "hero": { "frames": { "walk": { "down": { "frames": ["down-0", "down-1"], "ticks": 8 } } },
 *                          "flipFacing": true } },
 *     "tiles": { "#": { "sheet": "walls", "frame": "wall", "fallbackColor": "#7c7c7c" } },
 *     "events": { "hit": { "sound": "hurt", "effect": { "kind": "flash", "color": "#fcfcfc" } } },
 *     "hud": [{ "status": "health", "as": "hearts", "x": 8, "y": 8, "frame": "heart" }] }
 *
 * PNG sprite sheets (Engine 0.16 T10): a top-level `images` map names image sheets in the game's
 * `assets/` folder (`imageSheetSchema`, `engine/core/gfx/image-sheet.ts`); an entry naming an
 * image id as its `sheet` uses its frames like a text sprite's.
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
 * An `events` key is an event type, or (Engine 0.11, gap G28) a type with a field match:
 * `mini-game-end:pass` (the event's `result` is `pass`) or `mission-commit:outcome=both-burnt`.
 * {@link resolveSkinEvent} tries the field keys of the event's type in file order, then the bare
 * type, so `"mini-game-end:fail"` and a fallback `"mini-game-end"` can sit side by side.
 *
 * Checks: every `mesh` must be a primitive or a key of `meshes` (`missing_ref`, in the skin
 * itself); every `events` key must have one of those shapes (`bad_event_key`). Cross-file (`SKIN_KIND.checkAll`): every sheet, palette and sound a skin names must be a
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

/** The colour a backend clears to when the skin gives no `background` (gap G36). */
export const DEFAULT_BACKGROUND = '#000';

/** How far a camera's look-ahead closes its gap each frame when the skin gives no `lerp`. */
export const CAMERA_LOOK_AHEAD_LERP = 0.1;

/** Ticks a frame of a cycle shows when the cycle gives no `ticks`. */
export const DEFAULT_FRAME_TICKS = 8;

const color = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  message: 'a colour is "#rgb" or "#rrggbb"',
});
const id = z.string().min(1);

const frameTicks = z
  .union([z.number().int().min(1), z.array(z.number().int().min(1)).min(1)])
  .describe(
    `ticks each frame shows: one number for every frame, or one per frame (default ${DEFAULT_FRAME_TICKS})`,
  );

const cycleSheet = id.describe(
  "2D: the sprite file or image these frames come from (default the entry's `sheet`), so one kind can draw states from several PNG sheets",
);

const cycle = z.strictObject({
  frames: z.array(id).min(1).describe('the frame names, shown in turn'),
  sheet: cycleSheet.exactOptional(),
  ticks: frameTicks.exactOptional(),
  loop: z
    .boolean()
    .exactOptional()
    .describe('start again after the last frame (default true); false plays it once and holds the last'),
  then: id
    .exactOptional()
    .describe('with `loop: false`: the state of the same entry to play once this one has finished'),
  events: z
    .record(z.string(), id)
    .exactOptional()
    .describe(
      'frame index -> a presentation event type sent when that frame starts (`{ "1": "footstep" }`), played through the skin\'s `events` like a kit event',
    ),
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
      sheet: cycle.shape.sheet,
      ticks: cycle.shape.ticks,
      loop: cycle.shape.loop,
      then: cycle.shape.then,
      events: cycle.shape.events,
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
        for (const key of ['sheet', 'ticks', 'loop', 'then', 'events'] as const) {
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
const SPRITE_FIELDS = [
  'sheet',
  'palette',
  'frames',
  'flipFacing',
  'size',
  'fallbackColor',
  'frame',
  'blend',
  'glow',
  'vary',
] as const;
const MESH_FIELDS = [
  'mesh',
  'color',
  'poses',
  'scale',
  'depth',
  'z',
  'model',
  'anchor',
  'rotate',
  'clip',
  'castShadow',
  'receiveShadow',
  'light',
  'tint',
  'stretch',
  'clipHold',
] as const;
/** The model fields that mean nothing without a `model` (Engine 0.16 T11; `tint`, `stretch` part B T10). */
const MODEL_FIELDS = ['anchor', 'rotate', 'clip', 'tint', 'stretch', 'clipHold'] as const;
/** Skin-level fields only a 3D skin has. */
const MESH_SKIN_FIELDS = ['meshes', 'camera3d', 'scene3d', 'labels', 'scenery'] as const;

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

/** Where a model sits on its box when a skin gives no `anchor` (Engine 0.16 T11). */
export const DEFAULT_MODEL_ANCHOR = 'bottom';
/** Ticks per second of a model's animation clips: an entity's `anim.t` / 60 is the clip time. */
export const MODEL_TICKS_PER_SECOND = 60;
/** The named model anchors: the bounding box's bottom centre, its centre, or the model's origin. */
export const MODEL_ANCHORS = ['bottom', 'center', 'origin'] as const;
export type ModelAnchorName = (typeof MODEL_ANCHORS)[number];

const modelPath = z
  .string()
  .regex(/^assets\/[^/]+\/[^/]+(?:\/[^/]+)*\.(?:glb|gltf)$/i, {
    message: 'a glTF model in a pack folder of the game\'s assets: "assets/<pack>/<file>.glb" (or .gltf)',
  })
  .describe(
    "3D: a glTF/GLB model, `assets/<pack>/<file>.glb` or `.gltf` relative to the game folder (Engine 0.16); the entry's `mesh` shows while it loads",
  );
const modelAnchor = z
  .union([
    z.enum(MODEL_ANCHORS),
    z.strictObject({
      x: z.number().describe('model units right'),
      y: z.number().describe('model units up'),
      z: z.number().describe('model units toward the viewer'),
    }),
  ])
  .describe(
    "3D model: the model point put on the box's bottom centre: `bottom` (its bounding box's bottom centre, the default), `center` (its centre, put on the box's centre), `origin` (the model's own origin) or a point `{ x, y, z }` in model units",
  );
const modelRotate = z
  .strictObject({
    x: z.number().exactOptional().describe('degrees about x'),
    y: z.number().exactOptional().describe('degrees about y (upright); 90 turns its front to the right'),
    z: z.number().exactOptional().describe('degrees about z'),
  })
  .describe('3D model: a turn applied before `scale` and `anchor`, in degrees (x, then y, then z)');
const modelTint = color.describe(
  "3D model: a colour multiplied into every material's colour (`#ffffff` changes nothing; Engine 0.16 part B)",
);
const modelStretch = z
  .strictObject({
    x: z
      .number()
      .positive()
      .exactOptional()
      .describe("factor along the model's own x, before `rotate` (default 1)"),
    y: z.number().positive().exactOptional().describe('factor along its y (default 1)'),
    z: z.number().positive().exactOptional().describe('factor along its z (default 1)'),
  })
  .describe(
    '3D model: factors per axis on top of `scale` (a thicker plank, a deeper block; Engine 0.16 part B)',
  );
const castShadow = z
  .boolean()
  .exactOptional()
  .describe(
    "3D: the model (or mesh) casts a shadow when the skin's `scene3d.sun` has a `shadow` (default false)",
  );
const receiveShadow = z
  .boolean()
  .exactOptional()
  .describe(
    "3D: shadows fall on the mesh (or model) when the skin's `scene3d.sun` has a `shadow` (default false)",
  );

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

/**
 * One look of a kind for entities with a tag (Engine 0.11, gaps G13 and G30, item 181): the fields
 * it gives replace the kind's own, the rest come from the kind.
 */
const tagEntry = z
  .strictObject({
    tag: id
      .exactOptional()
      .describe('the whole entity tag it is for (`used`, `look:door`, `site`); or give `prefix`'),
    prefix: id
      .exactOptional()
      .describe(
        'instead of `tag`: any entity tag that starts with it (`progress:`); `min` and `max` read the rest',
      ),
    min: z
      .number()
      .int()
      .exactOptional()
      .describe('with `prefix`: the rest of the tag read as a whole number is at least this'),
    max: z
      .number()
      .int()
      .exactOptional()
      .describe('with `prefix`: the rest of the tag read as a whole number is at most this'),
    sheet: id.exactOptional().describe("2D: the sprite file (default the kind's)"),
    palette: id.exactOptional().describe("2D: a palette to draw with (default the kind's)"),
    frames: z
      .record(id, stateFrames)
      .exactOptional()
      .describe("2D: the frames by animation state, as the kind's `frames`, used instead of them"),
    fallbackColor: color
      .exactOptional()
      .describe("2D: the box colour when a frame is missing (default the kind's)"),
    mesh: meshRef.exactOptional(),
    color: color.exactOptional().describe("3D: the mesh's colour (default the kind's)"),
    model: modelPath
      .exactOptional()
      .describe("3D: a glTF model shown in place of the kind's (Engine 0.16 part B)"),
    scale: z
      .number()
      .positive()
      .exactOptional()
      .describe("3D: the kind's `scale` for this look (for a `model`, px per model unit)"),
    anchor: modelAnchor.exactOptional(),
    rotate: modelRotate.exactOptional(),
    clip: z
      .union([id, z.record(id, id)])
      .exactOptional()
      .describe("3D model: the clips for this look, as the kind's `clip`"),
    tint: modelTint.exactOptional(),
    stretch: modelStretch.exactOptional(),
  })
  .superRefine((v, ctx) => {
    if ((v.tag === undefined) === (v.prefix === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: [v.tag === undefined ? 'tag' : 'prefix'],
        message: 'give exactly one of "tag" (the whole tag) and "prefix"',
        params: { code: 'bad_tag_look' },
      });
    }
    for (const field of ['min', 'max'] as const) {
      if (v[field] !== undefined && v.prefix === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `"${field}" needs "prefix" (it reads the rest of a prefixed tag)`,
          params: { code: 'bad_tag_look' },
        });
      }
    }
    if (v.min !== undefined && v.max !== undefined && v.min > v.max) {
      ctx.addIssue({
        code: 'custom',
        path: ['max'],
        message: `"max" ${v.max} is below "min" ${v.min}`,
        params: { code: 'bad_tag_look' },
      });
    }
  });

/** The fields of a tag entry that say which tag it matches, not how it looks. */
const TAG_MATCH_FIELDS = ['tag', 'prefix', 'min', 'max'] as const;

/** The fields a tag entry may give, of each shape. */
const TAG_SPRITE_FIELDS = ['sheet', 'palette', 'frames', 'fallbackColor'] as const;
const TAG_MESH_FIELDS = [
  'mesh',
  'color',
  'model',
  'scale',
  'anchor',
  'rotate',
  'clip',
  'tint',
  'stretch',
] as const;

/** One emitter name or a list of them: what an event's or a kind's `emit` takes (Engine 0.16 T3). */
const emitRefs = z
  .union([id, z.array(id).min(1)])
  .describe("the name of an emitter in the skin's `emitters`, or a list of names");

const kindEntry = z.strictObject({
  sheet: id.exactOptional().describe('2D: the sprite file the frames are in (default `sheets.sheet`)'),
  palette: id.exactOptional().describe("2D: a palette to draw with instead of the sprite's own"),
  frames: z
    .record(id, stateFrames)
    .exactOptional()
    .describe(
      '2D: animation state -> a frame name, `{ frames, ticks?, loop? }` (a cycle) or `{ up?, down?, left?, right?, up-left?, up-right?, down-left?, down-right? }` (a frame or cycle per facing, all optional; a diagonal left out uses its horizontal part); `idle` is used for a state not listed',
    ),
  flipFacing: z
    .boolean()
    .exactOptional()
    .describe('2D: draw the right-hand frames mirrored when the entity faces left or a left-hand diagonal'),
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
  poses: z
    .record(id, stateFrames)
    .exactOptional()
    .describe(
      "3D: animation state -> a mesh (a primitive or a key of `meshes`), a cycle of meshes or a mesh or cycle per facing, read as `frames` is (timing, `loop`, `then`, frame `events`, the `idle` fallback); without `poses` the entry's `mesh` is shown",
    ),
  scale: z
    .number()
    .positive()
    .exactOptional()
    .describe(
      "3D: size factor about the box's bottom centre; for a `model`, px per model unit (the stand-in mesh is then not scaled) (default 1)",
    ),
  depth,
  z: zOffset,
  model: modelPath.exactOptional(),
  anchor: modelAnchor.exactOptional(),
  rotate: modelRotate.exactOptional(),
  clip: z
    .union([id, z.record(id, id)])
    .exactOptional()
    .describe(
      "3D model: the animation clip to play, one name for every state or animation state -> clip name (a state not listed plays `idle`'s, else none); looped, `anim.t` / 60 seconds in",
    ),
  clipHold: z
    .array(id)
    .min(1)
    .exactOptional()
    .describe(
      '3D model: animation states whose clip plays once and holds its last pose (a death), instead of looping (Engine 0.16 part B)',
    ),
  castShadow,
  receiveShadow,
  tint: modelTint.exactOptional(),
  stretch: modelStretch.exactOptional(),
  light: kindLightSchema.exactOptional(),
  offset: offset.exactOptional(),
  spawnTween: tweensSchema
    .exactOptional()
    .describe(
      'tweens started on an entity of this kind the first frame a presenter shows it (a pop-in), on top of its `fx`; presentation only (Engine 0.16)',
    ),
  emit: emitRefs
    .exactOptional()
    .describe(
      'emitters that run while an entity of this kind shows, following it (torch smoke, a magic aura); presentation only (Engine 0.16)',
    ),
  blend: z
    .enum(['normal', 'add'])
    .exactOptional()
    .describe('2D: `add` draws the sprite additively, brightening what is under it (default `normal`)'),
  glow: z
    .strictObject({
      color: color.describe('the glow colour'),
      radius: z.number().positive().describe('the blur radius in picture px'),
    })
    .exactOptional()
    .describe('2D: a soft glow round the sprite'),
  byTag: z
    .array(tagEntry)
    .exactOptional()
    .describe(
      "looks by entity tag, `{ tag | prefix, min?, max?, sheet?, palette?, frames?, fallbackColor?, mesh?, color? }`: the first entry in file order that matches one of the entity's tags (`tag`: the whole tag; `prefix`: any tag starting with it, and with `min`/`max` only one whose rest is a whole number in that inclusive range, such as `progress:` 50-99) replaces those fields of the kind's; the state and facing are then picked as usual",
    ),
});

const tileEntry = z.strictObject({
  sheet: id.exactOptional().describe('2D: the sprite file (default `sheets.sheet`)'),
  frame: id.exactOptional().describe('2D: the frame name in the sheet'),
  join: tileJoinSchema.exactOptional(),
  vary: tileVarySchema.exactOptional(),
  fallbackColor: color
    .exactOptional()
    .describe('2D: the colour when the frame is missing (default `sheets.fallbackColor`)'),
  mesh: meshRef.exactOptional(),
  color: color.exactOptional().describe("3D: the mesh's colour"),
  depth,
  z: zOffset,
  model: modelPath.exactOptional(),
  scale: z
    .number()
    .positive()
    .exactOptional()
    .describe(
      "3D: size factor about the tile's bottom centre; for a `model`, px per model unit (the stand-in mesh is then not scaled) (default 1)",
    ),
  anchor: modelAnchor.exactOptional(),
  rotate: modelRotate.exactOptional(),
  clip: id
    .exactOptional()
    .describe(
      '3D model: the animation clip every cell plays, looped on the frame clock (frame / 60 seconds)',
    ),
  castShadow,
  receiveShadow,
  tint: modelTint.exactOptional(),
  stretch: modelStretch.exactOptional(),
});

/**
 * One row of 3D scenery (Engine 0.16 part B, T10): copies of a model set along a map, `every` px
 * apart from `from`, at `z` px from the blocks' plane (negative is behind them), standing on world
 * row `y` (px, y down; default the map's bottom edge), each nudged by its own seeded `jitter`.
 * Presentation only: the 3D backend places them when it builds a map, never in a frame or a hash.
 */
export const sceneryRowSchema = z
  .strictObject({
    model: modelPath,
    scale: z.number().positive().exactOptional().describe('px per model unit (default 1)'),
    stretch: modelStretch.exactOptional(),
    rotate: modelRotate.exactOptional(),
    tint: modelTint.exactOptional(),
    every: z.number().positive().describe('px between one copy and the next along x'),
    from: z.number().exactOptional().describe('px x of the first copy (default 0)'),
    z: z.number().describe("px toward the camera from the blocks' plane (negative: behind them)"),
    y: z
      .number()
      .exactOptional()
      .describe("world px (y down) the copies stand on (default the map's bottom edge)"),
    jitter: z
      .strictObject({
        x: z.number().min(0).exactOptional().describe('px either way along x'),
        y: z.number().min(0).exactOptional().describe('px either way up and down'),
        z: z.number().min(0).exactOptional().describe('px either way in depth'),
        scale: z.number().min(0).max(0.9).exactOptional().describe('share either way of the size'),
        turn: z.number().min(0).max(180).exactOptional().describe('degrees either way about the upright'),
      })
      .exactOptional()
      .describe("each copy's own seeded nudge (default none)"),
    castShadow,
    receiveShadow,
  })
  .describe('3D: a row of scenery models along the map (Engine 0.16 part B)');

export type SkinSceneryRow = z.output<typeof sceneryRowSchema>;

const effect = z.strictObject({
  kind: z.enum(['flash', 'particles', 'shake', 'tint']).describe('what the backend shows'),
  color: color.exactOptional().describe('its colour'),
  ticks: z.number().int().min(1).exactOptional().describe('how long it lasts'),
  count: z.number().int().min(1).exactOptional().describe('particles: how many'),
  size: z.number().positive().exactOptional().describe('particles: size in pixels; shake: strength'),
});

const eventEntry = z.strictObject({
  sound: id.exactOptional().describe('a song or sfx id to play'),
  pitch: soundVariationFields.pitch.describe(
    "the sound's pitch shift in semitones, `[min, max]`, drawn per play from the presentation RNG (Engine 0.16)",
  ),
  volume: soundVariationFields.volume.describe(
    "the sound's volume factor (0..1), `[min, max]`, drawn per play from the presentation RNG (Engine 0.16)",
  ),
  cooldown: soundVariationFields.cooldown.describe(
    'frames the same sound rests after it played: a play sooner is dropped (Engine 0.16)',
  ),
  duck: soundVariationFields.duck.describe(
    'music ducking under the sound, `{ amount, attack?, hold?, release? }` in ticks (Engine 0.16)',
  ),
  emit: emitRefs
    .exactOptional()
    .describe(
      "emitters started at the event: at its `x`/`y`, else its entity (the emitter's `anchor` on the entity when it gives one); presentation only (Engine 0.16)",
    ),
  effect: effect.exactOptional().describe('a presentation-only effect at the event'),
  tween: tweensSchema
    .exactOptional()
    .describe(
      "tweens started on the event's `entity` (a squash, a hit flash), on top of its `fx`; ignored for an event with no entity; presentation only (Engine 0.16)",
    ),
  shake: shakeSpecSchema
    .exactOptional()
    .describe(
      'a camera shake, `{ amount, ticks }`: trauma decaying over `ticks`; presentation only (Engine 0.16)',
    ),
  zoom: zoomSpecSchema
    .exactOptional()
    .describe(
      'a zoom punch, `{ to, ticks, ease?, hold?, back? }`, there and back; presentation only (Engine 0.16)',
    ),
  flash: flashSpecSchema
    .exactOptional()
    .describe(
      'a full-screen flash, `{ color?, alpha?, ticks }`, fading out; skipped with reduced flashing (Engine 0.16)',
    ),
  hitPause: hitPauseSpecSchema
    .exactOptional()
    .describe(
      "a hit-pause, `{ ticks }`: the browser shell holds the game's ticks that many display frames (Engine 0.16)",
    ),
});

/** The HUD item types drawn before Engine 0.16 T6, exactly as they were (`layoutHud`). */
export const HUD_CLASSIC_TYPES = ['hearts', 'number', 'text', 'icon'] as const;

/** The HUD widget types Engine 0.16 T6 adds (`engine/core/ui`). */
export const HUD_WIDGET_TYPES = ['bar', 'counter', 'panel', 'minimap'] as const;

/** The token a HUD item's `format` replaces with the status value. */
export const HUD_VALUE_TOKEN = '{value}';

const insets = z.union([
  z.number().int().min(0),
  z.strictObject({
    left: z.number().int().min(0),
    top: z.number().int().min(0),
    right: z.number().int().min(0),
    bottom: z.number().int().min(0),
  }),
]);

const hudPanel = z.strictObject({
  frame: id.describe('the sprite frame cut into nine pieces'),
  sheet: id.exactOptional().describe('its sprite file (default `sheets.sheet`)'),
  slice: insets.describe('px kept fixed on each side: one number or `{ left, top, right, bottom }`'),
  fill: z
    .enum(['stretch', 'tile'])
    .exactOptional()
    .describe('how edges and the centre fill their span (default `stretch`)'),
});

const minimapDot = z
  .strictObject({
    kind: id.exactOptional().describe('entities of this kind'),
    tag: id.exactOptional().describe('entities with this tag'),
    color: color.describe('the dot colour'),
    size: z.number().int().min(1).max(8).exactOptional().describe('the dot side, px (default 2)'),
  })
  .refine((d) => (d.kind === undefined) !== (d.tag === undefined), {
    message: 'a minimap dot names exactly one of "kind" and "tag"',
    params: { code: 'bad_minimap_dot' },
  });

const hudItem = z
  .strictObject({
    status: id
      .exactOptional()
      .describe(
        'the status key it shows (`health`, `score`); a key the frame lacks draws nothing. Not needed by `panel`, `minimap` or a `text` with a `format`',
      ),
    as: z
      .enum([...HUD_CLASSIC_TYPES, ...HUD_WIDGET_TYPES])
      .describe(
        'how it shows: `hearts`, `number`, `text`, `icon`, and from Engine 0.16 `bar`, `counter` (icon + number), `panel` (nine-slice) and `minimap`',
      ),
    x: z.number().int().describe('left edge, screen pixels'),
    y: z.number().int().describe('top edge, screen pixels'),
    w: z
      .number()
      .int()
      .min(1)
      .exactOptional()
      .describe('width, px: a bar, panel or minimap box; a text item wraps and aligns inside it'),
    h: z.number().int().min(1).exactOptional().describe('height, px: a bar, panel or minimap box'),
    sheet: id
      .exactOptional()
      .describe('the sprite file for hearts, icons, counters and panels (default `sheets.sheet`)'),
    frame: id.exactOptional().describe("the frame for hearts, icons, a counter's icon and a panel"),
    when: id
      .exactOptional()
      .describe(
        'a status key: the item shows only while its value is truthy (not 0, false or empty), such as the item count once an item is owned (Engine 0.16 part C T3)',
      ),
    half: id
      .exactOptional()
      .describe(
        'hearts: the frame for a last half point (Engine 0.16 part C T3); with it the status counts halves, two points to a `frame`',
      ),
    font: id
      .exactOptional()
      .describe(
        'the font for numbers, text and counters: a `font` content file (Engine 0.16), else a sprite file with one frame per character',
      ),
    color: color.exactOptional().describe("text colour, or a bar's fill (a `font` file's text only)"),
    shadow: color.exactOptional().describe("a one-px drop shadow in this colour (a `font` file's text)"),
    outline: color.exactOptional().describe("a one-px outline in this colour (a `font` file's text)"),
    align: z
      .enum(['left', 'center', 'right'])
      .exactOptional()
      .describe('text alignment inside `w` (default left)'),
    format: z
      .string()
      .exactOptional()
      .describe(
        `the text shown, with \`${HUD_VALUE_TOKEN}\` replaced by the status value (\`Coins ${HUD_VALUE_TOKEN}\`); without it, the value`,
      ),
    digits: z
      .number()
      .int()
      .min(1)
      .max(12)
      .exactOptional()
      .describe('a number or counter padded with leading zeros to this many digits'),
    gap: z
      .number()
      .int()
      .min(0)
      .exactOptional()
      .describe("px between a counter's icon and its number (default 2)"),
    tween: z
      .strictObject({
        ticks: z.number().int().min(1).describe('display frames a change rolls over'),
        ease: z.string().exactOptional().describe('the easing curve (default `cubicOut`)'),
        color: color.exactOptional().describe("the number's colour while it rolls"),
      })
      .exactOptional()
      .describe("a counter's number rolls to a new value instead of jumping"),
    max: z
      .union([z.number().positive(), id])
      .exactOptional()
      .describe("a bar's full value: a number or another status key (`maxHp`)"),
    back: color.exactOptional().describe("a bar's empty part, or a minimap's background"),
    border: color.exactOptional().describe('a one-px border round a bar or minimap (when it has no `panel`)'),
    low: z
      .strictObject({
        below: z.number().min(0).max(1).describe('the share of `max` at or below which the bar is low'),
        color: color.describe('the fill colour when low'),
      })
      .exactOptional()
      .describe("a bar's warning colour"),
    panel: hudPanel
      .exactOptional()
      .describe("a bar's frame, a nine-slice panel round its box (drawn under the fill)"),
    slice: insets.exactOptional().describe("a `panel` item's fixed px on each side (one number or four)"),
    fill: z.enum(['stretch', 'tile']).exactOptional().describe("how a `panel` item's edges and centre fill"),
    scale: z
      .number()
      .positive()
      .exactOptional()
      .describe("a minimap's px per tile (default: the largest that fits `w` x `h`)"),
    tiles: z
      .record(z.string().min(1), color)
      .exactOptional()
      .describe("a minimap's colour per tile character or id; other tiles show the background"),
    dots: z
      .array(minimapDot)
      .exactOptional()
      .describe("a minimap's entity dots, drawn in order over the tiles"),
  })
  .superRefine((v, ctx) => {
    const need = (field: string, why: string) =>
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: `"${v.as}" needs ${why}`,
        params: { code: 'missing_field' },
      });
    if ((v.as === 'hearts' || v.as === 'icon' || v.as === 'panel') && v.frame === undefined) {
      ctx.addIssue({ code: 'custom', path: ['frame'], message: `"${v.as}" needs a frame` });
    }
    if (v.half !== undefined && v.as !== 'hearts')
      ctx.addIssue({ code: 'custom', path: ['half'], message: '`half` is for "hearts" only' });
    const statusFree = v.as === 'panel' || v.as === 'minimap' || (v.as === 'text' && v.format !== undefined);
    if (!statusFree && v.status === undefined) need('status', 'a status key');
    if (v.as === 'bar' || v.as === 'panel' || v.as === 'minimap') {
      if (v.w === undefined) need('w', 'a width');
      if (v.h === undefined) need('h', 'a height');
    }
    if (v.as === 'bar' && v.max === undefined) need('max', 'a max (a number or a status key)');
    if (v.as === 'panel' && v.slice === undefined) need('slice', 'its slice insets');
    if (v.as === 'counter' && v.font === undefined) need('font', 'a font');
    if (v.tween?.ease !== undefined && !isEaseName(v.tween.ease)) {
      ctx.addIssue({
        code: 'custom',
        path: ['tween', 'ease'],
        message: `unknown ease "${v.tween.ease}"; one of ${EASE_NAMES.join(', ')}`,
        params: { code: 'bad_ease' },
      });
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
  clamp: z
    .boolean()
    .exactOptional()
    .describe(
      'keep the view inside the map, centring a smaller map (default true); false lets a camera hint place it',
    ),
  lookAhead: z
    .strictObject({
      x: z
        .number()
        .int()
        .min(0)
        .exactOptional()
        .describe('world px ahead of a followed entity facing left or right'),
      y: z.number().int().min(0).exactOptional().describe('world px ahead of one facing up or down'),
      lerp: z
        .number()
        .min(0)
        .max(1)
        .exactOptional()
        .describe(`how far the look-ahead closes its gap each frame (default ${CAMERA_LOOK_AHEAD_LERP})`),
    })
    .exactOptional()
    .describe(
      'Engine 0.16: frame a followed entity this far ahead in its facing direction, gliding there when it turns',
    ),
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
  where: readonly (string | number)[],
  needs2d: readonly string[],
  ctx: z.RefinementCtx,
): void {
  const mesh = MESH_BACKENDS.includes(backend);
  const wrong: readonly string[] = mesh ? SPRITE_FIELDS : MESH_FIELDS;
  const needs = mesh ? ['mesh', 'color'] : needs2d;
  for (const [key, entry] of Object.entries(entries)) {
    const looks = Array.isArray(entry['byTag']) ? (entry['byTag'] as Record<string, unknown>[]) : [];
    looks.forEach((look, i) => {
      for (const field of mesh ? TAG_SPRITE_FIELDS : TAG_MESH_FIELDS) {
        if (look[field] === undefined) continue;
        ctx.addIssue({
          code: 'custom',
          path: [...where, key, 'byTag', i, field],
          message: `"${field}" is a ${mesh ? '2D' : '3D'} field; backend "${backend}" takes ${mesh ? 'meshes' : 'sprites'}`,
          params: { code: 'wrong_backend_field' },
        });
      }
    });
    for (const field of wrong) {
      if (entry[field] === undefined) continue;
      const msg = `"${field}" is a ${mesh ? '2D' : '3D'} field; backend "${backend}" takes ${mesh ? 'meshes' : 'sprites'}`;
      ctx.addIssue({
        code: 'custom',
        path: [...where, key, field],
        message: msg,
        params: { code: 'wrong_backend_field' },
      });
    }
    if (mesh && entry['model'] === undefined) {
      for (const field of MODEL_FIELDS) {
        if (entry[field] === undefined) continue;
        ctx.addIssue({
          code: 'custom',
          path: [...where, key, field],
          message: `"${field}" is a model field: give "model" too`,
          params: { code: 'missing_field' },
        });
      }
    }
    for (const field of needs) {
      const fromDefault = (field === 'sheet' || field === 'fallbackColor') && defaults?.[field] !== undefined;
      if (entry[field] !== undefined || fromDefault) continue;
      ctx.addIssue({
        code: 'custom',
        path: [...where, key, field],
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
    kinds: Record<
      string,
      { mesh?: string; poses?: Record<string, SkinStateFrames>; byTag?: { mesh?: string }[] }
    >;
    tiles?: Record<string, { mesh?: string }>;
    themes?: Record<string, { tiles?: Record<string, { mesh?: string }> }>;
    meshes?: Record<string, unknown>;
    camera3d?: unknown;
    scene3d?: unknown;
    scenery?: unknown;
    labels?: unknown;
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
  const check = (path: FieldPath, ref: string | undefined) => {
    if (ref === undefined || isPrimitive(ref) || Object.hasOwn(meshes, ref)) return;
    ctx.addIssue({
      code: 'custom',
      path: [...path, 'mesh'],
      message: `no primitive or mesh "${ref}" (primitives: ${MESH_PRIMITIVES.join(', ')})`,
      params: { code: 'missing_ref' },
    });
  };
  for (const [key, entry] of Object.entries(skin.kinds)) {
    check(['kinds', key], entry.mesh);
    const sheetsSeen = new Set<string>();
    for (const pose of framesOf(entry.poses ?? {}, 'poses')) {
      if (pose.sheet !== undefined && !sheetsSeen.has(JSON.stringify(pose.sheet.path))) {
        sheetsSeen.add(JSON.stringify(pose.sheet.path));
        ctx.addIssue({
          code: 'custom',
          path: ['kinds', key, ...pose.sheet.path],
          message: `"sheet" is a 2D field; backend "${skin.backend}" takes meshes`,
          params: { code: 'wrong_backend_field' },
        });
      }
      if (isPrimitive(pose.frame) || Object.hasOwn(meshes, pose.frame)) continue;
      ctx.addIssue({
        code: 'custom',
        path: ['kinds', key, ...pose.path],
        message: `no primitive or mesh "${pose.frame}" (primitives: ${MESH_PRIMITIVES.join(', ')})`,
        params: { code: 'missing_ref' },
      });
    }
    (entry.byTag ?? []).forEach((look, i) => check(['kinds', key, 'byTag', i], look.mesh));
  }
  for (const [key, entry] of Object.entries(skin.tiles ?? {})) check(['tiles', key], entry.mesh);
  for (const [map, theme] of Object.entries(skin.themes ?? {}))
    for (const [key, entry] of Object.entries(theme.tiles ?? {}))
      check(['themes', map, 'tiles', key], entry.mesh);
}

/** Every `events` key must be a bare type, `type:value` or `type:field=value` ({@link parseEventKey}). */
function checkEventKeys(events: Record<string, unknown>, ctx: z.RefinementCtx): void {
  for (const key of Object.keys(events)) {
    if (parseEventKey(key) !== null) continue;
    ctx.addIssue({
      code: 'custom',
      path: ['events', key],
      message: `"${key}" is not an event key: use "type", "type:value" or "type:field=value"`,
      params: { code: 'bad_event_key' },
    });
  }
}

/** Every `emit` (an event's or a kind's) must name an emitter of the skin's `emitters` (`missing_ref`). */
function checkEmitRefs(
  skin: {
    emitters?: Record<string, unknown>;
    events?: Record<string, { emit?: string | string[] }>;
    kinds: Record<string, { emit?: string | string[] }>;
  },
  ctx: z.RefinementCtx,
): void {
  const known = skin.emitters ?? {};
  const check = (path: FieldPath, emit: string | string[] | undefined) => {
    if (emit === undefined) return;
    const list = typeof emit === 'string' ? [emit] : emit;
    list.forEach((name, i) => {
      if (Object.hasOwn(known, name)) return;
      const names = Object.keys(known);
      ctx.addIssue({
        code: 'custom',
        path: typeof emit === 'string' ? [...path, 'emit'] : [...path, 'emit', i],
        message: `no emitter "${name}" in this skin's \`emitters\`${names.length ? ` (emitters: ${names.join(', ')})` : ''}`,
        params: { code: 'missing_ref' },
      });
    });
  };
  for (const [type, entry] of Object.entries(skin.events ?? {})) check(['events', type], entry.emit);
  for (const [kind, entry] of Object.entries(skin.kinds)) check(['kinds', kind], entry.emit);
}

/**
 * A skin's `lighting` (Engine 0.16 part C T4): a 2D field (`wrong_backend_field` on a 3D skin);
 * its kinds and tiles must be the skin's (`missing_ref`), its event keys read like `events`' keys
 * (`bad_event_key`) and its particles' `emit` must name emitters of the skin (`missing_ref`).
 */
function checkLighting(
  skin: {
    backend: string;
    kinds: Record<string, unknown>;
    tiles?: Record<string, unknown>;
    emitters?: Record<string, unknown>;
    lighting?: LightingSpec;
  },
  ctx: z.RefinementCtx,
): void {
  const lighting = skin.lighting;
  if (lighting === undefined) return;
  if (MESH_BACKENDS.includes(skin.backend)) {
    ctx.addIssue({
      code: 'custom',
      path: ['lighting'],
      message: `"lighting" is a 2D field; backend "${skin.backend}" lights with \`scene3d\` and kinds' \`light\``,
      params: { code: 'wrong_backend_field' },
    });
    return;
  }
  const missing = (path: (string | number)[], what: string, name: string, known: Record<string, unknown>) => {
    const names = Object.keys(known);
    ctx.addIssue({
      code: 'custom',
      path,
      message: `no ${what} "${name}" in this skin${names.length ? ` (${names.slice(0, 20).join(', ')})` : ''}`,
      params: { code: 'missing_ref' },
    });
  };
  for (const kind of Object.keys(lighting.kinds ?? {}))
    if (!Object.hasOwn(skin.kinds, kind)) missing(['lighting', 'kinds', kind], 'kind', kind, skin.kinds);
  const tiles = skin.tiles ?? {};
  for (const tile of Object.keys(lighting.tiles ?? {}))
    if (!Object.hasOwn(tiles, tile)) missing(['lighting', 'tiles', tile], 'tile', tile, tiles);
  for (const key of Object.keys(lighting.events ?? {})) {
    if (parseEventKey(key) !== null) continue;
    ctx.addIssue({
      code: 'custom',
      path: ['lighting', 'events', key],
      message: `"${key}" is not an event key: use "type", "type:value" or "type:field=value"`,
      params: { code: 'bad_event_key' },
    });
  }
  const emitters = skin.emitters ?? {};
  (lighting.particles ?? []).forEach((p, i) => {
    const list = typeof p.emit === 'string' ? [p.emit] : p.emit;
    list.forEach((name, j) => {
      if (Object.hasOwn(emitters, name)) return;
      const at =
        typeof p.emit === 'string'
          ? ['lighting', 'particles', i, 'emit']
          : ['lighting', 'particles', i, 'emit', j];
      missing(at, 'emitter', name, emitters);
    });
  });
}

function isPrimitive(name: string): name is MeshPrimitive {
  return (MESH_PRIMITIVES as readonly string[]).includes(name);
}

/**
 * One map's look (Engine 0.16 part B, T7): what a skin's `themes` entry changes while a frame
 * shows that map. Each field left out keeps the skin's own.
 */
const themeSchema = z
  .strictObject({
    background: color.exactOptional().describe("the colour cleared to on this map (default the skin's)"),
    parallax: z
      .array(parallaxLayerSchema)
      .exactOptional()
      .describe("this map's background layers, in place of the skin's `parallax` (back to front)"),
    tiles: z
      .record(id, tileEntry)
      .exactOptional()
      .describe(
        "tile entries laid over the skin's `tiles` on this map (a key given here replaces the skin's)",
      ),
    scene3d: scene3dSchema
      .exactOptional()
      .describe("3D: this map's scene look (lights, fog, tone mapping), in place of the skin's `scene3d`"),
    scenery: z
      .array(sceneryRowSchema)
      .exactOptional()
      .describe("3D: this map's scenery rows, in place of the skin's `scenery`"),
  })
  .describe("one map's look");

export const skinSchema = z
  .strictObject({
    backend: id.describe('the backend it is for: `canvas2d`, `three` (meshes) or another backend name'),
    background: color
      .exactOptional()
      .describe(
        `the colour the backend clears to before each frame it draws with this skin (default \`${DEFAULT_BACKGROUND}\`)`,
      ),
    sheets: sheets.exactOptional().describe('defaults for entries that leave a field out'),
    images: z
      .record(id, imageSheetSchema)
      .exactOptional()
      .describe(
        'PNG sprite sheets (Engine 0.16): id -> `{ image: "assets/<pack>/<file>.png", frameSize?, grid?: { cols, rows, margin?, spacing? }, names?, frames?: { name: { x, y, w, h, anchor? } }, anchor? }`; entries name the id as their `sheet`',
      ),
    kinds: z.record(id, kindEntry).describe('entity kind -> how it looks'),
    tiles: z.record(id, tileEntry).exactOptional().describe('map tile character or id -> how it looks'),
    events: z
      .record(id, eventEntry)
      .exactOptional()
      .describe(
        'event type -> its sound and effect; a key may match a field too: `type:value` (the `result` field, `mini-game-end:pass`) or `type:field=value`, tried first in file order, then the bare type',
      ),
    hud: z.array(hudItem).exactOptional().describe('status values drawn on screen, in order'),
    camera: camera.exactOptional().describe("framing defaults; a frame's own camera hint wins"),
    meshes: z
      .record(id, z.array(meshPart).min(1))
      .exactOptional()
      .describe('3D: named compound meshes, each a list of primitive parts in world px'),
    camera3d: camera3d.exactOptional().describe('3D: perspective framing and light defaults'),
    scene3d: scene3dSchema
      .exactOptional()
      .describe(
        '3D: the scene look (Engine 0.16): `{ sun?: { color?, intensity?, direction?, shadow?: { mapSize?, bias?, radius? } }, ambient?, hemisphere?, fog?: { kind: linear | exp2, color, near?, far?, density? }, toneMapping?: { kind: aces | agx | none, exposure? }, colorSpace? }`',
      ),
    labels: labelsSchema.exactOptional(),
    scenery: z
      .array(sceneryRowSchema)
      .exactOptional()
      .describe(
        '3D: rows of scenery models along the map, in front of or behind the blocks (Engine 0.16 part B): `{ model, scale?, stretch?, rotate?, tint?, every, from?, z, y?, jitter?: { x?, y?, z?, scale?, turn? }, castShadow?, receiveShadow? }`',
      ),
    emitters: z
      .record(id, emitterSchema)
      .exactOptional()
      .describe(
        "named particle emitters (Engine 0.16), started by an event's `emit` or run by a kind's `emit`",
      ),
    parallax: z
      .array(parallaxLayerSchema)
      .exactOptional()
      .describe(
        'background layers behind the map, back to front (Engine 0.16): `{ frame | gradient, factor, repeat?, x?, y?, sheet?, bands?, height?, depth? }`',
      ),
    lighting: lightingSchema
      .exactOptional()
      .describe(
        '2D lighting and mood (Engine 0.16 part C): `{ ambient?, tags?, maps?: { id: { ambient?, lights? } }, kinds?, tiles?, events?, vignette?, bands?, particles? }`: darkness per map tag or id, lights per kind and state, tile, place and event (radius, colour, intensity, glow, flicker), a vignette and room-wide particles',
      ),
    themes: z
      .record(id, themeSchema)
      .exactOptional()
      .describe(
        "per-map looks (Engine 0.16 part B, T7): map id -> `{ background?, parallax?, tiles?, scene3d?, scenery? }`, used in place of the skin's own `background`, `parallax`, `scene3d` and `scenery`, and over its `tiles` key by key, while a frame shows the map with that id (a platformer level's id); both backends draw them (3D from Engine 0.16 part B, T10)",
      ),
    music: skinMusicSchema
      .exactOptional()
      .describe(
        'layered songs (Engine 0.16): id -> `{ layers: { name: song }, fade?, mix?: [{ when?: { status, eq | ne | lt | lte | gt | gte }, layers: { name: level }, fade? }] }`',
      ),
  })
  .superRefine((skin, ctx) => {
    checkEventKeys(skin.events ?? {}, ctx);
    for (const [key, entry] of Object.entries(skin.events ?? {})) {
      checkSoundRange(entry.pitch, ['events', key, 'pitch'], ctx);
      checkSoundRange(entry.volume, ['events', key, 'volume'], ctx);
    }
    checkMusicLayers(skin.music, ctx);
    checkEmitRefs(skin, ctx);
    checkLighting(skin, ctx);
    checkMeshes(skin, ctx);
    checkShapes(skin.backend, skin.sheets, skin.kinds, ['kinds'], ['sheet', 'frames', 'fallbackColor'], ctx);
    checkShapes(
      skin.backend,
      skin.sheets,
      skin.tiles ?? {},
      ['tiles'],
      ['sheet', 'frame', 'fallbackColor'],
      ctx,
    );
    for (const [map, theme] of Object.entries(skin.themes ?? {})) {
      const at = ['themes', map, 'tiles'];
      checkShapes(skin.backend, skin.sheets, theme.tiles ?? {}, at, ['sheet', 'frame', 'fallbackColor'], ctx);
    }
    checkJoinTiles(skin, ctx);
  });

/**
 * In a 3D skin a tile's `join` picks another `tiles` entry by key (Engine 0.16 part B, T10: a
 * grass-topped block on top, plain dirt inside), so each `join.frames` value must be a key of the
 * skin's tiles (or, in a theme, of the theme's or the skin's): `missing_ref` otherwise.
 */
function checkJoinTiles(
  skin: {
    backend: string;
    tiles?: Record<string, { join?: { frames: Record<string, string> } }>;
    themes?: Record<string, { tiles?: Record<string, { join?: { frames: Record<string, string> } }> }>;
  },
  ctx: z.RefinementCtx,
): void {
  if (!MESH_BACKENDS.includes(skin.backend)) return;
  const check = (at: FieldPath, tiles: typeof skin.tiles, known: Record<string, unknown>) => {
    for (const [tile, entry] of Object.entries(tiles ?? {}))
      for (const [key, name] of Object.entries(entry.join?.frames ?? {})) {
        if (Object.hasOwn(known, name)) continue;
        ctx.addIssue({
          code: 'custom',
          path: [...at, tile, 'join', 'frames', key],
          message: `no tile "${name}" in this skin's \`tiles\` (a 3D join names a tile entry)`,
          params: { code: 'missing_ref' },
        });
      }
  };
  check(['tiles'], skin.tiles, skin.tiles ?? {});
  for (const [map, theme] of Object.entries(skin.themes ?? {}))
    check(['themes', map, 'tiles'], theme.tiles, { ...skin.tiles, ...theme.tiles });
}

export type SkinFile = z.output<typeof skinSchema>;

/** One entry of a skin's `hud` list. */
export type SkinHudItem = NonNullable<SkinFile['hud']>[number];
export type SkinKindEntry = z.output<typeof kindEntry>;
export type SkinTagEntry = z.output<typeof tagEntry>;
export type SkinStateFrames = z.output<typeof stateFrames>;
export type SkinCycle = z.output<typeof cycle>;
export type SkinTileEntry = z.output<typeof tileEntry>;
export type SkinMeshPart = z.output<typeof meshPart>;
export type SkinCamera3d = z.output<typeof camera3d>;
export type SkinEffect = z.output<typeof effect>;
export type SkinEventEntry = z.output<typeof eventEntry>;

// ---- Cross-file checks ----

/** A frame name a skin uses, and its path inside the entry that names it. */
interface NamedFrame {
  frame: string;
  path: FieldPath;
  /** A cycle's own `sheet` (Engine 0.16 part B), and the path of that field: the frame is checked there. */
  sheet?: { id: string; path: FieldPath };
}

/** Every sprite, palette and sound a skin names that the game lacks, and every frame its sheet lacks. */
export function checkSkinRefs(name: string, skin: SkinFile, others: ContentLookup): KindIssue[] {
  const issues: KindIssue[] = [];
  const sprites = new Map(
    others('sprite').map((e) => [e.name, e.value as { frames?: Record<string, unknown> }]),
  );
  // The skin's PNG sheets (Engine 0.16 T10) are sheets too; an id a sprite file has is a clash.
  const images = new Set<string>();
  for (const [image, spec] of Object.entries(skin.images ?? {})) {
    if (sprites.has(image)) {
      const message = `image "${image}" has the name of a sprite file: give it another id`;
      issues.push({ name, path: ['images', image], code: 'duplicate_name', message });
      continue;
    }
    images.add(image);
    sprites.set(image, { frames: Object.fromEntries(imageSheetFrames(spec)) });
  }
  const palettes = new Set(others('palette').map((e) => e.name));
  const sounds = new Set([...others('song'), ...others('sfx')].map((e) => e.name));
  const missing = (path: FieldPath, what: string, ref: string) =>
    issues.push({ name, path, code: 'missing_ref', message: `no ${what} "${ref}" in the game` });

  /** A sheet named at `path` (or the default sheet) and the frames, `{ frame, path }`, used from it. */
  const sheetAt = (path: FieldPath, sheet: string | undefined, frames: readonly NamedFrame[]) => {
    checkSheet(
      path,
      ['sheet'],
      sheet,
      frames.filter((f) => f.sheet === undefined),
    );
    // A cycle with its own sheet: its frames are checked against it, its sheet reported once.
    const bySheet = new Map<string, { id: string; at: FieldPath; frames: NamedFrame[] }>();
    for (const f of frames) {
      if (f.sheet === undefined) continue;
      const key = JSON.stringify(f.sheet.path);
      const group = bySheet.get(key) ?? { id: f.sheet.id, at: f.sheet.path, frames: [] };
      group.frames.push(f);
      bySheet.set(key, group);
    }
    for (const g of bySheet.values()) checkSheet(path, g.at, g.id, g.frames);
  };
  const checkSheet = (
    path: FieldPath,
    sheetPath: FieldPath,
    sheet: string | undefined,
    frames: readonly NamedFrame[],
  ) => {
    const used = sheet ?? skin.sheets?.sheet;
    if (used === undefined) return;
    const sprite = sprites.get(used);
    if (!sprite) {
      if (sheet !== undefined) missing([...path, ...sheetPath], 'sprite', sheet);
      return;
    }
    const what = images.has(used) ? 'image' : 'sprite';
    for (const f of frames) {
      if (sprite.frames && !Object.hasOwn(sprite.frames, f.frame)) {
        const message = `${what} "${used}" has no frame "${f.frame}"`;
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
    (entry.byTag ?? []).forEach((look, i) => {
      const at: FieldPath = ['kinds', kind, 'byTag', i];
      if (look.palette !== undefined && !palettes.has(look.palette))
        missing([...at, 'palette'], 'palette', look.palette);
      if (MESH_BACKENDS.includes(skin.backend)) return;
      // A sheet the kind names and the game lacks is reported at the kind already.
      if (look.sheet === undefined && entry.sheet !== undefined && !sprites.has(entry.sheet)) return;
      sheetAt(at, look.sheet ?? entry.sheet, framesOf(look.frames ?? {}));
    });
  }
  for (const [kind, entry] of Object.entries(skin.kinds)) {
    for (const field of ['frames', 'poses'] as const) {
      issues.push(...checkCycles(name, ['kinds', kind, field], entry[field]));
      (entry.byTag ?? []).forEach((look, i) => {
        if (field === 'frames')
          issues.push(...checkCycles(name, ['kinds', kind, 'byTag', i, field], look.frames));
      });
    }
  }
  const tileRefs = (at: FieldPath, tiles: SkinFile['tiles']) => {
    for (const [tile, entry] of Object.entries(tiles ?? {})) {
      if (entry.mesh !== undefined) continue;
      const joined = Object.entries(entry.join?.frames ?? {}).map(([key, frame]) => ({
        frame,
        path: ['join', 'frames', key],
      }));
      const varied = (entry.vary?.frames ?? []).map((frame, i) => ({ frame, path: ['vary', 'frames', i] }));
      sheetAt([...at, tile], entry.sheet, [...one(entry.frame), ...joined, ...varied]);
    }
  };
  tileRefs(['tiles'], skin.tiles);
  for (const [type, entry] of Object.entries(skin.events ?? {})) {
    if (entry.sound !== undefined && !sounds.has(entry.sound)) {
      missing(['events', type, 'sound'], 'song or sfx', entry.sound);
    }
  }
  issues.push(...checkMusicSongs(name, skin, others));
  issues.push(...checkHudFonts(name, skin, others, sprites));
  issues.push(...checkLabelFonts(name, skin, others));
  (skin.hud ?? []).forEach((item, i) => {
    sheetAt(['hud', i], item.sheet, [
      ...one(item.frame),
      ...(item.half === undefined ? [] : [{ frame: item.half, path: ['half'] }]),
    ]);
    if (item.panel !== undefined) sheetAt(['hud', i, 'panel'], item.panel.sheet, one(item.panel.frame));
  });
  const parallaxRefs = (at: FieldPath, layers: SkinFile['parallax']) =>
    (layers ?? []).forEach((layer, i) => {
      if (layer.frame === undefined) return;
      if (layer.sheet === undefined && skin.sheets?.sheet === undefined) {
        issues.push({
          name,
          path: [...at, i, 'sheet'],
          code: 'missing_field',
          message: 'a parallax frame needs "sheet" (or sheets.sheet)',
        });
        return;
      }
      sheetAt([...at, i], layer.sheet, one(layer.frame));
    });
  parallaxRefs(['parallax'], skin.parallax);
  // A map's look (Engine 0.16 part B, T7) is checked like the skin's own.
  for (const [map, theme] of Object.entries(skin.themes ?? {})) {
    parallaxRefs(['themes', map, 'parallax'], theme.parallax);
    tileRefs(['themes', map, 'tiles'], theme.tiles);
  }
  // A placed light's sprite (Engine 0.16 part C T4) is checked like any frame.
  for (const [map, entry] of Object.entries(skin.lighting?.maps ?? {}))
    (entry.lights ?? []).forEach((light, i) => {
      const sprite = light.sprite;
      if (sprite === undefined) return;
      const at: FieldPath = ['lighting', 'maps', map, 'lights', i, 'sprite'];
      if (sprite.sheet === undefined && skin.sheets?.sheet === undefined) {
        issues.push({
          name,
          path: [...at, 'sheet'],
          code: 'missing_field',
          message: 'a light sprite needs "sheet" (or sheets.sheet)',
        });
        return;
      }
      sheetAt(
        at,
        sprite.sheet,
        sprite.frames.map((frame, j) => ({ frame, path: ['frames', j] })),
      );
    });
  if (!MESH_BACKENDS.includes(skin.backend)) {
    for (const [emitter, def] of Object.entries(skin.emitters ?? {})) {
      if (def.frame !== undefined) sheetAt(['emitters', emitter], def.sheet, one(def.frame));
      else if (def.sheet !== undefined && !sprites.has(def.sheet))
        missing(['emitters', emitter, 'sheet'], 'sprite', def.sheet);
    }
  }
  return issues;
}

/** HUD item fields only the UI kit draws (Engine 0.16 T6). */
/**
 * A `music` entry's layer songs (Engine 0.16 T8): each must be a song of the game (`missing_ref`
 * at `music.<id>.layers.<layer>`), and together they must stay in step: one tempo, all looping or
 * none, and one length in ticks (`bad_layers` at `music.<id>.layers`).
 */
function checkMusicSongs(name: string, skin: SkinFile, others: ContentLookup): KindIssue[] {
  const issues: KindIssue[] = [];
  const songs = new Map(others('song').map((e) => [e.name, e.value as Song]));
  for (const [music, entry] of Object.entries(skin.music ?? {})) {
    const found: { layer: string; song: Song }[] = [];
    for (const [layer, song] of Object.entries(entry.layers)) {
      const value = songs.get(song);
      if (value === undefined) {
        const message = `no song "${song}" in the game`;
        issues.push({ name, path: ['music', music, 'layers', layer], code: 'missing_ref', message });
      } else found.push({ layer, song: value });
    }
    const shapes = found.flatMap((f) => {
      const shape = songShape(f.song);
      return shape === null ? [] : [{ layer: f.layer, shape }];
    });
    const first = shapes[0];
    const odd = shapes.find((f) => f.shape !== first?.shape);
    if (first !== undefined && odd !== undefined) {
      issues.push({
        name,
        path: ['music', music, 'layers'],
        code: 'bad_layers',
        message: `layers must stay in step: "${first.layer}" is ${first.shape}, "${odd.layer}" is ${odd.shape}`,
      });
    }
  }
  return issues;
}

/** A song's tempo, loop and length as one line, or null when it does not compile (its file says why). */
function songShape(song: Song): string | null {
  try {
    const c = compileSong(song);
    const length = Math.max(0, ...Object.values(c.tracks).map((t) => t?.length ?? 0));
    return `${c.bpm} bpm, ${c.loop ? 'looping' : 'not looping'}, ${length} ticks`;
  } catch {
    return null;
  }
}

/**
 * The cue a presenter hands `onSound` with an event entry's sound (Engine 0.16 T8): the frame and
 * the entry's `pitch`, `volume`, `cooldown` and `duck`. The shell's mixer draws the variation.
 */
export function skinSoundCue(
  entry: DeepReadonly<Pick<SkinEventEntry, 'pitch' | 'volume' | 'cooldown' | 'duck'>>,
  frame: number,
): SoundCue {
  const cue: SoundCue = { frame };
  if (entry.pitch !== undefined) cue.pitch = [entry.pitch[0]!, entry.pitch[1]!];
  if (entry.volume !== undefined) cue.volume = [entry.volume[0]!, entry.volume[1]!];
  if (entry.cooldown !== undefined) cue.cooldown = entry.cooldown;
  if (entry.duck !== undefined) cue.duck = { ...entry.duck };
  return cue;
}

const HUD_TEXT_STYLE_FIELDS = ['color', 'shadow', 'outline', 'align', 'format', 'digits'] as const;

/** The digits a HUD number or counter may show. */
const HUD_DIGITS = '0123456789';

/**
 * The HUD's fonts (Engine 0.16 T6): a counter's or styled text's `font` naming neither a font nor
 * a sprite file of the game is `missing_ref`; a font file must have a glyph for every character of the item's `format`
 * (`missing_glyph` at `hud.<i>.format`) and, for a number or counter, every digit
 * (`missing_glyph` at `hud.<i>.font`). Sprite fonts are not checked for glyphs.
 */
function checkHudFonts(
  name: string,
  skin: SkinFile,
  others: ContentLookup,
  sprites: ReadonlyMap<string, unknown>,
): KindIssue[] {
  const issues: KindIssue[] = [];
  const fonts = new Map(others('font').map((e) => [e.name, e.value as FontFile]));
  (skin.hud ?? []).forEach((item, i) => {
    if (item.font === undefined) return;
    const font = fonts.get(item.font);
    if (font === undefined) {
      // Classic items keep their old reading (a sprite font, unchecked); a counter or styled text
      // must name a font file or a sprite.
      const styled = item.as === 'counter' || HUD_TEXT_STYLE_FIELDS.some((f) => item[f] !== undefined);
      if (styled && !sprites.has(item.font))
        issues.push({
          name,
          path: ['hud', i, 'font'],
          code: 'missing_ref',
          message: `no font or sprite "${item.font}" in the game`,
        });
      return;
    }
    const glyphs = new Set(Object.keys(font.glyphs));
    const report = (field: string, chars: string[], what: string) => {
      if (chars.length === 0) return;
      const list = chars.map((c) => JSON.stringify(c)).join(', ');
      issues.push({
        name,
        path: ['hud', i, field],
        code: 'missing_glyph',
        message: `font "${item.font}" has no glyph for ${list} (${what})`,
      });
    };
    if (item.format !== undefined)
      report(
        'format',
        missingGlyphs(glyphs, item.format.split(HUD_VALUE_TOKEN).join('')),
        'used in this format',
      );
    if (item.as === 'number' || item.as === 'counter')
      report('font', missingGlyphs(glyphs, HUD_DIGITS), 'a number shows every digit');
  });
  return issues;
}

/**
 * World-anchored labels' fonts (Engine 0.16 T12): a label's `font` must be a font file of the
 * game (`missing_ref` at `labels.<kind>[.<i>].font`) with a glyph for every character of its
 * `format` (`missing_glyph` at `.format`).
 */
function checkLabelFonts(name: string, skin: SkinFile, others: ContentLookup): KindIssue[] {
  const issues: KindIssue[] = [];
  const fonts = new Map(others('font').map((e) => [e.name, e.value as FontFile]));
  for (const kind of Object.keys(skin.labels ?? {})) {
    const list = skinLabels(skin.labels, kind);
    const many = Array.isArray(skin.labels![kind]);
    list.forEach((label, i) => {
      if (label.font === undefined) return;
      const at: FieldPath = many ? ['labels', kind, i] : ['labels', kind];
      const font = fonts.get(label.font);
      if (font === undefined) {
        const message = `no font "${label.font}" in the game`;
        issues.push({ name, path: [...at, 'font'], code: 'missing_ref', message });
        return;
      }
      if (label.format === undefined) return;
      const chars = missingGlyphs(
        new Set(Object.keys(font.glyphs)),
        label.format.split(HUD_VALUE_TOKEN).join(''),
      );
      if (chars.length === 0) return;
      const list = chars.map((c) => JSON.stringify(c)).join(', ');
      const message = `font "${label.font}" has no glyph for ${list} (used in this format)`;
      issues.push({ name, path: [...at, 'format'], code: 'missing_glyph', message });
    });
  }
  return issues;
}

/** A frame index as an `events` key writes it: a whole number without leading zeros. */
const FRAME_INDEX = /^(?:0|[1-9]\d*)$/;

/**
 * The timing problems of an animation table (`frames` or `poses`, at `path`; Engine 0.16 T2): a
 * per-frame `ticks` list not one entry per frame (`bad_frame_ticks`), a frame event key that is
 * not a frame index of its cycle (`bad_frame_event`), and a `then` on a looping cycle or naming a
 * state the table lacks (`bad_then`).
 */
function checkCycles(
  name: string,
  path: FieldPath,
  table: Record<string, SkinStateFrames> | undefined,
): KindIssue[] {
  const issues: KindIssue[] = [];
  const check = (c: SkinCycle, at: FieldPath) => {
    const n = c.frames.length;
    if (Array.isArray(c.ticks) && c.ticks.length !== n) {
      issues.push({
        name,
        path: [...at, 'ticks'],
        code: 'bad_frame_ticks',
        message: `${c.ticks.length} tick counts for ${n} frame${n === 1 ? '' : 's'}: give one per frame, or one number`,
      });
    }
    for (const key of Object.keys(c.events ?? {})) {
      if (FRAME_INDEX.test(key) && Number(key) < n) continue;
      issues.push({
        name,
        path: [...at, 'events', key],
        code: 'bad_frame_event',
        message: `"${key}" is not a frame of this cycle: use a frame index from 0 to ${n - 1}`,
      });
    }
    if (c.then === undefined) return;
    if (c.loop !== false) {
      const message = '"then" follows a one-shot: give "loop": false too';
      issues.push({ name, path: [...at, 'then'], code: 'bad_then', message });
    } else if (!Object.hasOwn(table ?? {}, c.then)) {
      const message = `no state "${c.then}" here (states: ${Object.keys(table ?? {}).join(', ')})`;
      issues.push({ name, path: [...at, 'then'], code: 'bad_then', message });
    }
  };
  for (const [state, spec] of Object.entries(table ?? {})) {
    const at: FieldPath = [...path, state];
    if (typeof spec === 'string') continue;
    if (spec.frames !== undefined) check({ ...spec, frames: spec.frames }, at);
    else for (const f of FACINGS) if (typeof spec[f] === 'object') check(spec[f], [...at, f]);
  }
  return issues;
}

/** Every frame name in an entry's `frames`, with its path inside the entry. */
function framesOf(frames: Record<string, SkinStateFrames>, field = 'frames'): NamedFrame[] {
  const out: NamedFrame[] = [];
  const add = (spec: string | SkinCycle, path: FieldPath) => {
    if (typeof spec === 'string') out.push({ frame: spec, path });
    else {
      const sheet = spec.sheet === undefined ? {} : { sheet: { id: spec.sheet, path: [...path, 'sheet'] } };
      spec.frames.forEach((f, i) => out.push({ frame: f, path: [...path, 'frames', i], ...sheet }));
    }
  };
  for (const [state, spec] of Object.entries(frames)) {
    const at: FieldPath = [field, state];
    if (typeof spec === 'string') add(spec, at);
    else if (spec.frames !== undefined)
      add({ frames: spec.frames, ...(spec.sheet !== undefined && { sheet: spec.sheet }) }, at);
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

// ---- Event sounds and effects ----

/** The emitter names an `emit` field gives, in order (none when it is left out). */
export function skinEmitNames(emit: string | readonly string[] | undefined): string[] {
  if (emit === undefined) return [];
  return typeof emit === 'string' ? [emit] : [...emit];
}

/** The particle count, size, colour and ticks an old `particles` effect has when it gives none. */
export const PARTICLES_EFFECT_DEFAULTS = { count: 6, size: 2, color: '#fcfcfc', ticks: 12 } as const;

/**
 * An old `effect: { kind: "particles", count?, size?, color?, ticks? }` as an emitter (Engine 0.16
 * T3): a ring of `count` squares `size` px on a side (rounded, at least 1) flying out evenly at 1 px
 * a frame for `ticks` frames, as the backends drew it before emitters, so old skins look the same.
 */
export function particlesEffectEmitter(effect: DeepReadonly<SkinEffect>): EmitterDef {
  return {
    burst: effect.count ?? PARTICLES_EFFECT_DEFAULTS.count,
    life: effect.ticks ?? PARTICLES_EFFECT_DEFAULTS.ticks,
    speed: 1,
    angle: [0, 360],
    even: true,
    size: Math.max(1, Math.round(effect.size ?? PARTICLES_EFFECT_DEFAULTS.size)),
    color: effect.color ?? PARTICLES_EFFECT_DEFAULTS.color,
    max: effect.count ?? PARTICLES_EFFECT_DEFAULTS.count,
  };
}

/**
 * The field an `events` key of the short form `type:value` matches (gap G28, Engine 0.11): the
 * `result` of a `mini-game-end` (`pass`, `fail`, `quit`) and of other results.
 */
export const EVENT_KEY_FIELD = 'result';

/** An `events` key read: the event type, and the field and value it also matches (or null). */
export interface EventKey {
  type: string;
  match: { field: string; value: string } | null;
}

const EVENT_KEY = /^([^:=]+)(?::(?:([^:=]+)=)?([^:=]+))?$/;

/**
 * Reads an `events` key: `type` (any event of that type), `type:value` (its `result` field is
 * `value`) or `type:field=value`. Null for anything else (an empty part, a second `:` or `=`).
 */
export function parseEventKey(key: string): EventKey | null {
  const m = EVENT_KEY.exec(key);
  if (!m) return null;
  const [, type, field, value] = m;
  if (value === undefined) return { type: type!, match: null };
  return { type: type!, match: { field: field ?? EVENT_KEY_FIELD, value } };
}

/** One event as a skin reads it: its type and its other fields. */
type SkinEventInput = { readonly type: string } & { readonly [field: string]: unknown };

/**
 * The skin entry for one event (gap G28): the first key, in file order, of the event's type that
 * also matches one of its fields (`mini-game-end:pass`, `mission-commit:outcome=both-burnt`), else
 * the bare type's entry, else undefined. A field matches when it is a string, number or boolean
 * whose text is the key's value. Both backends' presenters play sounds and effects through this,
 * so a skin with only bare keys reads as before.
 */
export function resolveSkinEvent<E>(
  events: Readonly<Record<string, E>> | undefined,
  ev: SkinEventInput,
): E | undefined {
  if (events === undefined) return undefined;
  for (const key of Object.keys(events)) {
    const parsed = parseEventKey(key);
    if (parsed?.match == null || parsed.type !== ev.type) continue;
    const v = ev[parsed.match.field];
    const text = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : null;
    if (text === parsed.match.value) return events[key];
  }
  return Object.hasOwn(events, ev.type) ? events[ev.type] : undefined;
}

// ---- Picking a frame ----

/** An entity as a skin's kind lookup reads it: its kind and (optionally) its tags. */
export type SkinEntityInput = Pick<DeepReadonly<PresentEntity>, 'kind'> & {
  readonly tags?: readonly string[];
};

/**
 * The colour a backend clears to before drawing a frame with `skin` (Engine 0.15, gap G36): the
 * skin's `background`, else {@link DEFAULT_BACKGROUND} (black). Both backends clear through it,
 * each skin of a skin set to its own (a hosted round keeps its skin's, black by default). Pure.
 */
export function skinBackground(skin: DeepReadonly<Pick<SkinFile, 'background'>>): string {
  return skin.background ?? DEFAULT_BACKGROUND;
}

/**
 * The skin as it looks on the map with id `mapId` (Engine 0.16 part B, T7): its `themes` entry for
 * that map, if any, laid over it (`background` and `parallax` replaced, `tiles` replaced key by
 * key); the skin itself when there is none (or no map). A new object: the skin is never changed.
 * Pure.
 */
export function themedSkin<S extends DeepReadonly<SkinFile>>(skin: S, mapId: string | undefined): S {
  const themes = skin.themes;
  if (mapId === undefined || themes === undefined || !Object.hasOwn(themes, mapId)) return skin;
  const theme = themes[mapId]!;
  return {
    ...skin,
    ...(theme.background !== undefined && { background: theme.background }),
    ...(theme.parallax !== undefined && { parallax: theme.parallax }),
    ...(theme.tiles !== undefined && { tiles: { ...skin.tiles, ...theme.tiles } }),
    ...(theme.scene3d !== undefined && { scene3d: theme.scene3d }),
    ...(theme.scenery !== undefined && { scenery: theme.scenery }),
  };
}

/** A whole number written as text (`"42"`, `"-3"`), or null for anything else. */
function wholeNumber(text: string): number | null {
  return /^-?\d+$/.test(text) ? Number(text) : null;
}

/**
 * Whether a `byTag` look matches one tag (Engine 0.15, gap M2): a look with `tag` matches that
 * whole tag; one with `prefix` any tag that starts with it, and with `min` or `max` only one whose
 * rest is a whole number in that inclusive range (`{ prefix: "progress:", min: 50 }` matches
 * `progress:50` and `progress:99`, not `progress:49` or `progress:half`). Pure.
 */
export function skinTagMatches(look: DeepReadonly<SkinTagEntry>, tag: string): boolean {
  if (look.tag !== undefined) return tag === look.tag;
  if (look.prefix === undefined || !tag.startsWith(look.prefix)) return false;
  if (look.min === undefined && look.max === undefined) return true;
  const n = wholeNumber(tag.slice(look.prefix.length));
  if (n === null) return false;
  return (look.min === undefined || n >= look.min) && (look.max === undefined || n <= look.max);
}

/**
 * The index in `entry.byTag` of the look an entity with `tags` takes: the first look in file
 * order that matches any of its tags ({@link skinTagMatches}), or -1 (gaps G13, G30 and M2). The
 * list order is the only priority: a skin lists its looks from the most specific (a `progress:`
 * range before a plain `site`). Pure.
 */
export function skinTagIndex(
  entry: DeepReadonly<SkinKindEntry> | undefined,
  tags: readonly string[] | undefined,
): number {
  if (entry?.byTag === undefined || tags === undefined || tags.length === 0) return -1;
  return entry.byTag.findIndex((look) => tags.some((tag) => skinTagMatches(look, tag)));
}

/**
 * The kind entry a skin draws `entity` with (Engine 0.11, gaps G13 and G30; prefixes and values
 * Engine 0.15, gap M2): its kind's entry with the fields of the first `byTag` look that matches
 * one of the entity's tags laid over it (`frames` replace the kind's frames whole; the look's
 * `tag`, `prefix`, `min` and `max` are not carried), or the kind's entry as it is when no look
 * matches; undefined for a kind the skin does not list. Both backends pick through it, so a skin
 * without `byTag` draws as before. Pure.
 */
export function resolveSkinKind(
  skin: DeepReadonly<SkinFile>,
  entity: SkinEntityInput,
): DeepReadonly<SkinKindEntry> | undefined {
  const entry = Object.hasOwn(skin.kinds, entity.kind) ? skin.kinds[entity.kind] : undefined;
  const i = skinTagIndex(entry, entity.tags);
  if (entry === undefined || i < 0) return entry;
  const look: Record<string, unknown> = { ...entry.byTag![i]! };
  for (const field of TAG_MATCH_FIELDS) delete look[field];
  return { ...entry, ...look } as DeepReadonly<SkinKindEntry>;
}

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

// ---- Animation timing (Engine 0.16 T2) ----

/** A cycle as the timing reads it. */
type Cycle = DeepReadonly<SkinCycle>;

/** The most frame events {@link frameEventsBetween} gives for one entity at once. */
export const FRAME_EVENT_LIMIT = 16;

/**
 * Ticks frame `i` of a cycle shows: its `ticks` when that is one number, its entry in a per-frame
 * list (the list's last entry past its end, which `validate` reports as `bad_frame_ticks`), else
 * {@link DEFAULT_FRAME_TICKS}. Pure.
 */
export function cycleFrameTicks(c: Cycle, i: number): number {
  const ticks = c.ticks;
  if (ticks === undefined) return DEFAULT_FRAME_TICKS;
  if (typeof ticks === 'number') return ticks;
  return ticks[Math.min(i, ticks.length - 1)] ?? DEFAULT_FRAME_TICKS;
}

/** Ticks one pass through a cycle takes: every frame's ticks added up. Pure. */
export function cycleLength(c: Cycle): number {
  let sum = 0;
  for (let i = 0; i < c.frames.length; i++) sum += cycleFrameTicks(c, i);
  return sum;
}

/**
 * Which frame of a cycle shows at tick `t` of it: a looping cycle wraps, a one-shot (`loop:
 * false`) holds its last frame once `t` reaches its length, and is then `done`. Pure.
 */
export function cyclePosition(c: Cycle, t: number): { index: number; done: boolean } {
  const n = c.frames.length;
  const length = cycleLength(c);
  if (c.loop === false && t >= length) return { index: n - 1, done: true };
  let local = c.loop === false ? t : ((t % length) + length) % length;
  let i = 0;
  for (; i < n - 1; i++) {
    const d = cycleFrameTicks(c, i);
    if (local < d) break;
    local -= d;
  }
  return { index: i, done: false };
}

/**
 * One stretch of an entity's animation: a state's frame or cycle for its facing, from tick
 * `start` of the entity's state until `end` (Infinity for the last).
 */
interface AnimSegment {
  state: string;
  spec: string | Cycle;
  flipX: boolean;
  start: number;
  end: number;
}

/** The animation table an entry is drawn from: `poses` (meshes) on a 3D skin, else `frames`. */
function animTable(
  skin: DeepReadonly<SkinFile>,
  entry: DeepReadonly<SkinKindEntry>,
): DeepReadonly<Record<string, SkinStateFrames>> | undefined {
  return MESH_BACKENDS.includes(skin.backend) ? entry.poses : entry.frames;
}

/**
 * The stretches an entity's animation state plays, in order: its state (`idle` when it is not
 * listed, else the first), then, while a one-shot cycle with `then` finishes, the state it names,
 * from the tick the one-shot ended. A `then` back to a state already played holds instead, so the
 * list is finite.
 */
function animSegments(
  table: DeepReadonly<Record<string, SkinStateFrames>>,
  entity: Pick<DeepReadonly<PresentEntity>, 'facing' | 'anim'>,
  flipFacing: boolean,
): AnimSegment[] {
  const states = Object.keys(table);
  let state: string | undefined = Object.hasOwn(table, entity.anim.state)
    ? entity.anim.state
    : Object.hasOwn(table, 'idle')
      ? 'idle'
      : states[0];
  const out: AnimSegment[] = [];
  const played = new Set<string>();
  let start = 0;
  while (state !== undefined) {
    played.add(state);
    const picked = stateSpec(table[state]!, entity.facing, flipFacing);
    if (picked === undefined) break;
    const seg: AnimSegment = { state, ...picked, start, end: Infinity };
    out.push(seg);
    const c = picked.spec;
    if (typeof c === 'string' || c.loop !== false) break;
    const next = c.then;
    if (next === undefined || !Object.hasOwn(table, next) || played.has(next)) break;
    seg.end = start + cycleLength(c);
    start = seg.end;
    state = next;
  }
  return out;
}

/** The frame or cycle a state shows for `facing`, and whether it is drawn mirrored. */
function stateSpec(
  spec: DeepReadonly<SkinStateFrames>,
  facing: Facing,
  flipFacing: boolean,
): { spec: string | Cycle; flipX: boolean } | undefined {
  if (typeof spec === 'string') return { spec, flipX: flipFacing && facesLeft(facing) };
  if (spec.frames !== undefined) {
    return { spec: { ...spec, frames: spec.frames } as Cycle, flipX: flipFacing && facesLeft(facing) };
  }
  const picked = pickFacing(facing, (f) => spec[f] !== undefined, flipFacing);
  return picked === undefined ? undefined : { spec: spec[picked.facing]!, flipX: picked.flipX };
}

/** An entity's animation as a skin shows it now ({@link resolveSkinAnimation}). */
export interface SkinAnimation {
  /** The state shown: the entity's, else `idle`, else the first, or one a finished one-shot's `then` led to. */
  state: string;
  /** The frame name (2D) or mesh name (a 3D skin's `poses`). */
  frame: string;
  /** Its index in its cycle (0 for a single frame). */
  index: number;
  /** Ticks since the shown state began. */
  t: number;
  /** Draw it mirrored left to right (`flipFacing`). */
  flipX: boolean;
  /** The cycle's own `sheet` (2D, Engine 0.16 part B), when it names one: draw the frame from it. */
  sheet?: string;
}

/**
 * What a skin shows of an entity's animation at its `anim.t` (Engine 0.16 T2): the entry's
 * (its tag look's) `frames`, or on a 3D skin its `poses`; the state, falling back to `idle`, then
 * the first; the facing's frame or cycle (with the fallbacks of {@link resolveSkinFrame}); the
 * cycle's frame by per-frame timing (`ticks`, one number or one per frame), looping or, with
 * `loop: false`, held on the last frame, or once finished handing over to its `then` state, which
 * starts from the tick it finished. Undefined for an unlisted kind or an entry without that table.
 * Pure.
 */
export function resolveSkinAnimation(
  skin: DeepReadonly<SkinFile>,
  entity: SkinEntityInput & Pick<DeepReadonly<PresentEntity>, 'facing' | 'anim'>,
): SkinAnimation | undefined {
  const entry = resolveSkinKind(skin, entity);
  const table = entry === undefined ? undefined : animTable(skin, entry);
  if (entry === undefined || table === undefined) return undefined;
  const segments = animSegments(table, entity, entry.flipFacing === true);
  const t = entity.anim.t;
  const seg = segments.find((s) => t < s.end) ?? segments[segments.length - 1];
  if (seg === undefined) return undefined;
  const local = t - seg.start;
  if (typeof seg.spec === 'string') {
    return { state: seg.state, frame: seg.spec, index: 0, t: local, flipX: seg.flipX };
  }
  const { index } = cyclePosition(seg.spec, local);
  const out: SkinAnimation = {
    state: seg.state,
    frame: seg.spec.frames[index]!,
    index,
    t: local,
    flipX: seg.flipX,
  };
  if (seg.spec.sheet !== undefined) out.sheet = seg.spec.sheet;
  return out;
}

/** A frame event: a cycle's `events` entry whose frame started ({@link frameEventsBetween}). */
export interface SkinFrameEvent {
  /** The event type the skin names (`footstep`), looked up in the skin's `events` like a kit's. */
  type: string;
  /** The state whose cycle it is in. */
  state: string;
  /** The frame's index in that cycle. */
  index: number;
  /** The tick of the entity's state the frame started on. */
  t: number;
}

/**
 * The frame events of an entity whose state ran from tick `prevT` (not included) to `t` (included)
 * (Engine 0.16 T2): for every frame that started in that window, in time order, its cycle's
 * `events` entry, across a looping cycle's wraps and into a finished one-shot's `then` state, at
 * most {@link FRAME_EVENT_LIMIT}. A state that just began (its `t` 0) is asked from `prevT` -1, so
 * its first frame's event comes too. Backends turn these into presentation-only events
 * (never into the frame or the kit) and play them through the skin's `events`. Pure.
 */
export function frameEventsBetween(
  skin: DeepReadonly<SkinFile>,
  entity: SkinEntityInput & Pick<DeepReadonly<PresentEntity>, 'facing' | 'anim'>,
  prevT: number,
  t: number,
): SkinFrameEvent[] {
  const out: SkinFrameEvent[] = [];
  if (t <= prevT) return out;
  const entry = resolveSkinKind(skin, entity);
  const table = entry === undefined ? undefined : animTable(skin, entry);
  if (entry === undefined || table === undefined) return out;
  for (const seg of animSegments(table, entity, entry.flipFacing === true)) {
    if (seg.start > t) break;
    const c = seg.spec;
    if (typeof c === 'string' || c.events === undefined || seg.end <= prevT + 1) continue;
    const length = cycleLength(c);
    const offsets: number[] = [];
    for (let i = 0, at = 0; i < c.frames.length; at += cycleFrameTicks(c, i), i++) offsets.push(at);
    const laps = c.loop === false ? 1 : Infinity;
    const first = Math.max(0, Math.floor((prevT + 1 - seg.start) / length));
    for (let k = first; k < laps; k++) {
      const lap = seg.start + k * length;
      if (lap > t || lap >= seg.end) break;
      for (let i = 0; i < offsets.length; i++) {
        const at = lap + offsets[i]!;
        if (at <= prevT || at > t || at >= seg.end) continue;
        const type = Object.hasOwn(c.events, String(i)) ? c.events[String(i)] : undefined;
        if (type === undefined) continue;
        out.push({ type, state: seg.state, index: i, t: at });
        if (out.length >= FRAME_EVENT_LIMIT) return out;
      }
    }
  }
  return out;
}

/**
 * The mesh a 3D skin shows for an entity now: its `poses` frame ({@link resolveSkinAnimation})
 * when the entry has poses, else its `mesh`; undefined for an unlisted kind. Pure.
 */
export function resolveSkinMesh(
  skin: DeepReadonly<SkinFile>,
  entity: SkinEntityInput & Pick<DeepReadonly<PresentEntity>, 'facing' | 'anim'>,
): string | undefined {
  const entry = resolveSkinKind(skin, entity);
  if (entry === undefined) return undefined;
  if (entry.poses !== undefined) return resolveSkinAnimation(skin, entity)?.frame ?? entry.mesh;
  return entry.mesh;
}

/**
 * The frame to draw for `entity` with `skin`: its kind's entry, the frames of its animation state
 * (`idle` when the state is not listed, else the first state), the frame of a cycle at `anim.t`
 * ({@link resolveSkinAnimation}: per-frame timing, one-shots and `then`), and the facing's frame.
 * A facing the state gives no frame for falls back in turn: a left-hand
 * facing (`left`, `up-left`, `down-left`) uses its right-hand mirror flipped when the entry sets
 * `flipFacing`; a diagonal uses its horizontal part (`up-right` uses `right`, owner answer 128),
 * then that part's own fallback (mirrored `right` for `left`); then `down`, then the first given.
 * A cycle or frame for every facing flips for a left-hand facing under `flipFacing`. A kind the
 * skin does not list, or a mesh entry, gives a `fallbackColor` box. The entry is the kind's
 * as {@link resolveSkinKind} gives it: an entity with a tag a `byTag` look names is drawn with
 * that look's frames (and sheet, palette, colour), else with the kind's own. Pure.
 */
export function resolveSkinFrame(
  skin: DeepReadonly<SkinFile>,
  entity: SkinEntityInput & Pick<DeepReadonly<PresentEntity>, 'facing' | 'anim'>,
): SkinFrame {
  const defaults = skin.sheets;
  const entry = resolveSkinKind(skin, entity);
  const fallbackColor =
    entry?.fallbackColor ?? entry?.color ?? defaults?.fallbackColor ?? DEFAULT_FALLBACK_COLOR;
  const sheet = entry?.sheet ?? defaults?.sheet ?? null;
  const out: SkinFrame = { sheet, frame: null, flipX: false, fallbackColor };
  if (!entry || entry.mesh !== undefined || sheet === null) return out;
  const palette = entry.palette ?? defaults?.palette;
  if (palette !== undefined) out.palette = palette;
  if (entry.size) out.size = { ...entry.size };
  if (entry.offset) out.offset = { ...entry.offset };
  if (entry.frames === undefined || MESH_BACKENDS.includes(skin.backend)) return out;
  const anim = resolveSkinAnimation(skin, entity);
  if (anim !== undefined) {
    out.frame = anim.frame;
    out.flipX = anim.flipX;
    if (anim.sheet !== undefined) out.sheet = anim.sheet;
  }
  return out;
}

/**
 * The facing whose frame stands in for `want`, and whether to draw it mirrored (see
 * `resolveSkinFrame`), or undefined when `has` is false for every facing.
 */
function pickFacing(
  want: Facing,
  has: (f: Facing) => boolean,
  flipFacing: boolean,
): { facing: Facing; flipX: boolean } | undefined {
  const tries: Facing[] = [want];
  if (want !== cardinalFacing(want)) tries.push(cardinalFacing(want));
  for (const f of tries) {
    if (has(f)) return { facing: f, flipX: false };
    if (flipFacing && facesLeft(f) && has(mirrorFacing(f))) return { facing: mirrorFacing(f), flipX: true };
  }
  if (has('down')) return { facing: 'down', flipX: false };
  const first = FACINGS.find(has);
  return first === undefined ? undefined : { facing: first, flipX: false };
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
 * ground; not for an entry with a `model`, whose `scale` is px per model unit, so its stand-in
 * mesh is the box's size), and `offset` and `z` move the whole mesh. An entry with no `mesh` (a sprite entry), or
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

  // A model entry's `scale` is px per model unit, not the stand-in mesh's size factor.
  const scale = entry.model === undefined && 'scale' in entry ? (entry.scale ?? 1) : 1;
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

// ---- Reading models (Engine 0.16 T11) ----

/** A model point `{ x, y, z }` in model units, or a named anchor ({@link MODEL_ANCHORS}). */
export type ModelAnchor = ModelAnchorName | { x: number; y: number; z: number };

/** A kind's or tile's glTF model, every field resolved: what a 3D backend builds. */
export interface SkinModel {
  /** The asset path, `assets/<pack>/<file>.glb`. */
  model: string;
  /** Px per model unit. */
  scale: number;
  anchor: ModelAnchor;
  /** Degrees about x, y and z. */
  rotate: { x: number; y: number; z: number };
  castShadow: boolean;
  /** The clip to play now, or null (the model's rest pose). */
  clip: string | null;
  /** Seconds into the clip (looped by the backend, unless `hold`). */
  time: number;
  /** Play the clip once and hold its last pose (the entry's `clipHold` names the state; Engine 0.16 part B). */
  hold: boolean;
  /** Px right and down from the box (the entry's `offset`), and toward the camera (`z`). */
  offset: { x: number; y: number; z: number };
  /** Factors per axis on top of `scale` (Engine 0.16 part B; 1 each by default). */
  stretch: { x: number; y: number; z: number };
  /** A colour multiplied into the model's materials, or null (Engine 0.16 part B). */
  tint: string | null;
}

/**
 * The clip a model entry's `clip` gives for an animation state: one name for every state, else
 * the state's, else `idle`'s, else null. Pure.
 */
export function modelClipFor(clip: DeepReadonly<SkinKindEntry['clip']>, state: string): string | null {
  if (clip === undefined) return null;
  if (typeof clip === 'string') return clip;
  if (Object.hasOwn(clip, state)) return clip[state]!;
  return Object.hasOwn(clip, 'idle') ? clip['idle']! : null;
}

function modelOf(
  entry: DeepReadonly<SkinKindEntry | SkinTileEntry>,
  clip: string | null,
  time: number,
  hold = false,
): SkinModel | undefined {
  if (entry.model === undefined) return undefined;
  const offset = 'offset' in entry ? entry.offset : undefined;
  return {
    model: entry.model,
    scale: entry.scale ?? 1,
    anchor:
      entry.anchor === undefined
        ? DEFAULT_MODEL_ANCHOR
        : typeof entry.anchor === 'string'
          ? entry.anchor
          : { ...entry.anchor },
    rotate: { x: entry.rotate?.x ?? 0, y: entry.rotate?.y ?? 0, z: entry.rotate?.z ?? 0 },
    castShadow: entry.castShadow ?? false,
    clip,
    time,
    hold,
    offset: { x: offset?.x ?? 0, y: offset?.y ?? 0, z: entry.z ?? 0 },
    stretch: { x: entry.stretch?.x ?? 1, y: entry.stretch?.y ?? 1, z: entry.stretch?.z ?? 1 },
    tint: entry.tint ?? null,
  };
}

/**
 * A scenery row's model as a backend builds each copy (Engine 0.16 part B, T10): no clip, the
 * bounding box's bottom centre on the copy's spot. Pure.
 */
export function sceneryModel(row: DeepReadonly<SkinSceneryRow>): SkinModel {
  return {
    model: row.model,
    scale: row.scale ?? 1,
    anchor: DEFAULT_MODEL_ANCHOR,
    rotate: { x: row.rotate?.x ?? 0, y: row.rotate?.y ?? 0, z: row.rotate?.z ?? 0 },
    castShadow: row.castShadow ?? false,
    clip: null,
    time: 0,
    hold: false,
    offset: { x: 0, y: 0, z: 0 },
    stretch: { x: row.stretch?.x ?? 1, y: row.stretch?.y ?? 1, z: row.stretch?.z ?? 1 },
    tint: row.tint ?? null,
  };
}

/**
 * The glTF model a 3D skin shows for an entity now (Engine 0.16 T11): its kind's (or tag look's)
 * `model` with the clip for its `anim.state` ({@link modelClipFor}) at `anim.t` /
 * {@link MODEL_TICKS_PER_SECOND} seconds; undefined when the entry has no model. Pure.
 */
export function resolveSkinModel(
  skin: DeepReadonly<SkinFile>,
  entity: SkinEntityInput & DeepReadonly<Pick<PresentEntity, 'anim'>>,
): SkinModel | undefined {
  const entry = resolveSkinKind(skin, entity);
  if (entry === undefined) return undefined;
  const state = entity.anim.state;
  const hold = entry.clipHold?.includes(state) ?? false;
  return modelOf(entry, modelClipFor(entry.clip, state), entity.anim.t / MODEL_TICKS_PER_SECOND, hold);
}

/** A tile entry's model, its `clip` looped on the frame clock (`frame` / 60 seconds); undefined without one. Pure. */
export function resolveTileModel(entry: DeepReadonly<SkinTileEntry>, frame = 0): SkinModel | undefined {
  return modelOf(entry, entry.clip ?? null, frame / MODEL_TICKS_PER_SECOND);
}

/** One place a skin names a model: the entry's path (`kinds.torch`) and its clips by field path. */
export interface SkinModelUse {
  path: FieldPath;
  model: string;
  clips: { path: FieldPath; clip: string }[];
}

/**
 * Every model a skin names, in file order, with the clips each asks for: kinds (each kind, then
 * its tag looks; a look without its own `model` that gives `clip` is checked against the kind's),
 * tiles, scenery rows, then each theme's tiles and scenery (Engine 0.16 part B). Pure.
 */
export function skinModelUses(skin: DeepReadonly<SkinFile>): SkinModelUse[] {
  const out: SkinModelUse[] = [];
  const clipsOf = (at: FieldPath, clip: DeepReadonly<SkinKindEntry['clip']>) =>
    clip === undefined
      ? []
      : typeof clip === 'string'
        ? [{ path: [...at, 'clip'], clip }]
        : Object.entries(clip).map(([state, name]) => ({ path: [...at, 'clip', state], clip: name }));
  for (const [kind, entry] of Object.entries(skin.kinds)) {
    const at: FieldPath = ['kinds', kind];
    if (entry.model !== undefined) out.push({ path: at, model: entry.model, clips: clipsOf(at, entry.clip) });
    (entry.byTag ?? []).forEach((look, i) => {
      const model = look.model ?? entry.model;
      if (model === undefined || (look.model === undefined && look.clip === undefined)) return;
      const lookAt: FieldPath = [...at, 'byTag', i];
      out.push({
        path: lookAt,
        model,
        clips: clipsOf(lookAt, look.clip ?? (look.model ? undefined : entry.clip)),
      });
    });
  }
  const tilesOf = (base: FieldPath, tiles: DeepReadonly<SkinFile['tiles']>) => {
    for (const [tile, entry] of Object.entries(tiles ?? {})) {
      if (entry.model === undefined) continue;
      const at: FieldPath = [...base, tile];
      out.push({
        path: at,
        model: entry.model,
        clips: entry.clip === undefined ? [] : [{ path: [...at, 'clip'], clip: entry.clip }],
      });
    }
  };
  const sceneryOf = (base: FieldPath, rows: DeepReadonly<SkinFile['scenery']>) =>
    (rows ?? []).forEach((row, i) => out.push({ path: [...base, i], model: row.model, clips: [] }));
  tilesOf(['tiles'], skin.tiles);
  sceneryOf(['scenery'], skin.scenery);
  for (const [map, theme] of Object.entries(skin.themes ?? {})) {
    tilesOf(['themes', map, 'tiles'], theme.tiles);
    sceneryOf(['themes', map, 'scenery'], theme.scenery);
  }
  return out;
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
