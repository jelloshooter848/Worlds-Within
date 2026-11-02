import { describe, expect, it } from 'vitest';
import { loadContent } from '../content/bundle';
import { kitContentKinds, mustLoad } from '../content/game-content';
import { contentSheets } from './content-sheets';

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
