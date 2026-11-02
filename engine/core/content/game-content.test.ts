import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineKit } from '../kit';
import { loadContent } from './bundle';
import { contentArt, contentSfx, contentSongs, kitContentKinds, mustLoad } from './game-content';
import type { ContentKind } from './kinds';

const note: ContentKind = { name: 'note', description: 'a note', schema: z.strictObject({ id: z.string() }) };
const notes = defineKit({ name: 'notes', kinds: () => [note], rules: [] });
const again = defineKit({ name: 'again', kinds: () => [note], rules: [] });

const files = {
  'game.json': JSON.stringify({
    id: 'g',
    kit: 'notes',
    content: { sprite: ['s/*.txt'], palette: ['p/*.json'], sfx: ['x/*.json'], song: ['m/*.json'] },
    start: { seed: 1 },
    headless: 'h.ts',
  }),
  'p/pal.json': JSON.stringify({ id: 'pal', colors: ['#000000', '#fcfcfc'] }),
  's/dots.txt': 'palette pal\nlegend . clear\nlegend w 1\n\nframe dot\nw.\n',
  'x/beep.json': JSON.stringify({ id: 'beep', bpm: 240, pulse: 'l32 o5 c' }),
  'm/tune.json': JSON.stringify({ id: 'tune', bpm: 120, loop: true, pulse1: 'l8 o4 c' }),
};

describe('game content glue (gap G4)', () => {
  it("builds the engine's kinds plus each kit's", () => {
    const kinds = kitContentKinds([notes]);
    expect(kinds.has('note')).toBe(true);
    expect(kinds.has('sprite')).toBe(true);
    expect(() => kitContentKinds([notes, again])).toThrow(/note/);
  });

  it('reads art and sounds out of a bundle, and names every error', () => {
    const result = loadContent(files, kitContentKinds([notes]));
    const content = mustLoad(result, 'g');
    expect(Object.keys(contentArt(content).sprites)).toEqual(['dots']);
    expect(Object.keys(contentArt(content).palettes)).toEqual(['pal']);
    expect(contentSfx(content).map((s) => s.id)).toEqual(['beep']);
    expect(contentSongs(content).map((s) => s.id)).toEqual(['tune']);
    const bad = loadContent(
      { ...files, 'p/pal.json': JSON.stringify({ id: 'pal' }) },
      kitContentKinds([notes]),
    );
    expect(() => mustLoad(bad, 'g')).toThrow(/^g's content has errors:\n.*p\/pal\.json/);
  });
});
