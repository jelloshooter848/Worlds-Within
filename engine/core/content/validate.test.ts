import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { addGridIssues } from './text-grid';
import { dottedPath, formatErrors, jsonPointer, validate } from './validate';

const schema = z.strictObject({
  name: z.string(),
  stats: z.strictObject({ hp: z.number().int().min(1) }),
  tags: z.array(z.string()),
});

describe('validate', () => {
  it('returns the parsed value when the data is good', () => {
    const r = validate('hero.json', { name: 'a', stats: { hp: 3 }, tags: [] }, schema);
    expect(r).toEqual({ ok: true, value: { name: 'a', stats: { hp: 3 }, tags: [] }, errors: [] });
  });

  it('names the file and the exact field, dotted and as a JSON pointer', () => {
    const r = validate('games/x/hero.json', { name: 'a', stats: { hp: 0 }, tags: ['ok', 7] }, schema);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => [e.file, e.path, e.pointer, e.code])).toEqual([
      ['games/x/hero.json', 'stats.hp', '/stats/hp', 'too_small'],
      ['games/x/hero.json', 'tags.1', '/tags/1', 'invalid_type'],
    ]);
    expect(r.errors.every((e) => e.message.length > 0)).toBe(true);
  });

  it('reports each unknown key at its own path', () => {
    const r = validate('h.json', { name: 'a', stats: { hp: 1, mp: 2 }, tags: [], extra: 1 }, schema);
    expect(r.errors.map((e) => [e.path, e.code, e.message])).toEqual([
      ['stats.mp', 'unrecognized_keys', 'unknown field "mp"'],
      ['extra', 'unrecognized_keys', 'unknown field "extra"'],
    ]);
  });

  it('reports a wrong root type at the empty path', () => {
    const r = validate('h.json', 'nope', schema);
    expect(r.errors).toMatchObject([{ file: 'h.json', path: '', pointer: '', code: 'invalid_type' }]);
  });

  it('carries content codes, rows and columns from custom issues', () => {
    const grid = z
      .array(z.string())
      .superRefine((rows, ctx) => addGridIssues(ctx, rows, new Set('.#'), ['map']));
    const r = validate('room.json', ['#.#', '#?#'], grid);
    expect(r.errors).toEqual([
      {
        file: 'room.json',
        path: 'map.1',
        pointer: '/map/1',
        code: 'unknown_char',
        row: 1,
        col: 1,
        message: 'row 1, col 1: "?" is not in the legend',
      },
    ]);
  });

  it('is stable: the same input gives the same errors', () => {
    const bad = { name: 1, stats: {}, tags: 'x' };
    expect(validate('a.json', bad, schema)).toEqual(validate('a.json', bad, schema));
  });
});

describe('paths', () => {
  it('writes dotted paths, quoting keys that are not plain names', () => {
    expect(dottedPath(['frames', 'idle', 2])).toBe('frames.idle.2');
    expect(dottedPath(['legend', '#'])).toBe('legend["#"]');
    expect(dottedPath([])).toBe('');
  });

  it('writes JSON pointers with RFC 6901 escapes', () => {
    expect(jsonPointer(['frames', 'idle', 2])).toBe('/frames/idle/2');
    expect(jsonPointer(['a/b', 'c~d'])).toBe('/a~1b/c~0d');
    expect(jsonPointer([])).toBe('');
  });

  it('formats errors one per line', () => {
    const r = validate('h.json', { name: 'a', stats: { hp: 1 }, tags: [], x: 1 }, schema);
    expect(formatErrors(r.errors)).toBe('h.json: x: unknown field "x"');
    expect(formatErrors([{ ...r.errors[0]!, line: 4, path: '' }])).toBe(
      'h.json:4: (file): unknown field "x"',
    );
  });
});
