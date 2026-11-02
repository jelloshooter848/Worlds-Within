import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { contentNamed, contentOf, entryName, globToRegExp, loadContent } from './bundle';
import { engineContentKinds, SONG_KIND } from './engine-kinds';
import type { ContentKind } from './kinds';

const NOTE = {
  name: 'note',
  description: 'a note with a text grid',
  schema: z.strictObject({ id: z.string(), grid: z.array(z.string()).min(2) }),
  gridParts: { grid: '.grid.txt' },
} satisfies ContentKind;

const kinds = engineContentKinds().register(NOTE);

const MANIFEST = {
  id: 'tiny',
  kit: 'topdown',
  content: { song: ['content/songs/*.json'], note: ['content/notes/**/*.json'] },
  start: { seed: 7 },
  headless: 'headless.ts',
};

function files(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const base: Record<string, string | undefined> = {
    './game.json': JSON.stringify(MANIFEST),
    'content/songs/a.json': JSON.stringify({ id: 'a', bpm: 120, loop: false, pulse1: 'c d e' }),
    'content/notes/deep/n.json': JSON.stringify({ id: 'n' }),
    'content/notes/deep/n.grid.txt': '\nab\ncd\n',
    ...overrides,
  };
  return Object.fromEntries(Object.entries(base).filter((e): e is [string, string] => e[1] !== undefined));
}

describe('loadContent', () => {
  it('builds a typed bundle, reading grid parts into their field', () => {
    const r = loadContent(files(), kinds);
    expect(r.errors).toEqual([]);
    if (!r.ok) return;
    expect(r.value.manifest.start.seed).toBe(7);
    expect(r.value.entries.map((e) => [e.kind, e.name, e.file])).toEqual([
      ['song', 'a', 'content/songs/a.json'],
      ['note', 'n', 'content/notes/deep/n.json'],
    ]);
    expect(contentOf(r.value, SONG_KIND)[0]?.value.bpm).toBe(120);
    expect(contentNamed(r.value, NOTE, 'n')?.value.grid).toEqual(['ab', 'cd']);
  });

  it('names the part file and its line for an error in the part', () => {
    const r = loadContent(files({ 'content/notes/deep/n.grid.txt': '\n\nab\n' }), kinds, { root: 'g/' });
    expect(r.errors).toMatchObject([
      { file: 'g/content/notes/deep/n.grid.txt', path: 'grid', code: 'too_small' },
    ]);
    const bad = { ...NOTE, schema: z.strictObject({ id: z.string(), grid: z.array(z.string().max(1)) }) };
    const r2 = loadContent(files(), engineContentKinds().register(bad), { root: 'g/' });
    expect(r2.errors).toMatchObject([
      { file: 'g/content/notes/deep/n.grid.txt', path: 'grid.0', line: 2 },
      { file: 'g/content/notes/deep/n.grid.txt', path: 'grid.1', line: 3 },
    ]);
  });

  it('rejects a field given both inline and in a part', () => {
    const r = loadContent(files({ 'content/notes/deep/n.json': '{"id":"n","grid":["ab","cd"]}' }), kinds);
    expect(r.errors).toMatchObject([
      { file: 'content/notes/deep/n.json', path: 'grid', code: 'duplicate_field' },
    ]);
  });

  it('reports a missing or broken game.json', () => {
    expect(loadContent(files({ './game.json': undefined }), kinds, { root: 'g/' }).errors).toMatchObject([
      { file: 'g/game.json', code: 'missing_file' },
    ]);
    expect(loadContent(files({ './game.json': '{' }), kinds).errors[0]?.code).toBe('invalid_json');
    const noKit = JSON.stringify({ ...MANIFEST, kit: undefined });
    expect(loadContent(files({ './game.json': noKit }), kinds).errors).toMatchObject([
      { file: 'game.json', path: 'kit', code: 'invalid_type' },
    ]);
  });

  it('reports unknown kinds, empty patterns, unclaimed files and doubly claimed files', () => {
    const manifest = {
      ...MANIFEST,
      content: {
        song: ['content/songs/*.json', 'content/missing/*.json'],
        note: ['content/notes/**/*.json'],
        room: ['content/rooms/*.json'],
        sfx: ['content/songs/a.json'],
      },
    };
    const r = loadContent(
      files({ './game.json': JSON.stringify(manifest), 'content/stray.txt': 'x' }),
      kinds,
    );
    expect(r.errors.map((e) => [e.file, e.path, e.code])).toEqual([
      ['game.json', 'content.song.1', 'no_match'],
      ['game.json', 'content.room', 'unknown_kind'],
      ['content/songs/a.json', '', 'claimed_twice'],
      ['content/stray.txt', '', 'unclaimed_file'],
    ]);
  });

  it('reports an id that is not the file name, and two files with one name', () => {
    const r = loadContent(
      files({
        'content/songs/b.json': JSON.stringify({ id: 'x', bpm: 120, loop: false, pulse1: 'c' }),
        'content/notes/n.json': JSON.stringify({ id: 'n', grid: ['a', 'b'] }),
      }),
      kinds,
    );
    expect(r.errors.map((e) => [e.file, e.path, e.code])).toEqual([
      ['content/songs/b.json', 'id', 'id_mismatch'],
      ['content/notes/n.json', '', 'duplicate_name'],
    ]);
  });

  it('collects schema errors from every file', () => {
    const r = loadContent(files({ 'content/songs/a.json': '{"id":"a"}' }), kinds);
    expect(r.errors.map((e) => e.path)).toEqual(['bpm', 'loop']);
  });
});

describe('globs and names', () => {
  it.each([
    ['content/*.json', 'content/a.json', true],
    ['content/*.json', 'content/x/a.json', false],
    ['content/**/*.json', 'content/a.json', true],
    ['content/**/*.json', 'content/x/y/a.json', true],
    ['content/a?.txt', 'content/ab.txt', true],
    ['content/**', 'content/x/y', true],
    ['content/a.json', 'content/aXjson', false],
  ])('%s matches %s: %s', (glob, path, hit) => {
    expect(globToRegExp(glob).test(path)).toBe(hit);
  });

  it('names an entry by its file name up to the first dot', () => {
    expect(entryName('content/rooms/hall.map.txt')).toBe('hall');
    expect(entryName('a.json')).toBe('a');
  });
});
