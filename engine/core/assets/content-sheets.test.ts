import { describe, expect, it } from 'vitest';
import { loadContent } from '../content/bundle';
import { kitContentKinds, mustLoad } from '../content/game-content';
import { contentPixelSheets, contentSheets } from './content-sheets';

const files = {
  'game.json': JSON.stringify({
    id: 'g',
    kit: 'none',
    content: { sprite: ['s/*.txt'], palette: ['p/*.json'] },
    start: { seed: 1 },
    headless: 'h.ts',
  }),
  'p/pal.json': JSON.stringify({ id: 'pal', colors: ['#000000', '#fcfcfc'] }),
  's/dots.txt': 'palette pal\nlegend . clear\nlegend w 1\n\nframe dot\nw.\n',
};

describe('contentSheets (gap G35)', () => {
  it("looks up the bundle's sprite files by name, and is null for any other id", () => {
    const sheets = contentSheets(mustLoad(loadContent(files, kitContentKinds([]))));
    expect(sheets('nope')).toBeNull();
    expect(sheets('dots')?.frames.has('dot')).toBe(true);
  });
});

describe('contentPixelSheets (gap G33)', () => {
  it('decodes a sprite file to RGBA pixels with frame rects, and is null for any other id or palette', () => {
    const pixels = contentPixelSheets(mustLoad(loadContent(files, kitContentKinds([]))));
    expect(pixels('nope')).toBeNull();
    expect(pixels('dots', 'nope')).toBeNull();
    const dots = pixels('dots')!;
    expect(dots.frames.get('dot')).toEqual({ x: 0, y: 0, w: 2, h: 1 });
    expect([...dots.data]).toEqual([252, 252, 252, 255, 0, 0, 0, 0]);
    expect(pixels('dots')).toBe(dots);
  });
});
