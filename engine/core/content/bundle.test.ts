import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { contentNamed, contentOf, entryName, globToRegExp, loadContent } from './bundle';
import { engineContentKinds, SONG_KIND } from './engine-kinds';
import type { ContentKind } from './kinds';
import { encodePng } from './png';

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

  it("runs a kind's checkAll once every file passes, at the entry's part file and line", () => {
    const seen: string[][] = [];
    const checked = engineContentKinds().register({
      ...NOTE,
      checkAll(entries) {
        seen.push(entries.map((e) => e.name));
        return [{ name: 'n', path: ['grid', 1], code: 'clash', message: 'n clashes', row: 1, col: 0 }];
      },
    } satisfies ContentKind);
    const r = loadContent(files(), checked, { root: 'g/' });
    expect(seen).toEqual([['n']]);
    expect(r.errors).toEqual([
      {
        file: 'g/content/notes/deep/n.grid.txt',
        path: 'grid.1',
        pointer: '/grid/1',
        message: 'n clashes',
        code: 'clash',
        row: 1,
        col: 0,
        line: 3,
      },
    ]);
    // With another error in the game, checkAll is not run (it would only see part of the files).
    seen.length = 0;
    const bad = loadContent(files({ 'content/songs/a.json': '{' }), checked);
    expect(bad.errors.map((e) => e.code)).toEqual(['invalid_json']);
    expect(seen).toEqual([]);
    // checkAll: false leaves it out (the editing verbs report cross-file problems apart).
    expect(loadContent(files(), checked, { checkAll: false }).ok).toBe(true);
    expect(seen).toEqual([]);
  });
});

describe('the manifest screen size', () => {
  const withScreen = (screen: unknown) => files({ './game.json': JSON.stringify({ ...MANIFEST, screen }) });

  it('defaults to 256x240 and takes a size of its own', () => {
    const plain = loadContent(files(), kinds);
    expect(plain.ok && plain.value.manifest.screen).toEqual({ width: 256, height: 240 });
    const wide = loadContent(withScreen({ width: 320, height: 180 }), kinds);
    expect(wide.errors).toEqual([]);
    expect(wide.ok && wide.value.manifest.screen).toEqual({ width: 320, height: 180 });
    expect(loadContent(withScreen({ width: 64, height: 1920 }), kinds).errors).toEqual([]);
  });

  it('rejects sizes out of range, fractions, missing sides and extra fields, at the field', () => {
    const errs = (screen: unknown) => loadContent(withScreen(screen), kinds, { root: 'g/' }).errors;
    expect(errs({ width: 63, height: 240 })).toMatchObject([
      { file: 'g/game.json', path: 'screen.width', code: 'too_small' },
    ]);
    expect(errs({ width: 256, height: 1921 })).toMatchObject([
      { file: 'g/game.json', path: 'screen.height', code: 'too_big' },
    ]);
    expect(errs({ width: 256.5, height: 240 })).toMatchObject([
      { file: 'g/game.json', path: 'screen.width', code: 'invalid_type' },
    ]);
    expect(errs({ width: 256 })).toMatchObject([{ file: 'g/game.json', path: 'screen.height' }]);
    expect(errs({ width: 256, height: 240, depth: 1 })).toMatchObject([
      { file: 'g/game.json', path: 'screen.depth' },
    ]);
    expect(errs('256x240')).toMatchObject([{ file: 'g/game.json', path: 'screen', code: 'invalid_type' }]);
  });
});

describe('the manifest transitions (Engine 0.16 T5)', () => {
  const withTransitions = (transitions: unknown) =>
    files({ './game.json': JSON.stringify({ ...MANIFEST, transitions }) });

  it('takes the transitions by slot', () => {
    const read = loadContent(
      withTransitions({
        level: { kind: 'iris', ticks: 24, at: 'follow' },
        scene: { kind: 'wipe', ticks: 16, direction: 'left', edge: 12 },
        default: { kind: 'fade', ticks: 12, color: '#000' },
      }),
      kinds,
    );
    expect(read.errors).toEqual([]);
    expect(read.ok && read.value.manifest.transitions?.level).toEqual({
      kind: 'iris',
      ticks: 24,
      at: 'follow',
    });
    const plain = loadContent(files(), kinds);
    expect(plain.ok && plain.value.manifest.transitions).toBeUndefined();
  });

  it('rejects an unknown kind, a bad field and an unknown slot, at the field', () => {
    const errs = (transitions: unknown) =>
      loadContent(withTransitions(transitions), kinds, { root: 'g/' }).errors;
    expect(errs({ level: { kind: 'spin', ticks: 20 } })).toMatchObject([
      { file: 'g/game.json', path: 'transitions.level.kind' },
    ]);
    expect(errs({ scene: { kind: 'wipe', ticks: 20, direction: 'sideways' } })).toMatchObject([
      { file: 'g/game.json', path: 'transitions.scene.direction' },
    ]);
    expect(errs({ menu: { kind: 'fade', ticks: 20 } })).toMatchObject([
      { file: 'g/game.json', path: 'transitions.menu' },
    ]);
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

describe('menus art from a skin image (Engine 0.16 part B)', () => {
  const png = `data:image/png;base64,${Buffer.from(encodePng(8, 8, new Uint8Array(256))).toString('base64')}`;
  const game = (frame: string) => ({
    './game.json': JSON.stringify({
      ...MANIFEST,
      content: { skin: ['content/skins/*.json'], font: ['content/fonts/*.txt'] },
      menus: {
        font: 'f',
        title: { name: 'A', art: [{ sheet: 'hero', frame, anchor: 'left', x: 0, y: 0 }], items: ['start'] },
        pause: { items: ['resume'] },
      },
    }),
    'content/fonts/f.txt': 'cell 1 1\nbaseline 1\n\nglyph A\n#\n',
    'content/skins/canvas2d.json': JSON.stringify({
      backend: 'canvas2d',
      images: { hero: { image: 'assets/pack/hero.png', frames: { stand: { x: 0, y: 0, w: 8, h: 8 } } } },
      kinds: {},
    }),
    'assets/CREDITS.md':
      '# Credits\n\n## pack\n\n- Source: https://example.org/pack\n- Author: A\n- Licence: CC0 1.0\n',
    'assets/pack/hero.png': png,
  });

  it("lets the title's art name a skin's PNG sheet and its frames", () => {
    // The tiny font has no glyphs for the menus' words: only the art's errors matter here.
    const art = (frame: string) =>
      loadContent(game(frame), kinds).errors.filter((e) => e.path.startsWith('menus.title.art'));
    expect(art('stand')).toEqual([]);
    expect(art('sit')).toMatchObject([
      { file: 'game.json', path: 'menus.title.art.0.frame', code: 'missing_frame' },
    ]);
  });
});
