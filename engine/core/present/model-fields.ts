import { z } from 'zod';

/**
 * The glTF model fields a skin entry shares (Engine 0.16 T11; moved here in F3 so the decor
 * legend, `decor.ts`, writes models the same way a kind or tile does). Pure schemas.
 */

/** Where a model sits on its box when a skin gives no `anchor` (Engine 0.16 T11). */
export const DEFAULT_MODEL_ANCHOR = 'bottom';
/** Ticks per second of a model's animation clips: an entity's `anim.t` / 60 is the clip time. */
export const MODEL_TICKS_PER_SECOND = 60;
/** The named model anchors: the bounding box's bottom centre, its centre, or the model's origin. */
export const MODEL_ANCHORS = ['bottom', 'center', 'origin'] as const;
export type ModelAnchorName = (typeof MODEL_ANCHORS)[number];

export const modelPath = z
  .string()
  .regex(/^assets\/[^/]+\/[^/]+(?:\/[^/]+)*\.(?:glb|gltf)$/i, {
    message: 'a glTF model in a pack folder of the game\'s assets: "assets/<pack>/<file>.glb" (or .gltf)',
  })
  .describe(
    "3D: a glTF/GLB model, `assets/<pack>/<file>.glb` or `.gltf` relative to the game folder (Engine 0.16); the entry's `mesh` shows while it loads",
  );
export const modelAnchor = z
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
export const modelRotate = z
  .strictObject({
    x: z.number().exactOptional().describe('degrees about x'),
    y: z.number().exactOptional().describe('degrees about y (upright); 90 turns its front to the right'),
    z: z.number().exactOptional().describe('degrees about z'),
  })
  .describe('3D model: a turn applied before `scale` and `anchor`, in degrees (x, then y, then z)');
