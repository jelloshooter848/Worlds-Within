import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeGltfEmbedded, lowPolyModel, type ModelPart } from '@engine/core/content/gltf';

/**
 * Makes the mini siege's own marker models (Engine 0.16 F6): `assets/mini-siege-marks/*.gltf`,
 * original low-poly pieces (own work, CC0; `assets/CREDITS.md`) the packs lack: the glowing gem
 * that marks an offered mission over its target and the raiders' red banner. Each is an embedded
 * `.gltf` (JSON text with its buffer as a base64 `data:` URI), so the pack stays text. Run it with
 *
 *     pnpm exec tsx games/samples/mini-siege/tools/mark-models.ts
 *
 * Model units: about one unit tall, y up, standing on y = 0. `assets.test.ts` checks the
 * committed files against this script.
 */

/** The models, by file name in `assets/mini-siege-marks/`. */
const MODELS: Record<string, ModelPart[]> = {
  // A gem: a tall golden octahedron lit from within, with a paler core, standing on its point.
  'offer-gem.gltf': [
    {
      name: 'gem',
      shape: 'octahedron',
      size: { x: 0.56, y: 1, z: 0.56 },
      at: { x: 0, y: 0.5, z: 0 },
      color: '#f8c838',
      glow: true,
    },
    {
      name: 'core',
      shape: 'octahedron',
      size: { x: 0.3, y: 0.6, z: 0.3 },
      at: { x: 0.08, y: 0.55, z: 0.08 },
      color: '#fcf0b0',
      glow: true,
    },
  ],
  // The raiders' banner: a pole with a crossbar, a long red cloth and a gold tip.
  'raider-banner.gltf': [
    {
      name: 'pole',
      shape: 'box',
      size: { x: 0.06, y: 1.6, z: 0.06 },
      at: { x: 0, y: 0.8, z: 0 },
      color: '#5c3a20',
    },
    {
      name: 'bar',
      shape: 'box',
      size: { x: 0.5, y: 0.05, z: 0.05 },
      at: { x: 0.22, y: 1.5, z: 0 },
      color: '#5c3a20',
    },
    {
      name: 'cloth',
      shape: 'box',
      size: { x: 0.42, y: 0.8, z: 0.03 },
      at: { x: 0.25, y: 1.08, z: 0 },
      color: '#c02018',
    },
    {
      name: 'tail',
      shape: 'frustum',
      top: 0,
      size: { x: 0.42, y: 0.18, z: 0.03 },
      at: { x: 0.25, y: 0.6, z: 0 },
      color: '#c02018',
    },
    {
      name: 'tip',
      shape: 'octahedron',
      size: { x: 0.12, y: 0.18, z: 0.12 },
      at: { x: 0, y: 1.66, z: 0 },
      color: '#e8b830',
    },
  ],
};

/** The pack folder the models go in, relative to the game folder. */
export const MARKS_PACK = 'assets/mini-siege-marks';

/** Every model's `.gltf` text, by its path relative to the game folder. */
export function markModels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [file, parts] of Object.entries(MODELS)) {
    const { json, bin } = lowPolyModel(parts, [], 'Worlds Within mini-siege mark-models.ts');
    out[`${MARKS_PACK}/${file}`] = encodeGltfEmbedded(json, bin);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [path, text] of Object.entries(markModels())) {
    const out = fileURLToPath(new URL(`../${path}`, import.meta.url));
    writeFileSync(out, text);
    console.log(`wrote ${out}`);
  }
}
