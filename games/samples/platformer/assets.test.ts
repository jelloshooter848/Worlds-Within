import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readGameFiles } from '@engine/core/node/game-files';
import { assetPacks, checkCredits, isCc0, parseCredits } from '@engine/core/content/assets';
import { readModelAsset } from '@engine/core/content/gltf';
import { dataUrlBytes, readPngSize } from '@engine/core/content/png';

// The CC0 packs in assets/ (Engine 0.16 part B, T4; credited in assets/CREDITS.md). No skin uses
// them yet, so `validate` only checks the credits: this also checks every file the skins will
// reach for is a readable PNG or a self-contained glTF 2.0 model.

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const FILES = readGameFiles(ROOT);
const ASSETS = Object.fromEntries(Object.entries(FILES).filter(([p]) => p.startsWith('assets/')));
const PACKS = [
  'kenney-pixel-platformer',
  'kenney-platformer-kit',
  'pixel-adventure-1',
  'quaternius-platformer',
];

describe("Hopper's Way asset packs", () => {
  it('has the four packs, each credited as CC0 with a source, author and file list', () => {
    expect(assetPacks(Object.keys(ASSETS))).toEqual(PACKS);
    expect(checkCredits(ASSETS, (p) => p)).toEqual([]);
    const credits = parseCredits(ASSETS['assets/CREDITS.md']!);
    for (const pack of PACKS) {
      const entry = credits.get(pack)!;
      expect(isCc0(entry.licence!), pack).toBe(true);
      expect(entry.source, pack).toMatch(/^https:\/\//);
    }
  });

  it('holds only PNG images, GLB models and the packs’ own licence and grid notes', () => {
    const other = Object.keys(ASSETS).filter(
      (p) => !/\.(png|glb)$/.test(p) && !/\/(license|tilesheet-[a-z]+)\.txt$/.test(p),
    );
    expect(other).toEqual(['assets/CREDITS.md']);
  });

  it('reads every PNG', () => {
    const pngs = Object.keys(ASSETS).filter((p) => p.endsWith('.png'));
    expect(pngs.length).toBeGreaterThan(80);
    for (const p of pngs) expect(readPngSize(dataUrlBytes(ASSETS[p]!)!), p).not.toBeNull();
  });

  it('reads every GLB as a self-contained glTF 2.0 model', () => {
    const models = Object.keys(ASSETS).filter((p) => p.endsWith('.glb'));
    expect(models.length).toBeGreaterThan(60);
    for (const p of models) {
      const read = readModelAsset(p, ASSETS[p]!);
      expect(read.ok ? '' : read.message, p).toBe('');
    }
  });

  it('keeps the animated player stand-in and enemies’ clips', () => {
    const clips = (p: string) => {
      const read = readModelAsset(p, ASSETS[p]!);
      return read.ok ? (read.json.animations ?? []).map((a) => a.name) : [];
    };
    expect(clips('assets/quaternius-platformer/character.glb')).toEqual(
      expect.arrayContaining(['Idle', 'Run', 'Jump', 'Death']),
    );
    expect(clips('assets/quaternius-platformer/enemy.glb')).toEqual(
      expect.arrayContaining(['Walk', 'Death']),
    );
  });
});
