import { describe, expect, it } from 'vitest';
import { validate } from '@engine/core/content/validate';
import { checkLevel, levelCells, levelSchema, levelSize, type LevelDef } from './level';
import type { ProfileDef } from './profile';

const MAP = ['......G', '.?.....', '@..w.##', '###.###'];
const LEVEL = { id: 'l', profile: 'p', spawns: { w: { actor: 'walker' } }, map: MAP };
const PROFILE = { id: 'p', actors: { walker: {} } } as unknown as ProfileDef;

function parsed(over: Record<string, unknown> = {}): LevelDef {
  const r = validate('l.json', { ...LEVEL, ...over }, levelSchema);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
}

describe('levelSchema', () => {
  it('accepts a level and fills in the defaults', () => {
    const level = parsed();
    expect(level.scroll).toBe('right');
    expect(level.spawns.w).toEqual({ actor: 'walker', facing: 'left' });
    expect(levelSize(level)).toEqual({ cols: 7, rows: 4 });
    expect(levelCells(level).find((c) => c.ch === '@')).toEqual({ row: 2, col: 0, ch: '@' });
  });

  it('names a bad field and an unknown one', () => {
    const r = validate('l.json', { ...LEVEL, scroll: 'up', colour: 'red' }, levelSchema);
    expect(r.errors.map((e) => [e.path, e.code])).toEqual([
      ['scroll', 'invalid_value'],
      ['colour', 'unrecognized_keys'],
    ]);
  });

  it('checks the grid against the legend and the spawn characters', () => {
    const r = validate('l.json', { ...LEVEL, spawns: {} }, levelSchema);
    expect(r.errors).toMatchObject([{ path: 'map.2', code: 'unknown_char', row: 2, col: 3 }]);
    const ragged = validate('l.json', { ...LEVEL, map: [...MAP, '##'] }, levelSchema);
    expect(ragged.errors).toMatchObject([{ path: 'map.4', code: 'ragged_row', row: 4 }]);
  });

  it("takes a decoration grid the map's size, of props but no terrain character (0.16 part C T1)", () => {
    const decor = ['.f.....', '.......', '..r..t.', '.......'];
    expect(parsed({ decor }).decor).toEqual(decor);
    const size = validate('l.json', { ...LEVEL, decor: decor.slice(1) }, levelSchema);
    expect(size.errors).toMatchObject([{ path: 'decor', code: 'size_mismatch' }]);
    const terrain = validate('l.json', { ...LEVEL, decor: ['.#.....', ...decor.slice(1)] }, levelSchema);
    expect(terrain.errors).toMatchObject([{ path: 'decor.0', code: 'unknown_char', row: 0, col: 1 }]);
    const ragged = validate('l.json', { ...LEVEL, decor: [...decor.slice(0, 3), '..'] }, levelSchema);
    expect(ragged.errors).toMatchObject([{ path: 'decor.3', code: 'ragged_row', row: 3 }]);
  });

  it('refuses spawn keys that are not one free character', () => {
    const r = validate(
      'l.json',
      { ...LEVEL, spawns: { ww: { actor: 'walker' }, '#': { actor: 'walker' } } },
      levelSchema,
    );
    expect(r.errors.map((e) => [e.path, e.code])).toEqual(
      expect.arrayContaining([
        ['spawns.ww', 'bad_spawn_key'],
        ['spawns["#"]', 'bad_spawn_key'],
      ]),
    );
  });

  it('checks a given size and the bump block contents against the grid', () => {
    expect(parsed({ size: [7, 4] }).size).toEqual([7, 4]);
    const size = validate('l.json', { ...LEVEL, size: [8, 4] }, levelSchema);
    expect(size.errors).toMatchObject([{ path: 'size', code: 'size_mismatch' }]);
    const blocks = validate('l.json', { ...LEVEL, blocks: ['coin', 'life'] }, levelSchema);
    expect(blocks.errors).toMatchObject([{ path: 'blocks', code: 'wrong_block_count' }]);
    const bad = validate('l.json', { ...LEVEL, blocks: ['cake'] }, levelSchema);
    expect(bad.errors).toMatchObject([{ path: 'blocks.0', code: 'invalid_format' }]);
    expect(parsed({ blocks: ['actor:walker'] }).blocks).toEqual(['actor:walker']);
  });
});

describe('checkLevel', () => {
  it('passes a level with one start, a goal and known actors', () => {
    expect(checkLevel(parsed(), PROFILE)).toEqual([]);
  });

  it('reports each extra start and a missing goal', () => {
    const level = parsed({ map: ['@.....@', '.?.....', '@..w.##', '###.###'] });
    expect(checkLevel(level, PROFILE)).toEqual([
      expect.objectContaining({ path: ['map', 0], code: 'two_starts', row: 0, col: 6 }),
      expect.objectContaining({ path: ['map', 2], code: 'two_starts', row: 2, col: 0 }),
      expect.objectContaining({ path: ['map'], code: 'no_goal' }),
    ]);
  });

  it('reports unknown actors at the cells, the header or the block', () => {
    const level = parsed({
      spawns: { w: { actor: 'hopper' }, x: { actor: 'flyer' } },
      blocks: ['actor:diver'],
    });
    expect(checkLevel(level, PROFILE).map((p) => [p.path, p.code, p.row, p.col])).toEqual([
      [['map', 2], 'unknown_actor', 2, 3],
      [['spawns', 'x', 'actor'], 'unknown_actor', undefined, undefined],
      [['blocks', 0], 'unknown_actor', undefined, undefined],
    ]);
  });

  it('passes a checkpoint on ground and reports one with no ground to respawn on', () => {
    expect(checkLevel(parsed({ map: ['......G', '.?...K.', '@..w.##', '###.###'] }), PROFILE)).toEqual([]);
    expect(checkLevel(parsed({ map: ['......G', '.?.....', '@.Kw=#K', '###.###'] }), PROFILE)).toEqual([]);
    const level = parsed({ map: ['K.....G', '.?.....', '@..w.##', '###K###'] });
    expect(checkLevel(level, PROFILE).map((p) => [p.path, p.code, p.row, p.col])).toEqual([
      [['map', 0], 'checkpoint_no_ground', 0, 0],
      [['map', 3], 'checkpoint_no_ground', 3, 3],
    ]);
  });

  it('reports a profile that is not there', () => {
    expect(checkLevel(parsed(), undefined)).toEqual([
      expect.objectContaining({ path: ['profile'], code: 'missing_profile' }),
    ]);
  });
});
