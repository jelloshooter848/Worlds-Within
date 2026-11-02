/**
 * Asset pack manifest (`manifest.json` in a pack folder). Packs replace built-in sprite sheets
 * and sounds by id; they never contain code or level data, so they are safe to share.
 *
 * {
 *   "schema": 1,
 *   "name": "my-pack",
 *   "sprites": {
 *     "knight": { "image": "knight.png" },                     // same layout as the exported template
 *     "tiles": { "image": "tiles.png", "frames": { "ground": [0, 0, 16, 16] } }   // or explicit rects
 *   },
 *   "palettes": { "knight": ["#000", "#fff", ...] },             // recolour a built-in sheet instead
 *   "music": { "overworld": "overworld.ogg" },                  // audio files replace synthesized songs
 *   "sfx": { "jump-small": "jump.wav" }
 * }
 */
export interface PackManifest {
  schema: 1;
  name: string;
  author?: string;
  sprites?: Record<string, { image: string; frames?: Record<string, [number, number, number, number]> }>;
  palettes?: Record<string, string[]>;
  music?: Record<string, string>;
  sfx?: Record<string, string>;
}

export function validateManifest(m: unknown): m is PackManifest {
  if (!m || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  if (o.schema !== 1 || typeof o.name !== 'string' || !/^[\w-]{1,40}$/.test(o.name)) return false;
  for (const key of ['sprites', 'palettes', 'music', 'sfx']) {
    if (o[key] !== undefined && (typeof o[key] !== 'object' || o[key] === null)) return false;
  }
  return true;
}
