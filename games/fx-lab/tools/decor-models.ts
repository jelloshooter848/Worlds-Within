import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeGltfEmbedded, lowPolyModel, type ModelPart } from '@engine/core/content/gltf';

/**
 * Makes the fx lab's decor models (Engine 0.16 F3): `assets/fx-lab-decor/*.gltf`, four original
 * low-poly pieces of scenery (own work, CC0; `assets/CREDITS.md`) for the ground view's decor
 * grid (`content/decor/meadow.txt`, `content/skins/ground.json`'s `decor`). Each is an embedded
 * `.gltf` (JSON text with its buffer as a base64 `data:` URI), so the pack stays text. Run it with
 *
 *     pnpm exec tsx games/fx-lab/tools/decor-models.ts
 *
 * Model units: about one unit tall, y up, standing on y = 0. Every number is written out and
 * `lowPolyModel` rounds what it works out, so the text is the same on every machine:
 * `fx-lab.test.ts` checks the committed files against this script.
 */

/** The models, by file name in `assets/fx-lab-decor/`. */
const MODELS: Record<string, ModelPart[]> = {
  // A round bush: two green lumps.
  'bush.gltf': [
    {
      name: 'bush',
      shape: 'octahedron',
      size: { x: 1, y: 0.7, z: 0.9 },
      at: { x: 0, y: 0.35, z: 0 },
      color: '#00a844',
    },
    {
      name: 'top',
      shape: 'octahedron',
      size: { x: 0.6, y: 0.5, z: 0.6 },
      at: { x: 0.15, y: 0.6, z: -0.1 },
      color: '#58d854',
    },
  ],
  // A pine: a trunk and two stacked cones (frustums narrowing to a point).
  'pine.gltf': [
    {
      name: 'trunk',
      shape: 'box',
      size: { x: 0.14, y: 0.3, z: 0.14 },
      at: { x: 0, y: 0.15, z: 0 },
      color: '#503000',
    },
    {
      name: 'low',
      shape: 'frustum',
      top: 0.05,
      size: { x: 0.8, y: 0.6, z: 0.8 },
      at: { x: 0, y: 0.55, z: 0 },
      color: '#005800',
    },
    {
      name: 'high',
      shape: 'frustum',
      top: 0.02,
      size: { x: 0.55, y: 0.5, z: 0.55 },
      at: { x: 0, y: 0.95, z: 0 },
      color: '#00a800',
    },
  ],
  // A tuft of flowers: a leaf mound and three blossoms.
  'flowers.gltf': [
    {
      name: 'leaves',
      shape: 'frustum',
      top: 0.5,
      size: { x: 0.8, y: 0.2, z: 0.8 },
      at: { x: 0, y: 0.1, z: 0 },
      color: '#00a800',
    },
    {
      name: 'red',
      shape: 'octahedron',
      size: { x: 0.22, y: 0.22, z: 0.22 },
      at: { x: -0.2, y: 0.3, z: 0.1 },
      color: '#f83800',
    },
    {
      name: 'gold',
      shape: 'octahedron',
      size: { x: 0.22, y: 0.22, z: 0.22 },
      at: { x: 0.2, y: 0.32, z: 0.05 },
      color: '#f8b800',
    },
    {
      name: 'white',
      shape: 'octahedron',
      size: { x: 0.2, y: 0.2, z: 0.2 },
      at: { x: 0, y: 0.34, z: -0.2 },
      color: '#fcfcfc',
    },
  ],
  // A stone: a flattened grey lump with a lighter cap.
  'stone.gltf': [
    {
      name: 'stone',
      shape: 'octahedron',
      size: { x: 1, y: 0.5, z: 0.8 },
      at: { x: 0, y: 0.25, z: 0 },
      color: '#7c7c7c',
    },
    {
      name: 'cap',
      shape: 'frustum',
      top: 0.4,
      size: { x: 0.5, y: 0.15, z: 0.4 },
      at: { x: 0.05, y: 0.42, z: 0 },
      color: '#bcbcbc',
    },
  ],
};

/** The pack folder the models go in, relative to the game folder. */
export const DECOR_PACK = 'assets/fx-lab-decor';

/** Every model's `.gltf` text, by its path relative to the game folder (`assets/fx-lab-decor/bush.gltf`). */
export function decorModels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [file, parts] of Object.entries(MODELS)) {
    const { json, bin } = lowPolyModel(parts, [], `Worlds Within fx-lab decor-models.ts`);
    out[`${DECOR_PACK}/${file}`] = encodeGltfEmbedded(json, bin);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [path, text] of Object.entries(decorModels())) {
    const out = fileURLToPath(new URL(`../${path}`, import.meta.url));
    writeFileSync(out, text);
    console.log(`wrote ${out}`);
  }
}
