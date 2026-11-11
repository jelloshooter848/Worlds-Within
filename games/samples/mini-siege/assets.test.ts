import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ModelLibrary } from '@engine/backends/three';
import { readGameFiles } from '@engine/core/node/game-files';
import { assetPacks, checkCredits, isCc0, parseCredits } from '@engine/core/content/assets';
import { gltfExternalRefs, readModelAsset } from '@engine/core/content/gltf';
import { dataUrlBytes } from '@engine/core/content/png';
import { markModels } from './tools/mark-models';

// The CC0 low-poly packs in assets/ (Engine 0.16 part F, F1; credited in assets/CREDITS.md) that
// the siege map in 3D is built from (the `three` skin, F6), and the game's own markers
// (`mini-siege-marks`, made by `tools/mark-models.ts`). `validate` checks the credits and every
// model a skin names; this checks every model is a self-contained glTF 2.0 file that three's
// GLTFLoader parses in Node (ModelLibrary, as the page and the screenshot tool load it), and lists
// its clips.

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const FILES = readGameFiles(ROOT);
const ASSETS = Object.fromEntries(Object.entries(FILES).filter(([p]) => p.startsWith('assets/')));
const MODELS = Object.keys(ASSETS)
  .filter((p) => p.endsWith('.glb') || p.endsWith('.gltf'))
  .sort();
const PACKS = [
  'kenney-castle-kit',
  'kenney-nature-kit',
  'mini-siege-marks',
  'quaternius-characters',
  'quaternius-farm-animals',
  'quaternius-medieval-village',
];
/** The clips every character keeps (assets/CREDITS.md: Defeat stands in for a death, Punch for an attack). */
const CHARACTER_CLIPS = ['Defeat', 'Idle', 'PickUp', 'Punch', 'RecieveHit', 'Victory', 'Walk', 'Walk_Carry'];

describe('mini siege asset packs', () => {
  it('has the five packs and the marks, each credited as CC0 with a source and an author', () => {
    expect(assetPacks(Object.keys(ASSETS))).toEqual(PACKS);
    expect(checkCredits(ASSETS, (p) => p)).toEqual([]);
    const credits = parseCredits(ASSETS['assets/CREDITS.md']!);
    for (const pack of PACKS) {
      const entry = credits.get(pack)!;
      expect(isCc0(entry.licence!), pack).toBe(true);
      expect(entry.source, pack).toMatch(pack === 'mini-siege-marks' ? /mark-models\.ts/ : /^https:\/\//);
      expect(entry.author, pack).toBeTruthy();
    }
  });

  it('holds only GLB models, the packs’ own licence files and the marks the script makes', () => {
    const other = Object.keys(ASSETS).filter((p) => !p.endsWith('.glb') && !/\/license\.txt$/.test(p));
    expect(other.sort()).toEqual(['assets/CREDITS.md', ...Object.keys(markModels())].sort());
    // The marks are text, exactly what `tools/mark-models.ts` writes.
    for (const [path, text] of Object.entries(markModels())) {
      const read = readModelAsset(path, ASSETS[path]!);
      expect(read.ok, path).toBe(true);
      expect(new TextDecoder().decode(dataUrlBytes(ASSETS[path]!) ?? new Uint8Array()), path).toBe(text);
    }
  });

  it('keeps every model self-contained, without textures, and the packs under 10 MB', () => {
    expect(MODELS.length).toBeGreaterThan(200);
    let bytes = 0;
    for (const p of MODELS) {
      const read = readModelAsset(p, ASSETS[p]!);
      expect(read.ok ? '' : read.message, p).toBe('');
      if (!read.ok) continue;
      expect(gltfExternalRefs(read.json), p).toBeNull();
      expect(read.json['images'] ?? [], p).toEqual([]);
      bytes += dataUrlBytes(ASSETS[p]!)!.length;
    }
    expect(bytes).toBeLessThan(10_000_000);
  });

  it('parses every GLB with ModelLibrary in Node and lists its clips', async () => {
    const lib = new ModelLibrary(ASSETS);
    const clips: Record<string, string[]> = {};
    for (const p of MODELS) {
      const model = await lib.load(p);
      expect(lib.error(p) ?? '', p).toBe('');
      expect(lib.status(p), p).toBe('ready');
      let vertices = 0;
      model!.scene.traverse((o) => {
        const mesh = o as { isMesh?: boolean; geometry?: { attributes: { position?: { count: number } } } };
        if (mesh.isMesh) vertices += mesh.geometry!.attributes.position?.count ?? 0;
      });
      expect(vertices, p).toBeGreaterThan(0);
      const names = model!.clips.map((c) => c.name).sort();
      if (names.length > 0) clips[p] = names;
    }
    const characters = MODELS.filter((p) => p.startsWith('assets/quaternius-characters/'));
    expect(characters).toEqual([
      'assets/quaternius-characters/knight-golden-male.glb',
      'assets/quaternius-characters/knight-male.glb',
      'assets/quaternius-characters/viking-male.glb',
      'assets/quaternius-characters/worker-male.glb',
    ]);
    // Only the characters and the sheep are animated; the buildings, engines and nature are static.
    expect(clips).toEqual({
      ...Object.fromEntries(characters.map((p) => [p, CHARACTER_CLIPS])),
      'assets/quaternius-farm-animals/sheep.glb': ['Idle', 'Jump'],
    });
    lib.dispose();
  });
});
