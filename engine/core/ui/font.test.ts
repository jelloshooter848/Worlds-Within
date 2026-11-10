import { describe, expect, it } from 'vitest';
import { parseContent } from '../content/kinds';
import { validate } from '../content/validate';
import {
  buildFont,
  FONT_KIND,
  fontSchema,
  glyphRuns,
  missingGlyphs,
  readFontText,
  type FontFile,
} from './font';

/** A tiny inline font: `H`, `i` (its own advance) and `1` on a 4x6 cell. */
const TEXT = [
  '; a test font',
  'cell 4 6',
  'baseline 5',
  'spacing 1',
  'space 2',
  'kern Hi -1',
  '',
  'glyph H',
  '#..#',
  '#..#',
  '####',
  '#..#',
  '#..#',
  '....',
  '',
  'glyph i advance 2',
  '#',
  '.',
  '#',
  '#',
  '#',
  '.',
  '',
  'glyph 1',
  '.#.',
  '##.',
  '.#.',
  '.#.',
  '###',
  '...',
].join('\n');

/** The checked font file the text form reads into (throws when it does not pass). */
function fontFile(text: string): FontFile {
  const r = parseContent(FONT_KIND, 'fonts/t.txt', text);
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('; '));
  return r.value;
}

describe('font files (Engine 0.16 T6)', () => {
  it('reads the text form into the JSON shape, which the schema passes', () => {
    const file = fontFile(TEXT);
    expect(file).toMatchObject({
      cell: { w: 4, h: 6 },
      baseline: 5,
      spacing: 1,
      space: 2,
      kerning: { Hi: -1 },
    });
    expect(file.glyphs['i']).toEqual({ rows: ['#', '.', '#', '#', '#', '.'], advance: 2 });
  });

  it('builds a font with defaults, advances and ink runs', () => {
    const file = fontFile(TEXT);
    const font = buildFont('t', file);
    expect(font.line).toBe(8);
    expect(font.glyphs.get('H')).toMatchObject({ w: 4, h: 6, advance: 5 });
    expect(font.glyphs.get('i')?.advance).toBe(2);
    expect(font.glyphs.get('1')?.advance).toBe(4);
    expect(font.kerning.get('Hi')).toBe(-1);
    const bare = buildFont('b', { cell: { w: 5, h: 2 }, baseline: 2, glyphs: {} });
    expect(bare).toMatchObject({ spacing: 1, space: 3, line: 4 });
    expect(glyphRuns(['#.##', '....', '####'])).toEqual([
      { x: 0, y: 0, w: 1 },
      { x: 2, y: 0, w: 2 },
      { x: 0, y: 2, w: 4 },
    ]);
  });

  it('reports bad glyphs at their field, with codes', () => {
    const bad = {
      cell: { w: 3, h: 2 },
      baseline: 3,
      glyphs: {
        A: { rows: ['#.#'] },
        B: { rows: ['##', '###'] },
        C: { rows: ['####', '####'] },
        D: { rows: ['#x', '..'] },
        ab: { rows: ['#', '#'] },
      },
      kerning: { ABC: 1 },
    };
    const r = validate('f.json', bad, fontSchema);
    expect(r.ok).toBe(false);
    const got = r.errors.map((e) => [e.path, e.code]);
    expect(got).toEqual(
      expect.arrayContaining([
        ['baseline', 'bad_font'],
        ['glyphs.A.rows', 'bad_glyph'],
        ['glyphs.B.rows.1', 'ragged_row'],
        ['glyphs.C.rows.0', 'bad_glyph'],
        ['glyphs.D.rows.0', 'invalid_format'],
        ['glyphs.ab', 'bad_glyph'],
        ['kerning.ABC', 'bad_kerning'],
      ]),
    );
  });

  it('names the line of a text-form problem', () => {
    const r = parseContent(
      FONT_KIND,
      'f.txt',
      'cell 2 1\nbaseline 1\nglyph A\n#.\nglyph A\n##\nwhat now\n..\n',
    );
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => [e.code, e.line])).toEqual([
      ['duplicate_glyph', 5],
      ['unknown_directive', 7],
      ['row_outside_glyph', 8],
    ]);
    const rows = parseContent(FONT_KIND, 'f.txt', 'cell 2 2\nbaseline 1\nglyph A\n#.\n');
    expect(rows.errors[0]).toMatchObject({ path: 'glyphs.A.rows', code: 'bad_glyph', line: 3 });
    expect(readFontText('cell two 1').ok).toBe(false);
  });

  it('lists the characters a font lacks, once each, ignoring spaces', () => {
    expect(missingGlyphs(new Set(['H', 'i']), 'Hi there, Hi!')).toEqual(['t', 'h', 'e', 'r', ',', '!']);
    expect(missingGlyphs(new Set(['a']), ' a \n a')).toEqual([]);
  });
});
