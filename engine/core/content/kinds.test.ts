import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { engineContentKinds } from './engine-kinds';
import { ContentKinds, extensionOf, parseContent } from './kinds';

const kinds = engineContentKinds();
const SONG = JSON.stringify({ id: 't', bpm: 120, loop: false, pulse1: 'c d e' });

describe('content kinds', () => {
  it('registers the engine kinds, listed by name', () => {
    expect(kinds.list().map((k) => k.name)).toEqual([
      'campaign',
      'mission',
      'palette',
      'sfx',
      'skin',
      'song',
      'sprite',
    ]);
    expect(kinds.has('song')).toBe(true);
    expect(kinds.get('sprite')?.readText).toBeTypeOf('function');
  });

  it('reads a JSON file of a kind', () => {
    expect(kinds.parse('song', 'songs/t.json', SONG)).toMatchObject({ ok: true, value: { id: 't' } });
  });

  it('reports a broken song field with the file name and the field path', () => {
    const text = JSON.stringify({ id: 't', bpm: 120, loop: false, pulse1: 'c d e', noise: 'k s q9 h' });
    expect(kinds.parse('song', 'games/samples/dungeon/songs/t.json', text).errors).toMatchObject([
      { file: 'games/samples/dungeon/songs/t.json', path: 'noise', pointer: '/noise', code: 'invalid_mml' },
    ]);
  });

  it('reports bad JSON at the file', () => {
    expect(kinds.parse('song', 's.json', '{"id": ').errors).toMatchObject([
      { file: 's.json', path: '', code: 'invalid_json' },
    ]);
  });

  it('rejects an extension the kind cannot read', () => {
    expect(kinds.parse('song', 's.txt', 'c d e').errors).toMatchObject([
      { file: 's.txt', code: 'unsupported_extension', message: 'a song file must be .json' },
    ]);
    expect(kinds.parse('sprite', 's.png', '').errors[0]?.message).toBe('a sprite file must be .json or .txt');
  });

  it('reports an unknown kind', () => {
    expect(kinds.parse('room', 'r.json', '{}').errors).toMatchObject([
      {
        file: 'r.json',
        code: 'unknown_kind',
        message: 'unknown content kind "room" (known: campaign, mission, palette, sfx, skin, song, sprite)',
      },
    ]);
  });

  it('refuses to register a kind twice', () => {
    const k = { name: 'x', description: 'x', schema: z.string() };
    expect(() => new ContentKinds().register(k).register(k)).toThrow(/already registered/);
  });

  it('lets a game add its own kind', () => {
    const own = new ContentKinds().register({
      name: 'note',
      description: 'a note',
      schema: z.strictObject({ text: z.string() }),
    });
    expect(parseContent(own.get('note')!, 'n.JSON', '{"text":"hi"}')).toMatchObject({ ok: true });
    expect(own.parse('note', 'n.json', '{"text":1}').errors).toMatchObject([{ path: 'text' }]);
  });

  it('knows the two content extensions', () => {
    expect([extensionOf('a.json'), extensionOf('a.TXT'), extensionOf('a.mml')]).toEqual([
      '.json',
      '.txt',
      null,
    ]);
  });
});
