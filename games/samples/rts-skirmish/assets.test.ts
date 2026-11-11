import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCredits, isCc0 } from '@engine/core/content/assets';
import { readPngSize } from '@engine/core/content/png';
import { FORD_FRAMES, FORD_SHEET, FORD_SIZE, PACK_SHEET, fordTiles } from './tools/ford-tiles';

// The River Ford's CC0 art pack (Engine 0.16 part D, D7): Kenney's Medieval RTS in
// `assets/kenney-medieval-rts/`, its credits, the sheet `tools/ford-tiles.ts` makes from it, and
// the skin's frames against the pack's own atlas. `validate` checks the credits and that every
// frame is inside its image; this file checks what it cannot see.

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`);
const PACK = 'assets/kenney-medieval-rts';

interface ImageSpec {
  image: string;
  frames: Record<string, { x: number; y: number; w: number; h: number; anchor?: unknown }>;
}
const skin = JSON.parse(read('content/skins/canvas2d.json').toString('utf8')) as {
  images: Record<string, ImageSpec>;
};

describe('the River Ford asset pack', () => {
  it('credits the one pack with its OpenGameArt source, Kenney and CC0', () => {
    const credits = parseCredits(read('assets/CREDITS.md').toString('utf8'));
    expect([...credits.keys()]).toEqual(['kenney-medieval-rts']);
    const entry = credits.get('kenney-medieval-rts')!;
    expect(entry.source).toMatch(/^https:\/\/opengameart\.org\//);
    expect(entry.author).toMatch(/Kenney/);
    expect(isCc0(entry.licence ?? '')).toBe(true);
    expect(read(`${PACK}/license.txt`).toString('utf8')).toMatch(/Creative Commons Zero, CC0/);
  });

  it('keeps only the files the skin and the sheet script use', () => {
    expect(readdirSync(`${ROOT}${PACK}`).sort()).toEqual([
      'ford-tiles.png',
      'license.txt',
      'medieval-rts-sheet-atlas.txt',
      'medieval-rts-sheet.png',
    ]);
    expect(Object.values(skin.images).map((i) => i.image)).toEqual([PACK_SHEET, FORD_SHEET]);
  });

  it('has the made sheet exactly as tools/ford-tiles.ts makes it from the pack', () => {
    const made = fordTiles(read(PACK_SHEET));
    expect(readPngSize(made)).toEqual({ width: FORD_SIZE.w, height: FORD_SIZE.h });
    expect(Buffer.from(made).equals(read(FORD_SHEET))).toBe(true);
  });

  it("names the made sheet's frames as the script lays them out", () => {
    expect(skin.images.ford!.frames).toEqual(FORD_FRAMES);
  });

  it("cuts every unit and building frame on one of the pack's own sprites (its atlas)", () => {
    const atlas = [
      ...read(`${PACK}/medieval-rts-sheet-atlas.txt`)
        .toString('utf8')
        .matchAll(/name="([^"]+)" x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g),
    ].map((m) => ({ name: m[1]!, x: +m[2]!, y: +m[3]!, w: +m[4]!, h: +m[5]! }));
    expect(atlas).toHaveLength(126);
    for (const [name, f] of Object.entries(skin.images.rts!.frames)) {
      const hit = atlas.find((a) => a.x === f.x && a.y === f.y && a.w === f.w && a.h === f.h);
      expect(hit, name).toBeDefined();
    }
  });
});
