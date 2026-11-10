import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeGlb, lowPolyModel, type ModelClip, type ModelPart } from '@engine/core/content/gltf';

/**
 * Makes the fx lab's glTF model (Engine 0.16 T11): `assets/fx-lab-glb/brazier.glb`, an original
 * low-poly brazier (own work, CC0; `assets/CREDITS.md`) built here from a few flat-shaded parts,
 * so the lab's 3D skin shows a model without downloading anything. Run it with
 *
 *     pnpm exec tsx games/fx-lab/tools/brazier-model.ts
 *
 * Model units: about one unit tall, y up, the foot's bottom at y = 0 (the 3D skin's `scale` 18
 * makes it about 19 px tall on the torch's 16 x 16 box, anchored by its bottom). Parts: a foot, a pole,
 * a bowl widening upward with a grey rim, the coals, and a flame (an outer gold diamond with a
 * pale core, both glowing). One clip, `flicker` (0.6 s, looped): the flame squashes and
 * stretches and the core turns. Every number is written out and `lowPolyModel` rounds what it
 * works out, so the bytes are the same on every machine: `fx-lab.test.ts` checks the committed
 * file against this script.
 */

/** Where the model goes, relative to the game folder (what the 3D skin's `torch` kind names). */
export const BRAZIER_MODEL = 'assets/fx-lab-glb/brazier.glb';

/** The clip the torch plays (the 3D skin maps its `idle` state to it). */
export const BRAZIER_CLIP = 'flicker';

const PARTS: ModelPart[] = [
  {
    name: 'foot',
    shape: 'frustum',
    top: 0.5,
    size: { x: 0.36, y: 0.08, z: 0.3 },
    at: { x: 0, y: 0.04, z: 0 },
    color: '#503000',
  },
  {
    name: 'pole',
    shape: 'box',
    size: { x: 0.1, y: 0.5, z: 0.1 },
    at: { x: 0, y: 0.33, z: 0 },
    color: '#503000',
  },
  {
    name: 'bowl',
    shape: 'frustum',
    top: 1.6,
    size: { x: 0.3, y: 0.16, z: 0.3 },
    at: { x: 0, y: 0.66, z: 0 },
    color: '#7c7c7c',
  },
  {
    name: 'rim',
    shape: 'box',
    size: { x: 0.52, y: 0.04, z: 0.52 },
    at: { x: 0, y: 0.76, z: 0 },
    color: '#bcbcbc',
  },
  {
    name: 'coals',
    shape: 'frustum',
    top: 0.3,
    size: { x: 0.4, y: 0.08, z: 0.4 },
    at: { x: 0, y: 0.82, z: 0 },
    color: '#d82800',
    glow: true,
  },
  {
    name: 'flame',
    shape: 'octahedron',
    size: { x: 0.3, y: 0.42, z: 0.3 },
    at: { x: 0, y: 0.98, z: 0 },
    color: '#f8b800',
    glow: true,
  },
  {
    name: 'core',
    shape: 'octahedron',
    size: { x: 0.16, y: 0.26, z: 0.16 },
    at: { x: 0, y: -0.03, z: 0.07 },
    color: '#fce0a8',
    glow: true,
    parent: 'flame',
  },
];

/** A turn about y as a quaternion, at the quarter turns (written out: no trigonometry). */
const Y_TURN = {
  0: [0, 0, 0, 1],
  90: [0, 0.7071068, 0, 0.7071068],
  180: [0, 1, 0, 0],
  270: [0, 0.7071068, 0, -0.7071068],
  360: [0, 0, 0, -1],
} as const;

const CLIPS: ModelClip[] = [
  {
    name: BRAZIER_CLIP,
    tracks: [
      {
        node: 'flame',
        path: 'scale',
        times: [0, 0.15, 0.3, 0.45, 0.6],
        values: [
          [1, 1, 1],
          [1.12, 0.84, 1.12],
          [0.9, 1.18, 0.9],
          [1.06, 0.94, 1.06],
          [1, 1, 1],
        ],
      },
      {
        node: 'core',
        path: 'rotation',
        times: [0, 0.15, 0.3, 0.45, 0.6],
        values: [[...Y_TURN[0]], [...Y_TURN[90]], [...Y_TURN[180]], [...Y_TURN[270]], [...Y_TURN[360]]],
      },
    ],
  },
];

/** The model's GLB bytes. */
export function brazierGlb(): Uint8Array {
  const { json, bin } = lowPolyModel(PARTS, CLIPS, 'Worlds Within fx-lab brazier-model.ts');
  return encodeGlb(json, bin);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = fileURLToPath(new URL(`../${BRAZIER_MODEL}`, import.meta.url));
  writeFileSync(out, brazierGlb());
  console.log(`wrote ${out}`);
}
