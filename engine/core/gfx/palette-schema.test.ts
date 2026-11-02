import { describe, expect, it } from 'vitest';
import { validate } from '../content/validate';
import { paletteSchema } from './palette-schema';

describe('paletteSchema', () => {
  it('accepts #rgb and #rrggbb colours', () => {
    const r = validate('p.json', { id: 'p', colors: ['#000', '#fca044'] }, paletteSchema);
    expect(r.ok).toBe(true);
  });

  it('names the bad colour', () => {
    const r = validate('p.json', { id: 'p', colors: ['#000', 'red'] }, paletteSchema);
    expect(r.errors).toMatchObject([{ file: 'p.json', path: 'colors.1', code: 'invalid_format' }]);
  });

  it('allows at most 36 colours', () => {
    const r = validate('p.json', { id: 'p', colors: Array(37).fill('#000') }, paletteSchema);
    expect(r.errors[0]).toMatchObject({ path: 'colors', code: 'too_big' });
  });
});
