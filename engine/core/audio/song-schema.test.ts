import { describe, expect, it } from 'vitest';
import { validate } from '../content/validate';
import { sfxSchema, songSchema } from './song-schema';

const GOOD = { id: 'tune', bpm: 120, loop: true, pulse1: 'o4 l8 c e g', noise: 'l8 k h s h' };

describe('songSchema', () => {
  it('accepts a good song and returns the Song shape', () => {
    expect(validate('songs/tune.json', GOOD, songSchema)).toEqual({ ok: true, value: GOOD, errors: [] });
  });

  it('names the file and field for a wrong type', () => {
    const r = validate('songs/tune.json', { ...GOOD, bpm: 'fast' }, songSchema);
    expect(r.errors).toMatchObject([
      { file: 'songs/tune.json', path: 'bpm', pointer: '/bpm', code: 'invalid_type' },
    ]);
  });

  it('names a missing field', () => {
    const { loop: _loop, ...noLoop } = GOOD;
    const r = validate('songs/tune.json', noLoop, songSchema);
    expect(r.errors.map((e) => [e.path, e.code])).toEqual([['loop', 'invalid_type']]);
  });

  it('rejects a misspelled channel at its own path', () => {
    const r = validate('songs/tune.json', { ...GOOD, pluse2: 'c d e' }, songSchema);
    expect(r.errors.map((e) => [e.path, e.code])).toEqual([['pluse2', 'unrecognized_keys']]);
  });

  it('reports MML that does not compile on that channel, with the position', () => {
    const r = validate('songs/tune.json', { ...GOOD, triangle: 'o3 c d z e' }, songSchema);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({
      file: 'songs/tune.json',
      path: 'triangle',
      code: 'invalid_mml',
      col: 7,
    });
    expect(r.errors[0]?.message).toContain('unexpected "z"');
  });

  it('compiles each channel as its own kind (no pitched notes on noise)', () => {
    const r = validate('songs/tune.json', { ...GOOD, noise: 'c d e' }, songSchema);
    expect(r.errors.map((e) => [e.path, e.code])).toEqual([['noise', 'invalid_mml']]);
  });

  it('reports every broken channel', () => {
    const r = validate('s.json', { ...GOOD, pulse1: '[c d', pulse2: 'v99 c' }, songSchema);
    expect(r.errors.map((e) => e.path)).toEqual(['pulse1', 'pulse2']);
  });

  it('needs at least one channel', () => {
    const r = validate('s.json', { id: 'x', bpm: 100, loop: false }, songSchema);
    expect(r.errors).toMatchObject([{ path: '', code: 'no_channels' }]);
  });

  it('rejects an empty id and a tempo out of range', () => {
    const r = validate('s.json', { ...GOOD, id: '', bpm: -5 }, songSchema);
    expect(r.errors.map((e) => [e.path, e.code])).toEqual([
      ['id', 'too_small'],
      ['bpm', 'too_small'],
    ]);
  });
});

describe('sfxSchema', () => {
  it('accepts a good sound effect with no tempo', () => {
    const sfx = { id: 'jump', pulse: 'o5 l32 c e g' };
    expect(validate('sfx/jump.json', sfx, sfxSchema)).toEqual({ ok: true, value: sfx, errors: [] });
  });

  it('reports a bad voice at its field', () => {
    const r = validate('sfx/jump.json', { id: 'jump', pulse: 'o5 l5 c' }, sfxSchema);
    expect(r.errors).toMatchObject([{ file: 'sfx/jump.json', path: 'pulse', code: 'invalid_mml' }]);
  });

  it('rejects Song channel names on a sound effect', () => {
    const r = validate('sfx/jump.json', { id: 'jump', pulse1: 'c' }, sfxSchema);
    expect(r.errors.map((e) => [e.path, e.code])).toContainEqual(['pulse1', 'unrecognized_keys']);
  });
});
