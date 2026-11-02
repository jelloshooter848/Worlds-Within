import { describe, expect, it } from 'vitest';
import { parseContent } from '../content/kinds';
import { validate } from '../content/validate';
import { rasterizeToBuffer } from './pixelart';
import { DEFAULT_LEGEND, readSpriteText, spriteChar, spriteSchema } from './sprite-schema';

const kind = { name: 'sprite', description: 'test', schema: spriteSchema, readText: readSpriteText };

describe('spriteSchema (JSON form)', () => {
  it('maps the legend onto SpriteDef characters', () => {
    const file = {
      palette: 'hero',
      legend: { '.': 'clear', '#': 1, o: 11 },
      frames: { idle: ['.#.', '#o#'] },
    };
    const r = validate('hero.json', file, spriteSchema);
    expect(r).toEqual({ ok: true, value: { palette: 'hero', frames: { idle: ['.1.', '1b1'] } }, errors: [] });
  });

  it('uses the SpriteDef characters when there is no legend', () => {
    const r = validate('hero.json', { palette: 'p', frames: { a: ['.1', 'z.'] } }, spriteSchema);
    expect(r.ok && r.value.frames).toEqual({ a: ['.1', 'z.'] });
  });

  it('produces a SpriteDef the rasterizer draws', () => {
    const r = validate(
      'hero.json',
      { palette: 'p', legend: { '#': 1, ' ': 0 }, frames: { a: ['##'] } },
      spriteSchema,
    );
    // ' ' is not a legal legend key, so this is rejected first...
    expect(r.ok).toBe(false);
    const good = validate(
      'hero.json',
      { palette: 'p', legend: { '#': 1, _: 'clear' }, frames: { a: ['#_'] } },
      spriteSchema,
    );
    if (!good.ok) throw new Error('expected a good sprite');
    const buf = rasterizeToBuffer(good.value, ['#000000', '#ff0000']);
    expect([...buf.data.slice(0, 8)]).toEqual([255, 0, 0, 255, 0, 0, 0, 0]);
  });

  it('rejects a ragged row at the exact frame and row, with the column', () => {
    const r = validate(
      'art/hero.json',
      { palette: 'p', frames: { idle: ['11', '11'], walk: ['11', '1', '11'] } },
      spriteSchema,
    );
    expect(r.errors).toEqual([
      expect.objectContaining({
        file: 'art/hero.json',
        path: 'frames.walk.1',
        pointer: '/frames/walk/1',
        code: 'ragged_row',
        row: 1,
        col: 1,
      }),
    ]);
  });

  it('rejects a character missing from the legend', () => {
    const r = validate(
      'hero.json',
      { palette: 'p', legend: { '#': 1, '.': 'clear' }, frames: { a: ['#.', '.1'] } },
      spriteSchema,
    );
    expect(r.errors).toMatchObject([{ path: 'frames.a.1', code: 'unknown_char', row: 1, col: 1 }]);
  });

  it('rejects legend values out of range and bad legend keys', () => {
    const r = validate(
      'hero.json',
      { palette: 'p', legend: { '#': 36, ab: 1, x: 'red' }, frames: { a: ['#'] } },
      spriteSchema,
    );
    expect(r.errors.map((e) => e.path)).toEqual(['legend["#"]', 'legend.ab', 'legend.x']);
    expect(r.errors.map((e) => e.code)).toEqual(['too_big', 'bad_legend_key', 'invalid_union']);
    expect(r.errors[2]?.message).toBe('Invalid input: expected "clear", or expected number, received string');
  });

  it('rejects a missing palette, no frames and unknown fields', () => {
    expect(validate('h.json', { frames: { a: ['1'] } }, spriteSchema).errors).toMatchObject([
      { path: 'palette', code: 'invalid_type' },
    ]);
    expect(validate('h.json', { palette: 'p', frames: {} }, spriteSchema).errors).toMatchObject([
      { path: 'frames', code: 'no_frames' },
    ]);
    expect(
      validate('h.json', { palette: 'p', frames: { a: ['1'] }, size: 8 }, spriteSchema).errors,
    ).toMatchObject([{ path: 'size', code: 'unrecognized_keys' }]);
  });

  it('rejects an empty frame', () => {
    const r = validate('h.json', { palette: 'p', frames: { a: [] } }, spriteSchema);
    expect(r.errors).toMatchObject([{ path: 'frames.a', code: 'empty_grid' }]);
  });
});

describe('sprite text form', () => {
  const TEXT = [
    '; the hero',
    'palette hero',
    'legend . clear',
    'legend # 1',
    'legend o 11',
    '',
    'frame idle',
    '.#.',
    '#o#',
    '',
    'frame blink',
    '.#.',
    '###',
  ].join('\n');

  it('reads directives and frames into a SpriteDef', () => {
    const r = parseContent(kind, 'art/hero.txt', TEXT);
    expect(r).toEqual({
      ok: true,
      value: { palette: 'hero', frames: { idle: ['.1.', '1b1'], blink: ['.1.', '111'] } },
      errors: [],
    });
  });

  it('names the file, field, row, column and line of a bad pixel', () => {
    const r = parseContent(kind, 'art/hero.txt', TEXT.replace('###', '#x#'));
    expect(r.errors).toEqual([
      {
        file: 'art/hero.txt',
        path: 'frames.blink.1',
        pointer: '/frames/blink/1',
        code: 'unknown_char',
        row: 1,
        col: 1,
        line: 13,
        message: 'row 1, col 1: "x" is not in the legend',
      },
    ]);
  });

  it('points a bad legend value at its line', () => {
    const r = parseContent(kind, 'art/hero.txt', TEXT.replace('legend o 11', 'legend o 99'));
    expect(r.errors).toMatchObject([{ path: 'legend.o', line: 5 }]);
  });

  it('reports a ragged row with its line', () => {
    const r = parseContent(kind, 'art/hero.txt', TEXT.replace('#o#', '#o'));
    expect(r.errors).toMatchObject([{ path: 'frames.idle.1', code: 'ragged_row', row: 1, col: 2, line: 9 }]);
  });

  it('reports a missing palette', () => {
    const r = parseContent(kind, 'art/hero.txt', TEXT.replace('palette hero\n', ''));
    expect(r.errors).toMatchObject([{ file: 'art/hero.txt', path: 'palette', code: 'invalid_type' }]);
  });

  it('rejects rows outside a frame, unknown directives and duplicates, by line', () => {
    expect(readSpriteText('palette p\n##\n')).toMatchObject({
      ok: false,
      errors: [{ code: 'row_outside_frame', line: 2 }],
    });
    expect(readSpriteText('palette p\ncolour red\n')).toMatchObject({
      ok: false,
      errors: [{ code: 'unknown_directive', line: 2 }],
    });
    expect(readSpriteText('frame a\n1\n\nframe a\n1')).toMatchObject({
      ok: false,
      errors: [{ code: 'duplicate_frame', line: 4 }],
    });
    expect(readSpriteText('legend # 1\nlegend # 2')).toMatchObject({
      ok: false,
      errors: [{ code: 'duplicate_legend', line: 2 }],
    });
    const r = parseContent(kind, 'h.txt', 'palette p\nframe a\n1\n\n1');
    expect(r.errors).toMatchObject([{ file: 'h.txt', code: 'row_outside_frame', line: 5 }]);
  });

  it('handles Windows line endings', () => {
    expect(parseContent(kind, 'h.txt', TEXT.replaceAll('\n', '\r\n')).ok).toBe(true);
  });
});

describe('legend helpers', () => {
  it('maps values to SpriteDef characters', () => {
    expect([spriteChar('clear'), spriteChar(0), spriteChar(9), spriteChar(10), spriteChar(35)]).toEqual([
      '.',
      '0',
      '9',
      'a',
      'z',
    ]);
    expect(Object.keys(DEFAULT_LEGEND)).toHaveLength(37);
  });
});
