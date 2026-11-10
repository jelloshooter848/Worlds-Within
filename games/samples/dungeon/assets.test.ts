import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readGameFiles } from '@engine/core/node/game-files';
import { assetPacks, checkCredits, isCc0, parseCredits } from '@engine/core/content/assets';
import { dataUrlBytes, readPngSize } from '@engine/core/content/png';

// The CC0 pack in assets/ (Engine 0.16 part C, T2; credited in assets/CREDITS.md): 0x72's
// DungeonTileset II. No skin uses it yet, so `validate` only checks the credits: this also checks
// the PNGs read with their expected sizes, every frame of the pack's tile list lies inside its
// sheet, the frames the art pass will reach for are there, and the folder stays small.

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const FILES = readGameFiles(ROOT);
const ASSETS = Object.fromEntries(Object.entries(FILES).filter(([p]) => p.startsWith('assets/')));
const PACK = 'assets/dungeon-tileset-ii';

/** Every PNG of the pack and its size in pixels. */
const SIZES: Record<string, [number, number]> = {
  [`${PACK}/sheet.png`]: [512, 512],
  [`${PACK}/atlas-floor-16x16.png`]: [112, 112],
  [`${PACK}/atlas-walls-low-16x16.png`]: [192, 64],
  [`${PACK}/atlas-walls-high-16x32.png`]: [384, 128],
};

/** The tile list's frames: name -> [x, y, w, h] in `sheet.png`. */
function tileList(): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const line of ASSETS[`${PACK}/tile-list.txt`]!.split('\n')) {
    if (line.trim() === '') continue;
    const [name, ...rest] = line.trim().split(/\s+/);
    out.set(name!, rest.map(Number));
  }
  return out;
}

/** Frames the art pass (part C, T3-T9) will use: one of each thing the task lists. */
const NEEDED = [
  'floor_1',
  'wall_mid',
  'wall_top_mid',
  'wall_left',
  'wall_right',
  'doors_leaf_closed',
  'doors_leaf_open',
  'chest_full_open_anim_f0',
  'chest_empty_open_anim_f2',
  'wall_fountain_mid_blue_anim_f0',
  'wall_banner_red',
  'floor_spikes_anim_f0',
  'knight_m_idle_anim_f0',
  'knight_m_run_anim_f3',
  'knight_m_hit_anim_f0',
  'imp_run_anim_f0',
  'skelet_run_anim_f0',
  'orc_warrior_run_anim_f0',
  'masked_orc_run_anim_f0',
  'big_demon_idle_anim_f0',
  'big_demon_run_anim_f3',
  'ogre_run_anim_f0',
  'weapon_knight_sword',
  'ui_heart_full',
  'ui_heart_half',
  'ui_heart_empty',
  'flask_red',
  'coin_anim_f0',
  'bomb_f0',
];

describe("The Old Crypt's asset pack", () => {
  it('has the one pack, credited as CC0 with a source and an author', () => {
    expect(assetPacks(Object.keys(ASSETS))).toEqual(['dungeon-tileset-ii']);
    expect(checkCredits(ASSETS, (p) => p)).toEqual([]);
    const entry = parseCredits(ASSETS['assets/CREDITS.md']!).get('dungeon-tileset-ii')!;
    expect(isCc0(entry.licence!)).toBe(true);
    expect(entry.source).toMatch(/^https:\/\/0x72\.itch\.io\//);
    expect(entry.author).toBe('0x72');
  });

  it('holds only the four PNGs, the tile list and the readme', () => {
    expect(Object.keys(ASSETS).sort()).toEqual(
      ['assets/CREDITS.md', ...Object.keys(SIZES), `${PACK}/readme.txt`, `${PACK}/tile-list.txt`].sort(),
    );
  });

  it('reads every PNG at its size', () => {
    for (const [p, [width, height]] of Object.entries(SIZES)) {
      expect(readPngSize(dataUrlBytes(ASSETS[p]!)!), p).toEqual({ width, height });
    }
  });

  it('keeps every tile-list frame inside the sheet, with the frames the art pass needs', () => {
    const frames = tileList();
    expect(frames.size).toBeGreaterThan(300);
    for (const [name, rect] of frames) {
      const [x, y, w, h] = rect;
      expect(rect.length, name).toBe(4);
      expect(w! > 0 && h! > 0 && x! >= 0 && y! >= 0, name).toBe(true);
      expect(x! + w! <= 512 && y! + h! <= 512, name).toBe(true);
    }
    expect(NEEDED.filter((n) => !frames.has(n))).toEqual([]);
  });

  it('stays small (well under the platformer’s 1.8 MB)', () => {
    let bytes = 0;
    for (const [p, text] of Object.entries(ASSETS)) {
      bytes += p.endsWith('.png') ? dataUrlBytes(text)!.length : text.length;
    }
    expect(bytes).toBeLessThan(100_000);
  });
});
