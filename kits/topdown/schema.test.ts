import { describe, expect, it } from 'vitest';
import { parseContent } from '@engine/core/content/kinds';
import { validate } from '@engine/core/content/validate';
import { roomKind, roomSchema } from './schema';

const MAP = [
  '################',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#......@.......#',
  '#..............#',
  '#..............#',
  '#......c.......#',
  '#..............#',
  '################',
];
const ROOM = { id: 'hall', at: [0, 1], music: 'theme', chests: ['bombs'], map: MAP };

function withRow(row: number, text: string): string[] {
  return MAP.map((r, i) => (i === row ? text : r));
}

describe('roomSchema', () => {
  it('accepts a room the kit can parse', () => {
    const r = validate('hall.json', ROOM, roomSchema());
    expect(r.ok && r.value).toEqual(ROOM);
  });

  it('names a bad field and an unknown one', () => {
    const r = validate('hall.json', { ...ROOM, at: [0, -1], colour: 'red' }, roomSchema());
    expect(r.errors.map((e) => [e.path, e.code])).toEqual([
      ['at.1', 'too_small'],
      ['colour', 'unrecognized_keys'],
    ]);
  });

  it('checks the map against the legend and the room size', () => {
    expect(
      validate('h.json', { ...ROOM, map: withRow(3, '#....?.........#') }, roomSchema()).errors,
    ).toMatchObject([{ path: 'map.3', code: 'unknown_char', row: 3, col: 5 }]);
    expect(validate('h.json', { ...ROOM, map: MAP.slice(1) }, roomSchema()).errors).toMatchObject([
      { path: 'map', code: 'wrong_size' },
    ]);
    const narrow = MAP.map((r) => r.slice(1));
    expect(validate('h.json', { ...ROOM, map: narrow }, roomSchema()).errors).toMatchObject([
      { path: 'map.0', code: 'wrong_size' },
    ]);
  });

  it('accepts a game legend character', () => {
    const map = withRow(3, '#....G.........#');
    expect(validate('h.json', { ...ROOM, map }, roomSchema()).ok).toBe(false);
    const extra = { G: { tile: 'floor' as const, spawn: 'boss' } };
    expect(validate('h.json', { ...ROOM, map }, roomSchema(extra)).ok).toBe(true);
  });

  it('reports what parseRoom rejects, at the row it names', () => {
    const r = validate('h.json', { ...ROOM, map: withRow(4, '...............#') }, roomSchema());
    expect(r.errors).toMatchObject([{ path: 'map.4', code: 'invalid_room', row: 4, col: 0 }]);
    const chests = validate('h.json', { ...ROOM, chests: [] }, roomSchema());
    expect(chests.errors).toMatchObject([{ path: '', code: 'invalid_room' }]);
    expect(chests.errors[0]?.message).toMatch(/1 chests but 0/);
  });
});

describe('roomKind', () => {
  it('reads the map from its .map.txt part', () => {
    const json = JSON.stringify({ id: 'hall', at: [0, 1], chests: ['bombs'] });
    const part = { file: 'rooms/hall.map.txt', text: `${MAP.join('\n')}\n` };
    const r = parseContent(roomKind(), 'rooms/hall.json', json, { map: part });
    expect(r.ok && r.value.map).toEqual(MAP);
    const bad = { ...part, text: withRow(2, '#.....x........#').join('\n') };
    expect(parseContent(roomKind(), 'rooms/hall.json', json, { map: bad }).errors).toMatchObject([
      { file: 'rooms/hall.map.txt', path: 'map.2', line: 3, code: 'unknown_char' },
    ]);
  });
});
