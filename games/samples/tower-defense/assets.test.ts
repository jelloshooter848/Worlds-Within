import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isCc0, parseCredits } from '@engine/core/content/assets';
import { readPngSize } from '@engine/core/content/png';
import {
  PACK_16,
  PACK_24,
  ROAD_FRAMES,
  ROAD_SHEET,
  ROAD_SIZE,
  roadArt,
  roadFrame,
  SIDE_KEYS,
} from './tools/road-art';

// The Winding Road's CC0 art pack (Engine 0.16 part E, E7): Kenney's Tower Defense (top-down) in
// `assets/kenney-tower-defense/`, its credits, the sheet `tools/road-art.ts` makes from it, and
// the skin's frames against both. `validate` checks the credits and that every frame is inside
// its image; this file checks what it cannot see.

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`);
const PACK = 'assets/kenney-tower-defense';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface ImageSpec {
  image: string;
  frameSize?: { w: number; h: number };
  grid?: { cols: number; rows: number };
  frames?: Record<string, Rect & { anchor?: unknown }>;
}
const skin = JSON.parse(read('content/skins/canvas2d.json').toString('utf8')) as {
  images: Record<string, ImageSpec>;
  tiles: Record<string, { join?: { frames: Record<string, string> } }>;
};

describe('the Winding Road asset pack', () => {
  it('credits the one pack with its OpenGameArt source, Kenney and CC0', () => {
    const credits = parseCredits(read('assets/CREDITS.md').toString('utf8'));
    expect([...credits.keys()]).toEqual(['kenney-tower-defense']);
    const entry = credits.get('kenney-tower-defense')!;
    expect(entry.source).toMatch(/^https:\/\/opengameart\.org\//);
    expect(entry.author).toMatch(/Kenney/);
    expect(isCc0(entry.licence ?? '')).toBe(true);
    expect(read(`${PACK}/license.txt`).toString('utf8')).toMatch(/Creative Commons Zero, CC0/);
  });

  it('keeps only the files the skin and the sheet script use', () => {
    expect(readdirSync(`${ROOT}${PACK}`).sort()).toEqual([
      'license.txt',
      'road-art.png',
      'tilesheet-16.png',
      'tilesheet-24.png',
    ]);
    expect(Object.values(skin.images).map((i) => i.image)).toEqual([ROAD_SHEET, PACK_16]);
  });

  it("has the pack's sheets at 23 x 13 tiles of 16 and 24 px", () => {
    expect(readPngSize(read(PACK_16))).toEqual({ width: 23 * 16, height: 13 * 16 });
    expect(readPngSize(read(PACK_24))).toEqual({ width: 23 * 24, height: 13 * 24 });
    expect(skin.images.td16).toMatchObject({ frameSize: { w: 16, h: 16 }, grid: { cols: 23, rows: 13 } });
  });

  it('has the made sheet exactly as tools/road-art.ts makes it from the pack', () => {
    const made = roadArt(read(PACK_24), read(PACK_16));
    expect(readPngSize(made)).toEqual({ width: ROAD_SIZE.w, height: ROAD_SIZE.h });
    expect(Buffer.from(made).equals(read(ROAD_SHEET))).toBe(true);
  });

  it("names the made sheet's frames as the script lays them out, each inside the sheet", () => {
    expect(skin.images.road!.frames).toEqual(ROAD_FRAMES);
    for (const [name, f] of Object.entries(ROAD_FRAMES)) {
      expect(f.x + f.w <= ROAD_SIZE.w && f.y + f.h <= ROAD_SIZE.h, name).toBe(true);
    }
  });

  it('joins the road for every set of open sides', () => {
    const join = skin.tiles['#']!.join!.frames;
    for (const key of SIDE_KEYS.filter((k) => k !== '')) expect(join[key], key).toBe(roadFrame(key));
  });
});
